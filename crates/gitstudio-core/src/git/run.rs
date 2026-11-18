//! Spawning the `git` executable.

use std::path::Path;
use std::process::Stdio;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::error::{Error, Result};

/// Raw result of a `git` invocation.
#[derive(Debug)]
pub struct Output {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub code: i32,
}

impl Output {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
}

/// Options for one invocation.
#[derive(Debug, Default, Clone)]
pub struct Opts<'a> {
    pub stdin: Option<&'a [u8]>,
    /// Extra environment variables (e.g. the GitHub auth header).
    pub env: Vec<(String, String)>,
}

/// Run `git <args>` in `cwd` and return its raw output, whatever the exit code.
pub async fn raw(cwd: Option<&Path>, args: &[&str], opts: Opts<'_>) -> Result<Output> {
    let mut cmd = Command::new("git");
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    // Stable, machine-readable output and never block on an interactive prompt or editor.
    cmd.args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .env("LC_ALL", "C")
        .env("LANGUAGE", "en")
        .stdin(if opts.stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for (k, v) in &opts.env {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: no console flashing up for every git call.
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = cmd.spawn().map_err(|e| Error::GitMissing(e.to_string()))?;
    if let Some(input) = opts.stdin {
        if let Some(mut pipe) = child.stdin.take() {
            pipe.write_all(input).await?;
            pipe.shutdown().await?;
        }
    }
    let out = child.wait_with_output().await?;
    Ok(Output {
        stdout: out.stdout,
        stderr: String::from_utf8_lossy(&out.stderr).trim().to_string(),
        code: out.status.code().unwrap_or(-1),
    })
}

/// Run `git <args>` and fail with its stderr when it exits non-zero.
pub async fn ok(cwd: &Path, args: &[&str], opts: Opts<'_>) -> Result<Output> {
    let out = raw(Some(cwd), args, opts).await?;
    if out.code != 0 {
        return Err(failure(&out));
    }
    Ok(out)
}

/// Shorthand: run and return stdout as text.
pub async fn text(cwd: &Path, args: &[&str]) -> Result<String> {
    Ok(ok(cwd, args, Opts::default()).await?.text())
}

pub fn failure(out: &Output) -> Error {
    let mut msg = out.stderr.clone();
    if msg.is_empty() {
        msg = String::from_utf8_lossy(&out.stdout).trim().to_string();
    }
    if msg.is_empty() {
        msg = format!("git exited with code {}", out.code);
    }
    Error::Git(msg)
}
