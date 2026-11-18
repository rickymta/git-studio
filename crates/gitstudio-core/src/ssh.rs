//! SSH keys: list the keys in ~/.ssh, generate new ones, test a host, and build the
//! `GIT_SSH_COMMAND` that makes git use the key chosen in Preferences.
//!
//! Uses the OpenSSH that ships with Git for Windows when present, so keys and known_hosts behave
//! exactly as they do for `git` itself.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::error::{Error, Result};
use crate::settings;

/// How git authenticates over SSH.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SshSettings {
    /// `system`: whatever `ssh` does on its own (~/.ssh/config, default keys, ssh-agent).
    /// `key`: always use `private_key`.
    pub mode: String,
    pub private_key: String,
    pub public_key: String,
}

impl Default for SshSettings {
    fn default() -> Self {
        SshSettings {
            mode: "system".into(),
            private_key: String::new(),
            public_key: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalKey {
    pub name: String,
    pub private_path: Option<String>,
    pub public_path: String,
    /// `ssh-ed25519`, `ssh-rsa`…
    pub key_type: String,
    pub comment: String,
    pub fingerprint: Option<String>,
    /// The public key line (safe to show and copy).
    pub public_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshInfo {
    pub settings: SshSettings,
    pub ssh_dir: String,
    pub ssh_version: Option<String>,
    pub keys: Vec<LocalKey>,
    /// The key git will use in `key` mode, when readable.
    pub current: Option<LocalKey>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    /// Account name reported by the host ("Hi <user>!").
    pub user: Option<String>,
    pub message: String,
}

pub fn ssh_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_default().join(".ssh")
}

/// `ssh`/`ssh-keygen` from Git for Windows (next to git), else from PATH.
async fn tool(name: &str) -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(out) = Command::new("git")
            .arg("--exec-path")
            .creation_flags(0x0800_0000)
            .output()
            .await
        {
            // …/Git/mingw64/libexec/git-core → …/Git/usr/bin/<name>.exe
            let exec = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
            if let Some(root) = exec.ancestors().nth(3) {
                let p = root.join("usr").join("bin").join(format!("{name}.exe"));
                if p.exists() {
                    return p;
                }
            }
        }
    }
    PathBuf::from(name)
}

fn command(path: PathBuf) -> Command {
    let mut c = Command::new(path);
    c.stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    {
        c.creation_flags(0x0800_0000);
    }
    c
}

/// Forward slashes and single quotes: `GIT_SSH_COMMAND` is run through a POSIX shell by git.
fn sh_quote(p: &str) -> String {
    format!("'{}'", p.replace('\\', "/").replace('\'', r"'\''"))
}

/// Extra environment for git network commands so SSH uses the configured key.
pub fn git_env() -> Vec<(String, String)> {
    let s = settings::load().ssh;
    if s.mode != "key" || s.private_key.trim().is_empty() {
        return Vec::new();
    }
    vec![(
        "GIT_SSH_COMMAND".into(),
        format!(
            // BatchMode: fail instead of waiting for a passphrase prompt nobody can answer.
            "ssh -i {} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
            sh_quote(s.private_key.trim())
        ),
    )]
}

async fn read_key(pub_path: &Path) -> Option<LocalKey> {
    let text = std::fs::read_to_string(pub_path).ok()?;
    let line = text
        .lines()
        .find(|l| !l.trim().is_empty())?
        .trim()
        .to_string();
    let mut parts = line.splitn(3, ' ');
    let key_type = parts.next()?.to_string();
    let _body = parts.next()?;
    let comment = parts.next().unwrap_or_default().to_string();
    let private = pub_path.with_extension("");
    let fingerprint = command(tool("ssh-keygen").await)
        .arg("-lf")
        .arg(pub_path)
        .output()
        .await
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .split_whitespace()
                .nth(1)
                .map(str::to_string)
        });
    Some(LocalKey {
        name: pub_path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default(),
        private_path: private.exists().then(|| private.display().to_string()),
        public_path: pub_path.display().to_string(),
        key_type,
        comment,
        fingerprint,
        public_key: line,
    })
}

