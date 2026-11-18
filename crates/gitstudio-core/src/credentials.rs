//! Stored HTTPS credentials (whatever `credential.helper` is configured: Git Credential
//! Manager, store, wincred…). Passwords never leave this module towards the UI: only whether
//! something is stored, and the username.

use serde::Serialize;

use crate::error::{Error, Result};
use crate::git::run::{self, Opts};
use crate::git::{Repo, parse};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostCredential {
    pub host: String,
    /// Remotes of the open repository that use this host.
    pub remotes: Vec<String>,
    pub stored: bool,
    pub username: Option<String>,
}

fn check_host(host: &str) -> Result<()> {
    if host.is_empty()
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-.:_".contains(c))
    {
        return Err(Error::Invalid(format!("Invalid host {host:?}")));
    }
    Ok(())
}

fn check_line(v: &str, what: &str) -> Result<()> {
    if v.contains(['\n', '\r', '\0']) {
        return Err(Error::Invalid(format!("{what} must be on one line")));
    }
    Ok(())
}

/// Ask the helper without ever prompting (no terminal, no GCM window).
fn quiet<'a>(stdin: &'a [u8]) -> Opts<'a> {
    Opts {
        stdin: Some(stdin),
        env: vec![("GCM_INTERACTIVE".into(), "never".into())],
    }
}

fn https_host(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let rest = rest.split('/').next()?;
    let host = rest.rsplit('@').next()?;
    (!host.is_empty()).then(|| host.to_string())
}

pub async fn status(host: &str) -> Result<(bool, Option<String>)> {
    check_host(host)?;
    let input = format!("protocol=https\nhost={host}\n\n");
    let out = run::raw(None, &["credential", "fill"], quiet(input.as_bytes())).await?;
    if out.code != 0 {
        return Ok((false, None));
    }
    let text = out.text();
    let field = |k: &str| {
        text.lines()
            .find_map(|l| l.strip_prefix(k))
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    };
    Ok((field("password=").is_some(), field("username=")))
}

/// Hosts worth showing: the open repository's HTTPS remotes, plus github.com and gitlab.com.
pub async fn hosts(repo: Option<&Repo>) -> Result<Vec<HostCredential>> {
    let mut list: Vec<HostCredential> = Vec::new();
    let mut add = |host: String, remote: Option<String>| {
        if let Some(h) = list.iter_mut().find(|h| h.host.eq_ignore_ascii_case(&host)) {
            if let Some(r) = remote {
                h.remotes.push(r);
            }
        } else {
            list.push(HostCredential {
                host,
                remotes: remote.into_iter().collect(),
                stored: false,
                username: None,
            });
        }
    };
    if let Some(r) = repo {
        let text = run::text(&r.root, &["remote", "-v"]).await?;
        for remote in parse::parse_remotes(&text) {
            if let Some(h) = https_host(&remote.url) {
                add(h, Some(remote.name));
            }
        }
    }
    add("github.com".into(), None);
    add("gitlab.com".into(), None);
    for h in &mut list {
        let (stored, username) = status(&h.host).await.unwrap_or((false, None));
        h.stored = stored;
        h.username = username;
    }
    Ok(list)
}

/// Store a username/password (or token) for `host` in the configured helper.
pub async fn save(host: &str, username: &str, password: &str) -> Result<()> {
    check_host(host)?;
    check_line(username, "Username")?;
    check_line(password, "Password")?;
    if username.is_empty() || password.is_empty() {
        return Err(Error::Invalid(
            "Enter a username and a password or token".into(),
        ));
    }
    let input =
        format!("protocol=https\nhost={host}\nusername={username}\npassword={password}\n\n");
    let out = run::raw(None, &["credential", "approve"], quiet(input.as_bytes())).await?;
    if out.code != 0 {
        return Err(run::failure(&out));
    }
    Ok(())
}

/// Remove the stored credential for `host`.
pub async fn erase(host: &str) -> Result<()> {
    check_host(host)?;
    let (_, username) = status(host).await?;
    let mut input = format!("protocol=https\nhost={host}\n");
    if let Some(u) = username {
        input.push_str(&format!("username={u}\n"));
    }
    input.push('\n');
    let out = run::raw(None, &["credential", "reject"], quiet(input.as_bytes())).await?;
    if out.code != 0 {
        return Err(run::failure(&out));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_of_urls() {
        assert_eq!(
            https_host("https://bob@git.example.com/a/b.git").as_deref(),
            Some("git.example.com")
        );
        assert_eq!(https_host("git@github.com:a/b.git"), None);
    }
}
