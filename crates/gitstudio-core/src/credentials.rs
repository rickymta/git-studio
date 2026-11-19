//! Stored HTTPS credentials (whatever `credential.helper` is configured: Git Credential
//! Manager, store, wincred…). Passwords never leave this module towards the UI: only whether
//! something is stored, and the usernames.
//!
//! A host can hold several accounts (e.g. two GitHub users in Git Credential Manager). Which one
//! git uses is chosen with the standard `credential.https://<host>.username` setting, for one
//! repository (`--local`) or for every repository (`--global`).

use std::path::Path;

use serde::Serialize;

use crate::error::{Error, Result};
use crate::git::run::{self, Opts};
use crate::git::{Repo, parse};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub username: String,
    /// The open repository is set to use this account.
    pub for_repo: bool,
    /// Chosen for every repository (global config).
    pub global_default: bool,
    /// What git uses for the host in a repository without its own choice (the global choice, or
    /// else the helper's default account).
    pub helper_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostCredential {
    pub host: String,
    /// Remotes of the open repository that use this host.
    pub remotes: Vec<String>,
    /// Something is stored for the account git would use here.
    pub stored: bool,
    /// The account git uses for this host in the open repository (or globally without one).
    pub username: Option<String>,
    /// Every account with a stored password or token for this host.
    pub accounts: Vec<Account>,
    /// `credential.https://<host>.username` of the open repository, if set.
    pub repo_choice: Option<String>,
    /// The same setting in the global config, if set.
    pub global_choice: Option<String>,
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

fn check_username(u: &str) -> Result<()> {
    check_line(u, "Username")?;
    if u.is_empty() || u.starts_with('-') || u.contains(['@', '/', ' ']) {
        return Err(Error::Invalid(format!("Invalid username {u:?}")));
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

/// Config key that picks the account git asks the helper for on `host`.
pub fn username_key(host: &str) -> String {
    format!("credential.https://{host}.username")
}

/// Whether the helper has a password for `host` (as `username`, or its default account), and
/// which username it answered with.
pub async fn status(host: &str, username: Option<&str>) -> Result<(bool, Option<String>)> {
    check_host(host)?;
    let mut input = format!("protocol=https\nhost={host}\n");
    if let Some(u) = username {
        check_username(u)?;
        input.push_str(&format!("username={u}\n"));
    }
    input.push('\n');
    // Outside any repository, so a repository's own account choice does not leak in (a global
    // `credential.https://<host>.username` still applies: that is the default account).
    let cwd = std::env::temp_dir();
    let out = run::raw(Some(&cwd), &["credential", "fill"], quiet(input.as_bytes())).await?;
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

/// Usernames in `git:https://<user>@<host>` targets of `cmdkey /list` (Windows Credential
/// Manager, used by GCM and wincred). Only target names are read, never secrets.
fn parse_cmdkey_users(text: &str, host: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let Some(i) = line.find("git:https://") else {
            continue;
        };
        let target = line[i + "git:https://".len()..].trim();
        let Some((user, rest)) = target.split_once('@') else {
            continue;
        };
        let target_host = rest.split('/').next().unwrap_or_default();
        if target_host.eq_ignore_ascii_case(host) && !user.is_empty() {
            out.push(user.to_string());
        }
    }
    out
}

/// Usernames for `host` in a `~/.git-credentials` file (`https://user:secret@host`).
fn parse_store_users(text: &str, host: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let Some(rest) = line
            .trim()
            .strip_prefix("https://")
            .or_else(|| line.trim().strip_prefix("http://"))
        else {
            continue;
        };
        let Some((auth, after)) = rest.rsplit_once('@') else {
            continue;
        };
        let target_host = after.split('/').next().unwrap_or_default();
        let user = auth.split(':').next().unwrap_or_default();
        if target_host.eq_ignore_ascii_case(host) && !user.is_empty() {
            out.push(user.to_string());
        }
    }
    out
}

async fn command_text(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args)
        .env("GCM_INTERACTIVE", "never")
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().await.ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Every username that may have something stored for `host`, from all places helpers keep them.
async fn candidate_users(host: &str) -> Vec<String> {
    let mut users = Vec::new();
    if host.eq_ignore_ascii_case("github.com") {
        // Git Credential Manager knows its GitHub accounts.
        if let Some(text) = command_text("git", &["credential-manager", "github", "list"]).await {
            users.extend(text.lines().map(str::trim).map(str::to_string));
        }
    }
    if cfg!(windows) {
        if let Some(text) = command_text("cmdkey", &["/list"]).await {
            users.extend(parse_cmdkey_users(&text, host));
        }
    }
    if let Some(home) = dirs::home_dir() {
        if let Ok(text) = std::fs::read_to_string(home.join(".git-credentials")) {
            users.extend(parse_store_users(&text, host));
        }
    }
    users
}

async fn config_value(cwd: Option<&Path>, scope: &str, key: &str) -> Option<String> {
    let out = run::raw(cwd, &["config", scope, "--get", key], Opts::default())
        .await
        .ok()?;
    let v = out.text().trim().to_string();
    (out.code == 0 && !v.is_empty()).then_some(v)
}

/// Accounts of one host, which of them git would use, and what is chosen where.
async fn describe(host: String, remotes: Vec<String>, repo: Option<&Repo>) -> HostCredential {
    let key = username_key(&host);
    let repo_choice = match repo {
        Some(r) => config_value(Some(&r.root), "--local", &key).await,
        None => None,
    };
    let global_choice = config_value(None, "--global", &key).await;
    let (default_stored, helper_default) = status(&host, None).await.unwrap_or((false, None));

    let mut names: Vec<String> = Vec::new();
    for u in candidate_users(&host)
        .await
        .into_iter()
        .chain(helper_default.clone())
        .chain(repo_choice.clone())
        .chain(global_choice.clone())
    {
        if check_username(&u).is_ok() && !names.iter().any(|n| n.eq_ignore_ascii_case(&u)) {
            names.push(u);
        }
    }
    let mut accounts = Vec::new();
    for name in names {
        // Keep only accounts the helper really has a secret for.
        let stored = if helper_default.as_deref() == Some(name.as_str()) && default_stored {
            true
        } else {
            status(&host, Some(&name))
                .await
                .map(|s| s.0)
                .unwrap_or(false)
        };
        if !stored {
            continue;
        }
        accounts.push(Account {
            for_repo: repo_choice.as_deref() == Some(name.as_str()),
            global_default: global_choice.as_deref() == Some(name.as_str()),
            helper_default: helper_default.as_deref() == Some(name.as_str()),
            username: name,
        });
    }

    let username = repo_choice
        .clone()
        .or_else(|| global_choice.clone())
        .or(helper_default);
    let stored = match &username {
        Some(u) => accounts.iter().any(|a| &a.username == u),
        None => default_stored,
    };
    HostCredential {
        host,
        remotes,
        stored,
        username,
        accounts,
        repo_choice,
        global_choice,
    }
}

/// Hosts worth showing: the open repository's HTTPS remotes, plus github.com and gitlab.com.
pub async fn hosts(repo: Option<&Repo>) -> Result<Vec<HostCredential>> {
    let mut list: Vec<(String, Vec<String>)> = Vec::new();
    let mut add = |host: String, remote: Option<String>| {
        if let Some(h) = list.iter_mut().find(|h| h.0.eq_ignore_ascii_case(&host)) {
            h.1.extend(remote);
        } else {
            list.push((host, remote.into_iter().collect()));
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
    let mut out = Vec::new();
    for (host, remotes) in list {
        if check_host(&host).is_ok() {
            out.push(describe(host, remotes, repo).await);
        }
    }
    Ok(out)
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

/// Remove the stored credential of `username` on `host` (the helper's default account if none).
pub async fn erase(host: &str, username: Option<&str>) -> Result<()> {
    check_host(host)?;
    let username = match username {
        Some(u) => Some(u.to_string()),
        None => status(host, None).await?.1,
    };
    let mut input = format!("protocol=https\nhost={host}\n");
    if let Some(u) = &username {
        check_username(u)?;
        input.push_str(&format!("username={u}\n"));
    }
    input.push('\n');
    let out = run::raw(None, &["credential", "reject"], quiet(input.as_bytes())).await?;
    if out.code != 0 {
        return Err(run::failure(&out));
    }
    Ok(())
}

/// Make git use `username` for `host` in `repo` (or in every repository when `repo` is None).
/// `None` removes the choice, so git falls back to the global choice or the helper's default.
pub async fn choose(repo: Option<&Repo>, host: &str, username: Option<&str>) -> Result<()> {
    check_host(host)?;
    let key = username_key(host);
    let scope = if repo.is_some() {
        "--local"
    } else {
        "--global"
    };
    let mut args = vec!["config", scope];
    match username {
        Some(u) => {
            check_username(u)?;
            args.extend([key.as_str(), u]);
        }
        None => args.extend(["--unset", key.as_str()]),
    }
    let out = run::raw(repo.map(|r| r.root.as_path()), &args, Opts::default()).await?;
    // 5: nothing to unset.
    if out.code != 0 && !(username.is_none() && out.code == 5) {
        return Err(run::failure(&out));
    }
    Ok(())
}

/// Whether an account is chosen for `host` where `cwd` is (repository or global config). When
/// one is, GitStudio leaves authentication to the credential helper instead of its own token.
pub async fn account_chosen(cwd: &Path, host: &str) -> bool {
    run::raw(
        Some(cwd),
        &["config", "--get", &username_key(host)],
        Opts::default(),
    )
    .await
    .is_ok_and(|o| o.code == 0 && !o.text().trim().is_empty())
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

    #[test]
    fn users_from_windows_credential_targets() {
        let text = "\
Target: LegacyGeneric:target=git:https://github.com
    Type: Generic
    User: alice
Target: LegacyGeneric:target=git:https://alice@github.com
    Type: Generic
    User: alice
Target: LegacyGeneric:target=git:https://bob@github.com
Target: LegacyGeneric:target=git:https://carol@gitlab.com
";
        assert_eq!(parse_cmdkey_users(text, "github.com"), ["alice", "bob"]);
        assert_eq!(parse_cmdkey_users(text, "gitlab.com"), ["carol"]);
    }

    #[test]
    fn users_from_store_file() {
        let text = "https://alice:tok1@github.com\nhttps://bob:p%40ss@github.com\n\
                    https://carol:x@gitlab.com\n";
        assert_eq!(parse_store_users(text, "github.com"), ["alice", "bob"]);
    }

    #[test]
    fn usernames_are_checked() {
        assert!(check_username("rickymta").is_ok());
        assert!(check_username("-x").is_err());
        assert!(check_username("a@b").is_err());
        assert!(check_username("a\nb").is_err());
    }
}
