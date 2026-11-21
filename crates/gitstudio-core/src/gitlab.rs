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
    /// Kind and expiry of the token used (never the token itself).
    #[serde(default, skip_deserializing)]
    pub token: crate::token::TokenInfo,
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
    request(token, reqwest::Method::GET, path, None).await
}

async fn request(
    token: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value> {
    let mut req = reqwest::Client::builder()
        .user_agent(concat!("GitStudio/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30))
        .build()?
        .request(method, format!("{API}{path}"))
        .bearer_auth(token);
    if let Some(b) = body {
        req = req.json(&b);
    }
    let res = req
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
            .map(|m| match m {
                // Validation errors come as a list (or a map of lists) of sentences.
                Value::String(s) => s.clone(),
                Value::Array(a) => a
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("; "),
                other => other.to_string(),
            })
            .unwrap_or_else(|| "request failed".into());
        return Err(Error::GitHub(format!("GitLab {}: {msg}", status.as_u16())));
    }
    Ok(v)
}

pub async fn user(token: &str) -> Result<User> {
    let (u, info) = tokio::join!(get(token, "/user"), token_info(token));
    let mut u: User = serde_json::from_value(u?)?;
    u.token = info;
    Ok(u)
}

/// Kind and expiry of `token`. Only access tokens can describe themselves
/// (`/personal_access_tokens/self`); an OAuth token (e.g. from Git Credential Manager) gets an
/// error there, and has no fixed expiry date of its own.
async fn token_info(token: &str) -> crate::token::TokenInfo {
    use crate::token::{TokenInfo, TokenKind, gitlab_kind, parse_gitlab_expires_at};
    match get(token, "/personal_access_tokens/self").await {
        Ok(v) => TokenInfo {
            kind: TokenKind::Pat,
            expires_at: parse_gitlab_expires_at(&v),
            expiry_unknown: false,
        },
        Err(_) => {
            let kind = match gitlab_kind(token) {
                TokenKind::Unknown => TokenKind::Oauth,
                k => k,
            };
            TokenInfo {
                kind,
                expires_at: None,
                // A `glpat-` token can always describe itself, so a failure here is the request
                // (5xx, timeout), not "no expiry": don't let it wipe the date we already have.
                expiry_unknown: kind == TokenKind::Pat,
            }
        }
    }
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

fn stored_token() -> Result<String> {
    load_token()?.ok_or_else(|| Error::GitHub("Not signed in to GitLab".into()))
}

/// A project path as one URL segment: GitLab takes `group%2Fsub%2Fname` in place of the id.
fn project_id(path: &str) -> Result<String> {
    if path.is_empty()
        || path
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return Err(Error::Invalid(format!("Not a GitLab project path: {path}")));
    }
    Ok(path
        .bytes()
        .map(|b| match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect())
}

/// A merge request in the shape of a GitHub pull request, so the UI lists both alike
/// (`number` is the MR's iid, the `!123` people use).
fn mr_from(v: &Value) -> crate::github::PullRequest {
    let s = |p: &str| {
        v.pointer(p)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let same_project = v.get("source_project_id") == v.get("target_project_id");
    crate::github::PullRequest {
        number: v.get("iid").and_then(Value::as_u64).unwrap_or(0),
        title: s("/title"),
        state: s("/state"),
        draft: v
            .get("draft")
            .or_else(|| v.get("work_in_progress"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        html_url: s("/web_url"),
        author: s("/author/username"),
        author_avatar: s("/author/avatar_url"),
        head_ref: s("/source_branch"),
        // Only the project's own branches can be checked out from its remote.
        head_repo: same_project
            .then(|| v.pointer("/references/full").and_then(Value::as_str))
            .flatten()
            .and_then(|r| r.split_once('!'))
            .map(|(p, _)| p.to_string()),
        base_ref: s("/target_branch"),
        updated_at: s("/updated_at"),
    }
}

/// Open merge requests of the project at `path`.
pub async fn merge_requests(path: &str) -> Result<Vec<crate::github::PullRequest>> {
    let v = get(
        &stored_token()?,
        &format!(
            "/projects/{}/merge_requests?state=opened&per_page=100&order_by=updated_at",
            project_id(path)?
        ),
    )
    .await?;
    Ok(v.as_array()
        .map(|a| a.iter().map(mr_from).collect())
        .unwrap_or_default())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMergeRequest {
    /// Project path (`group/sub/name`).
    pub path: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub draft: bool,
}

pub async fn create_merge_request(mr: &NewMergeRequest) -> Result<crate::github::PullRequest> {
    let title = mr.title.trim();
    if title.is_empty() {
        return Err(Error::Invalid("Merge request title is empty".into()));
    }
    // GitLab marks a draft by its title.
    let title = if mr.draft && !title.to_ascii_lowercase().starts_with("draft:") {
        format!("Draft: {title}")
    } else {
        title.to_string()
    };
    let v = request(
        &stored_token()?,
        reqwest::Method::POST,
        &format!("/projects/{}/merge_requests", project_id(&mr.path)?),
        Some(serde_json::json!({
            "title": title,
            "description": mr.description,
            "source_branch": mr.source,
            "target_branch": mr.target,
        })),
    )
    .await?;
    Ok(mr_from(&v))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_ids() {
        assert_eq!(project_id("acme/web/app").unwrap(), "acme%2Fweb%2Fapp");
        assert_eq!(project_id("a.b/c_d-e").unwrap(), "a.b%2Fc_d-e");
        assert!(project_id("acme/../x").is_err());
        assert!(project_id("").is_err());
    }

    #[test]
    fn merge_request_as_pull_request() {
        let v = serde_json::json!({
            "iid": 7,
            "title": "Draft: Add login",
            "state": "opened",
            "draft": true,
            "web_url": "https://gitlab.com/acme/web/app/-/merge_requests/7",
            "author": { "username": "bob", "avatar_url": "https://x/a.png" },
            "source_branch": "login",
            "target_branch": "main",
            "source_project_id": 1,
            "target_project_id": 1,
            "references": { "full": "acme/web/app!7" },
            "updated_at": "2026-11-20T10:00:00Z"
        });
        let pr = mr_from(&v);
        assert_eq!(pr.number, 7);
        assert!(pr.draft);
        assert_eq!(pr.head_ref, "login");
        assert_eq!(pr.base_ref, "main");
        assert_eq!(pr.head_repo.as_deref(), Some("acme/web/app"));
        assert_eq!(
            pr.html_url,
            "https://gitlab.com/acme/web/app/-/merge_requests/7"
        );
        // From a fork: not checked out from this remote.
        let fork = serde_json::json!({ "iid": 8, "source_project_id": 2, "target_project_id": 1,
            "references": { "full": "acme/web/app!8" } });
        assert_eq!(mr_from(&fork).head_repo, None);
    }
}
