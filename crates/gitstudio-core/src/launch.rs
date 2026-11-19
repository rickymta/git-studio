//! What GitStudio was launched to do from a file manager's context menu:
//! `GitStudio --open <folder>` ("Open with GitStudio") and `GitStudio --clone <folder>`
//! ("Git Clone…", with the git URL currently on the clipboard, like TortoiseGit).
//! The shell queues the action; the UI takes it once it is ready (`app.takeLaunchActions`).

use std::process::Command;
use std::sync::Mutex;

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Action {
    /// Open this folder (a repository) in a tab.
    Open { path: String },
    /// Show the Clone dialog: clone into `dir`, from `url` when the clipboard held one.
    Clone { dir: String, url: Option<String> },
}

static PENDING: Mutex<Vec<Action>> = Mutex::new(Vec::new());

/// The action in a command line, if any (`--open <folder>`, `--clone <folder>`).
pub fn parse(args: &[String]) -> Option<Action> {
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--open" => {
                let path = clean(it.next()?);
                return Some(Action::Open { path });
            }
            "--clone" => {
                let dir = clean(it.next()?);
                return Some(Action::Clone {
                    dir,
                    url: clipboard_git_url(),
                });
            }
            _ => {}
        }
    }
    None
}

/// Explorer passes `%V` of a drive root as `C:\"` when quoted; drop stray quotes and slashes.
fn clean(p: &str) -> String {
    let p = p.trim().trim_matches('"');
    let trimmed = p.trim_end_matches(['\\', '/']);
    if trimmed.ends_with(':') {
        format!("{trimmed}\\")
    } else if trimmed.is_empty() {
        p.to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn push(action: Action) {
    PENDING
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .push(action);
}

pub fn take() -> Vec<Action> {
    std::mem::take(&mut *PENDING.lock().unwrap_or_else(|p| p.into_inner()))
}

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let mut c = Command::new(cmd);
    c.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let out = c.output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Text on the clipboard (first line), using the platform's own tools.
pub fn clipboard_text() -> Option<String> {
    let text = if cfg!(windows) {
        run(
            "powershell",
            &[
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-Clipboard -Raw",
            ],
        )
    } else if cfg!(target_os = "macos") {
        run("pbpaste", &[])
    } else {
        run("wl-paste", &["--no-newline"])
            .or_else(|| run("xclip", &["-selection", "clipboard", "-o"]))
            .or_else(|| run("xsel", &["--clipboard", "--output"]))
    }?;
    let line = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    Some(line.to_string())
}

/// Whether `s` looks like something `git clone` accepts from the web or SSH.
pub fn is_git_url(s: &str) -> bool {
    let s = s.trim();
    if s.contains(char::is_whitespace) || s.len() > 2048 {
        return false;
    }
    let scheme = ["https://", "http://", "ssh://", "git://", "git+ssh://"]
        .iter()
        .any(|p| s.starts_with(p) && s.len() > p.len() + 3 && s[p.len()..].contains('/'));
    // scp-like: git@github.com:owner/repo.git
    let scp = s
        .split_once('@')
        .and_then(|(user, rest)| (!user.is_empty() && !user.contains('/')).then_some(rest))
        .and_then(|rest| rest.split_once(':'))
        .is_some_and(|(host, path)| {
            host.contains('.') && !path.is_empty() && !path.starts_with('/')
        });
    scheme || scp
}

/// The clipboard's text when it is a git URL.
pub fn clipboard_git_url() -> Option<String> {
    clipboard_text().filter(|t| is_git_url(t))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_actions() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            parse(&a(&["gitstudio.exe", "--open", r"H:\Work\repo\"])),
            Some(Action::Open {
                path: r"H:\Work\repo".into()
            })
        );
        assert_eq!(
            parse(&a(&["gitstudio.exe", "--open", "C:\\\""])),
            Some(Action::Open {
                path: "C:\\".into()
            })
        );
        assert_eq!(parse(&a(&["gitstudio.exe"])), None);
        assert_eq!(parse(&a(&["gitstudio.exe", "--open"])), None);
        assert!(matches!(
            parse(&a(&["x", "--clone", "/home/u/src"])),
            Some(Action::Clone { dir, .. }) if dir == "/home/u/src"
        ));
    }

    #[test]
    fn recognises_git_urls() {
        for ok in [
            "https://github.com/owner/repo.git",
            "https://gitlab.com/group/sub/repo",
            "git@github.com:owner/repo.git",
            "ssh://git@host.example:2222/owner/repo.git",
        ] {
            assert!(is_git_url(ok), "{ok}");
        }
        for bad in [
            "",
            "hello world",
            "C:\\Users\\x",
            "https://",
            "owner/repo",
            "user@host",
        ] {
            assert!(!is_git_url(bad), "{bad}");
        }
    }

    #[test]
    fn queue() {
        push(Action::Open { path: "a".into() });
        push(Action::Open { path: "b".into() });
        assert_eq!(take().len(), 2);
        assert!(take().is_empty());
    }
}
