//! GitLab.com: personal access token (or a token Git Credential Manager already stores),
//! kept in the OS keychain, used for the API and for HTTPS git operations on gitlab.com.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{Error, Result};

pub const HOST: &str = "gitlab.com";
const API: &str = "https://gitlab.com/api/v4";
const KEYRING_SERVICE: &str = "dev.gitstudio.desktop";
const KEYRING_ACCOUNT: &str = "gitlab.com";

fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| Error::Keyring(e.to_string()))
}

pub fn load_token() -> Result<Option<String>> {
    match entry()?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(Error::Keyring(e.to_string())),
    }
}

fn save_token(token: &str) -> Result<()> {
    entry()?
        .set_password(token)
        .map_err(|e| Error::Keyring(e.to_string()))
}

pub fn delete_token() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::Keyring(e.to_string())),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    #[serde(alias = "username")]
    pub login: String,
    pub name: Option<String>,
    #[serde(alias = "avatar_url", default)]
    pub avatar_url: String,
    #[serde(alias = "web_url", default)]
    pub html_url: String,
}

/// Same shape as a GitHub repository summary so the UI can list both alike.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub full_name: String,
    pub name: String,
    pub description: Option<String>,
    pub private: bool,
    pub fork: bool,
    pub clone_url: String,
    pub ssh_url: String,
    pub html_url: String,
    pub default_branch: Option<String>,
    pub updated_at: Option<String>,
    pub stargazers_count: u64,
}

fn project_from(v: &Value) -> Project {
    let s = |k: &str| {
        v.get(k)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    Project {
        full_name: s("path_with_namespace"),
        name: s("path"),
        description: v
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string),
        private: v.get("visibility").and_then(Value::as_str) != Some("public"),
        fork: v.get("forked_from_project").is_some_and(|f| !f.is_null()),
        clone_url: s("http_url_to_repo"),
        ssh_url: s("ssh_url_to_repo"),
        html_url: s("web_url"),
        default_branch: v
            .get("default_branch")
            .and_then(Value::as_str)
            .map(str::to_string),
        updated_at: v
            .get("last_activity_at")
            .and_then(Value::as_str)
            .map(str::to_string),
        stargazers_count: v.get("star_count").and_then(Value::as_u64).unwrap_or(0),
    }
}

async fn get(token: &str, path: &str) -> Result<Value> {
    let res = reqwest::Client::builder()
        .user_agent(concat!("GitStudio/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30))
        .build()?
        .get(format!("{API}{path}"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| Error::GitHub(format!("Could not reach GitLab: {e}")))?;
    let status = res.status();
    let v: Value = res.json().await.unwrap_or(Value::Null);
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(Error::GitHub(
            "GitLab 401: GitLab rejected the token. Sign in again.".into(),
        ));
    }
    if !status.is_success() {
        let msg = v
            .get("message")
            .or_else(|| v.get("error_description"))
            .or_else(|| v.get("error"))
            .map(|m| m.to_string())
            .unwrap_or_else(|| "request failed".into());
        return Err(Error::GitHub(format!("GitLab {}: {msg}", status.as_u16())));
    }
    Ok(v)
}

pub async fn user(token: &str) -> Result<User> {
    Ok(serde_json::from_value(get(token, "/user").await?)?)
}

/// Validate and store `token`.
pub async fn sign_in_with_token(token: &str) -> Result<User> {
    let token = token.trim();
    if token.is_empty() {
        return Err(Error::Invalid("Token is empty".into()));
    }
    let u = user(token).await?;
    save_token(token)?;
    Ok(u)
}

/// Reuse the gitlab.com credential Git Credential Manager already stores (never prompts).
pub async fn import_token() -> Result<User> {
    let out = crate::git::run::raw(
        None,
        &["credential", "fill"],
        crate::git::run::Opts {
            stdin: Some(b"protocol=https\nhost=gitlab.com\n\n"),
            env: vec![("GCM_INTERACTIVE".into(), "never".into())],
        },
    )
    .await?;
    let text = out.text();
    let token = text
        .lines()
        .find_map(|l| l.strip_prefix("password="))
        .filter(|p| out.code == 0 && !p.is_empty())
        .ok_or_else(|| {
            Error::GitHub("Git has no stored GitLab credentials on this machine".into())
        })?;
    sign_in_with_token(token).await
}

/// Projects the user is a member of, most recently active first.
pub async fn projects(page: u32) -> Result<Vec<Project>> {
    let token = load_token()?.ok_or_else(|| Error::GitHub("Not signed in to GitLab".into()))?;
    let v = get(
        &token,
        &format!("/projects?membership=true&per_page=100&order_by=last_activity_at&page={page}"),
    )
    .await?;
    Ok(v.as_array()
        .map(|a| a.iter().map(project_from).collect())
        .unwrap_or_default())
}