pub async fn info() -> Result<SshInfo> {
    let s = settings::load().ssh;
    let dir = ssh_dir();
    let mut keys = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        let mut pubs: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "pub"))
            .collect();
        pubs.sort();
        for p in pubs {
            if let Some(k) = read_key(&p).await {
                keys.push(k);
            }
        }
    }
    let current = if s.mode == "key" && !s.private_key.is_empty() {
        let pub_path = if s.public_key.is_empty() {
            PathBuf::from(format!("{}.pub", s.private_key))
        } else {
            PathBuf::from(&s.public_key)
        };
        read_key(&pub_path).await
    } else {
        None
    };
    let ssh_version = command(tool("ssh").await)
        .arg("-V")
        .output()
        .await
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stderr).trim().to_string())
        .filter(|v| !v.is_empty());
    Ok(SshInfo {
        settings: s,
        ssh_dir: dir.display().to_string(),
        ssh_version,
        keys,
        current,
    })
}

/// Generate an ed25519 key pair at ~/.ssh/<name>. Never overwrites an existing file.
pub async fn generate(name: &str, comment: &str, passphrase: &str) -> Result<LocalKey> {
    let name = name.trim();
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        || name.starts_with('.')
    {
        return Err(Error::Invalid(
            "Key name may only contain letters, digits, '-', '_' and '.'".into(),
        ));
    }
    let dir = ssh_dir();
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(name);
    if path.exists() || path.with_extension("pub").exists() {
        return Err(Error::Invalid(format!(
            "{} already exists. Choose another name.",
            path.display()
        )));
    }
    let out = command(tool("ssh-keygen").await)
        .args([
            "-q",
            "-t",
            "ed25519",
            "-C",
            comment.trim(),
            "-N",
            passphrase,
            "-f",
        ])
        .arg(&path)
        .output()
        .await
        .map_err(|e| Error::Invalid(format!("ssh-keygen is not available: {e}")))?;
    if !out.status.success() {
        return Err(Error::Invalid(format!(
            "ssh-keygen failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    read_key(&PathBuf::from(format!("{}.pub", path.display())))
        .await
        .ok_or_else(|| Error::Invalid("The new key could not be read".into()))
}

/// `ssh -T git@<host>` with the configured key; GitHub answers "Hi <user>! …" (exit code 1).
pub async fn test(host: &str) -> Result<TestResult> {
    if host.is_empty()
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-.".contains(c))
    {
        return Err(Error::Invalid(format!("Invalid host {host:?}")));
    }
    let s = settings::load().ssh;
    let mut cmd = command(tool("ssh").await);
    cmd.args([
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=10",
    ]);
    if s.mode == "key" && !s.private_key.is_empty() {
        cmd.arg("-i")
            .arg(&s.private_key)
            .args(["-o", "IdentitiesOnly=yes"]);
    }
    cmd.arg(format!("git@{host}"));
    let out = tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output())
        .await
        .map_err(|_| Error::Invalid("SSH connection timed out".into()))?
        .map_err(|e| Error::Invalid(format!("ssh is not available: {e}")))?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
    .trim()
    .to_string();
    let ok = text.contains("successfully authenticated");
    let user = text
        .split("Hi ")
        .nth(1)
        .and_then(|r| r.split('!').next())
        .map(str::to_string)
        .filter(|_| ok);
    let message = if ok {
        text
    } else if text.contains("Permission denied") {
        format!(
            "{text}\n\nThe key was not accepted. Add its public key to your GitHub account, or choose another key."
        )
    } else if text.contains("passphrase") || text.contains("bad permissions") {
        format!(
            "{text}\n\nLoad passphrase-protected keys into ssh-agent and use the system SSH setting."
        )
    } else {
        text
    };
    Ok(TestResult { ok, user, message })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoting_for_git_ssh_command() {
        assert_eq!(sh_quote(r"C:\Users\a b\.ssh\id"), "'C:/Users/a b/.ssh/id'");
        assert_eq!(sh_quote("/x/it's"), r"'/x/it'\''s'");
    }
}
