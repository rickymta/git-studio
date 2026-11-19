//! GitHub: sign-in (OAuth device flow or personal access token), token storage in the OS
//! keychain, and the REST calls the UI needs.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{Error, Result};

const API: &str = "https://api.github.com";
const KEYRING_SERVICE: &str = "dev.gitstudio.desktop";
const KEYRING_ACCOUNT: &str = "github.com";
/// Scopes requested by the device flow: private repos, PRs, the user's email, and SSH keys.
const SCOPES: &str = "repo read:org user:email workflow admin:public_key";

fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(concat!("GitStudio/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30))
        .build()?)
}

// ---- token storage ----------------------------------------------------------------------------

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

pub fn save_token(token: &str) -> Result<()> {
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

// ---- device flow ------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    #[serde(alias = "device_code")]
    pub device_code: String,
    #[serde(alias = "user_code")]
    pub user_code: String,
    #[serde(alias = "verification_uri")]
    pub verification_uri: String,
    #[serde(alias = "expires_in")]
    pub expires_in: u64,
    pub interval: u64,
}

pub async fn device_start(client_id: &str) -> Result<DeviceCode> {
    if client_id.trim().is_empty() {
        return Err(Error::Invalid(
            "Set a GitHub OAuth App client ID in Settings to sign in with the browser, or use a personal access token.".into(),
        ));
    }
    let res = client()?
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", client_id.trim()), ("scope", SCOPES)])
        .send()
        .await?;
    let v: Value = res.json().await?;
    if let Some(err) = v.get("error_description").or_else(|| v.get("error")) {
        return Err(Error::GitHub(
            err.as_str().unwrap_or("Device flow failed").to_string(),
        ));
    }
    Ok(serde_json::from_value(v)?)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum DevicePoll {
    /// User has not approved yet.
    Pending,
    /// Poll less often (seconds).
    SlowDown { interval: u64 },
    /// Approved: the token is stored and here is the account.
    Done { user: User },
}

pub async fn device_poll(client_id: &str, device_code: &str) -> Result<DevicePoll> {
    let res = client()?
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id.trim()),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await?;
    let v: Value = res.json().await?;
    if let Some(token) = v.get("access_token").and_then(Value::as_str) {
        let user = sign_in_with_token(token).await?;
        return Ok(DevicePoll::Done { user });
    }
    match v.get("error").and_then(Value::as_str) {
        Some("authorization_pending") => Ok(DevicePoll::Pending),
        Some("slow_down") => Ok(DevicePoll::SlowDown {
            interval: v.get("interval").and_then(Value::as_u64).unwrap_or(10),
        }),
        Some("expired_token") => Err(Error::GitHub("The code expired. Start again.".into())),
        Some("access_denied") => Err(Error::GitHub("Sign-in was cancelled.".into())),
        _ => Err(Error::GitHub(
            v.get("error_description")
                .and_then(Value::as_str)
                .unwrap_or("GitHub sign-in failed")
                .to_string(),
        )),
    }
}

/// Validate `token` against the API and store it.
pub async fn sign_in_with_token(token: &str) -> Result<User> {
    let token = token.trim();
    if token.is_empty() {
        return Err(Error::Invalid("Token is empty".into()));
    }
    let user = Api::new(token.to_string()).user().await?;
    save_token(token)?;
    Ok(user)
}

// ---- REST -------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub login: String,
    pub name: Option<String>,
    #[serde(alias = "avatar_url")]
    pub avatar_url: String,
    #[serde(alias = "html_url")]
    pub html_url: String,
    /// OAuth scopes of the token (classic tokens and OAuth apps; `None` for fine-grained tokens).
    #[serde(default)]
    pub scopes: Option<Vec<String>>,
    /// Kind and expiry of the token used (never the token itself).
    #[serde(default, skip_deserializing)]
    pub token: crate::token::TokenInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    pub id: u64,
    pub key: String,
    pub title: String,
    #[serde(alias = "created_at", default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    #[serde(alias = "full_name")]
    pub full_name: String,
    pub name: String,
    pub description: Option<String>,
    pub private: bool,
    pub fork: bool,
    #[serde(alias = "clone_url")]
    pub clone_url: String,
    #[serde(alias = "ssh_url")]
    pub ssh_url: String,
    #[serde(alias = "html_url")]
    pub html_url: String,
    #[serde(alias = "default_branch")]
    pub default_branch: Option<String>,
    #[serde(alias = "updated_at")]
    pub updated_at: Option<String>,
    #[serde(alias = "stargazers_count", default)]
    pub stargazers_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub draft: bool,
    pub html_url: String,
    pub author: String,
    pub author_avatar: String,
    pub head_ref: String,
    pub head_repo: Option<String>,
    pub base_ref: String,
    pub updated_at: String,
}

fn pr_from(v: &Value) -> PullRequest {
    let s = |p: &str| {
        v.pointer(p)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    PullRequest {
        number: v.get("number").and_then(Value::as_u64).unwrap_or(0),
        title: s("/title"),
        state: s("/state"),
        draft: v.get("draft").and_then(Value::as_bool).unwrap_or(false),
        html_url: s("/html_url"),
        author: s("/user/login"),
        author_avatar: s("/user/avatar_url"),
        head_ref: s("/head/ref"),
        head_repo: v
            .pointer("/head/repo/full_name")
            .and_then(Value::as_str)
            .map(str::to_string),
        base_ref: s("/base/ref"),
        updated_at: s("/updated_at"),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPullRequest {
    pub owner: String,
    pub repo: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub head: String,
    pub base: String,
    #[serde(default)]
    pub draft: bool,
}

#[derive(Debug)]
pub struct Api {
    token: String,
}

impl Api {
    pub fn new(token: String) -> Self {
        Api { token }
    }

    /// Api for the stored token, or an error telling the user to sign in.
    pub fn stored() -> Result<Self> {
        load_token()?
            .map(Api::new)
            .ok_or_else(|| Error::GitHub("Not signed in to GitHub".into()))
    }

    async fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value> {
        Ok(self.request_full(method, path, body).await?.0)
    }

    async fn request_full(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<(Value, reqwest::header::HeaderMap)> {
        let mut req = client()?
            .request(method, format!("{API}{path}"))
            .bearer_auth(&self.token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(b) = body {
            req = req.json(&b);
        }
        let res = req.send().await?;
        let status = res.status();
        let headers = res.headers().clone();
        let v: Value = res.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            let mut msg = v
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("request failed")
                .to_string();
            if let Some(errs) = v.get("errors").and_then(Value::as_array) {
                let details: Vec<String> = errs
                    .iter()
                    .filter_map(|e| e.get("message").and_then(Value::as_str).map(str::to_string))
                    .collect();
                if !details.is_empty() {
                    msg = format!("{msg}: {}", details.join("; "));
                }
            }
            if status == reqwest::StatusCode::UNAUTHORIZED {
                msg = "GitHub rejected the token. Sign in again.".into();
            }
            return Err(Error::GitHub(format!("GitHub {}: {msg}", status.as_u16())));
        }
        Ok((v, headers))
    }

    pub async fn user(&self) -> Result<User> {
        let (v, headers) = self
            .request_full(reqwest::Method::GET, "/user", None)
            .await?;
        let mut user: User = serde_json::from_value(v)?;
        user.scopes = headers
            .get("x-oauth-scopes")
            .and_then(|h| h.to_str().ok())
            .map(|s| {
                s.split(',')
                    .map(|x| x.trim().to_string())
                    .filter(|x| !x.is_empty())
                    .collect()
            });
        user.token = crate::token::TokenInfo {
            kind: crate::token::github_kind(&self.token),
            // Sent for tokens with an expiry date (fine-grained, classic with expiry, app tokens).
            expires_at: headers
                .get("github-authentication-token-expiration")
                .and_then(|h| h.to_str().ok())
                .and_then(crate::token::parse_github_expiration),
            expiry_unknown: false,
        };
        Ok(user)
    }

    pub async fn keys(&self) -> Result<Vec<SshKey>> {
        let v = self
            .request(reqwest::Method::GET, "/user/keys?per_page=100", None)
            .await
            .map_err(scope_hint)?;
        Ok(serde_json::from_value(v)?)
    }

    pub async fn add_key(&self, title: &str, key: &str) -> Result<SshKey> {
        let key = key.trim();
        if !key.starts_with("ssh-") && !key.starts_with("ecdsa-") && !key.starts_with("sk-") {
            return Err(Error::Invalid(
                "That does not look like an SSH public key".into(),
            ));
        }
        let v = self
            .request(
                reqwest::Method::POST,
                "/user/keys",
                Some(json!({ "title": title.trim(), "key": key })),
            )
            .await
            .map_err(scope_hint)?;
        Ok(serde_json::from_value(v)?)
    }

    pub async fn delete_key(&self, id: u64) -> Result<()> {
        self.request(reqwest::Method::DELETE, &format!("/user/keys/{id}"), None)
            .await
            .map_err(scope_hint)?;
        Ok(())
    }

    pub async fn repos(&self, page: u32) -> Result<Vec<RepoSummary>> {
        let v = self
            .request(
                reqwest::Method::GET,
                &format!("/user/repos?per_page=100&sort=updated&page={page}&affiliation=owner,collaborator,organization_member"),
                None,
            )
            .await?;
        Ok(serde_json::from_value(v)?)
    }

    pub async fn pulls(&self, owner: &str, repo: &str) -> Result<Vec<PullRequest>> {
        let v = self
            .request(
                reqwest::Method::GET,
                &format!(
                    "/repos/{}/{}/pulls?state=open&per_page=100",
                    seg(owner)?,
                    seg(repo)?
                ),
                None,
            )
            .await?;
        Ok(v.as_array()
            .map(|a| a.iter().map(pr_from).collect())
            .unwrap_or_default())
    }

    pub async fn create_pull(&self, pr: &NewPullRequest) -> Result<PullRequest> {
        if pr.title.trim().is_empty() {
            return Err(Error::Invalid("Pull request title is empty".into()));
        }
        let v = self
            .request(
                reqwest::Method::POST,
                &format!("/repos/{}/{}/pulls", seg(&pr.owner)?, seg(&pr.repo)?),
                Some(json!({
                    "title": pr.title,
                    "body": pr.body,
                    "head": pr.head,
                    "base": pr.base,
                    "draft": pr.draft,
                })),
            )
            .await?;
        Ok(pr_from(&v))
    }

    pub async fn create_repo(
        &self,
        name: &str,
        description: &str,
        private: bool,
    ) -> Result<RepoSummary> {
        let v = self
            .request(
                reqwest::Method::POST,
                "/user/repos",
                Some(json!({ "name": name, "description": description, "private": private })),
            )
            .await?;
        Ok(serde_json::from_value(v)?)
    }
}

/// GitHub answers 404/403 when the token lacks the SSH-key scope; say so.
fn scope_hint(e: Error) -> Error {
    match e {
        Error::GitHub(m) if m.contains(" 404") || m.contains(" 403") => Error::GitHub(format!(
            "{m}

Managing SSH keys needs the admin:public_key scope (classic token or browser              sign-in), or the \"Git SSH keys\" permission (fine-grained token). Sign in again with              that permission."
        )),
        other => other,
    }
}

/// Sign in with a token this machine already has: GitHub CLI (`gh`) or Git's credential helper
/// (Git Credential Manager on Windows). Nothing is shown to the user; the token is validated and
/// stored like a pasted one.
pub async fn import_token(source: &str) -> Result<User> {
    let token = match source {
        "gh" => {
            let mut cmd = tokio::process::Command::new("gh");
            cmd.args(["auth", "token", "--hostname", "github.com"])
                .stdin(std::process::Stdio::null())
                .kill_on_drop(true);
            #[cfg(windows)]
            {
                cmd.creation_flags(0x0800_0000);
            }
            let out = cmd
                .output()
                .await
                .map_err(|_| Error::GitHub("GitHub CLI (gh) is not installed".into()))?;
            if !out.status.success() {
                return Err(Error::GitHub(
                    "GitHub CLI is not signed in. Run `gh auth login` first.".into(),
                ));
            }
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        }
        "git" => {
            let out = crate::git::run::raw(
                None,
                &["credential", "fill"],
                crate::git::run::Opts {
                    stdin: Some(
                        b"protocol=https
host=github.com

",
                    ),
                    // Never pop up a sign-in window; only read what is already stored.
                    env: vec![("GCM_INTERACTIVE".into(), "never".into())],
                },
            )
            .await?;
            let text = out.text();
            let pw = text
                .lines()
                .find_map(|l| l.strip_prefix("password="))
                .map(str::to_string);
            match pw {
                Some(p) if out.code == 0 && !p.is_empty() => p,
                _ => {
                    return Err(Error::GitHub(
                        "Git has no stored GitHub credentials on this machine".into(),
                    ));
                }
            }
        }
        _ => return Err(Error::Invalid(format!("Unknown source {source}"))),
    };
    sign_in_with_token(&token).await
}

/// One URL path segment (owner or repo name).
fn seg(s: &str) -> Result<&str> {
    if s.is_empty()
        || !s
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    {
        return Err(Error::Invalid(format!("Invalid GitHub name {s:?}")));
    }
    Ok(s)
}
