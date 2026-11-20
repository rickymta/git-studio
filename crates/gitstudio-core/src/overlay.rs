//! Status for file-manager overlay icons (Explorer, Finder, Nautilus/Nemo/Caja), like TortoiseGit.
//!
//! The file managers never run git themselves: GitStudio (the app, or `GitStudio --overlay-serve`
//! started at login) refreshes `overlay-status.json` in the config folder every few seconds, and
//! each platform's extension only reads that file. Repositories covered: the recent list, the
//! workspaces, and any other repository next to them (siblings in the same parent folder).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::{settings, workspace};

/// How often the status file is rebuilt.
pub const INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    /// Tracked, nothing to commit, in sync with its upstream (green).
    Clean,
    /// Uncommitted changes, or commits to push / pull (orange).
    Changed,
    /// Conflicts, an unfinished merge / rebase / cherry-pick, or a deleted upstream (red).
    Danger,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusFile {
    pub version: u32,
    /// Unix time in milliseconds of the last refresh.
    pub updated: i64,
    /// Process that wrote it (several writers take turns, see `serve`).
    pub pid: u32,
    /// Normalised repository path (see `key`) → level.
    pub repos: BTreeMap<String, Level>,
    /// GitStudio's program, for the Linux file-manager menu ("Open with GitStudio" …).
    #[serde(default)]
    pub exe: Option<String>,
}

pub fn status_file() -> PathBuf {
    settings::dir().join("overlay-status.json")
}

/// The form both the writer and the extensions compare paths in: separators of the platform,
/// no trailing separator, and lower case on the case-insensitive file systems (Windows, macOS).
pub fn key(path: &Path) -> String {
    let mut s = path.display().to_string();
    if cfg!(windows) {
        s = s.replace('/', "\\");
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            s = rest.to_string();
        }
    }
    while s.len() > 1 && (s.ends_with('/') || s.ends_with('\\')) && !s.ends_with(":\\") {
        s.pop();
    }
    if cfg!(any(windows, target_os = "macos")) {
        s = s.to_lowercase();
    }
    s
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn git(dir: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir);
    // Read-only, and never take the index lock another git process may hold.
    cmd.env("GIT_OPTIONAL_LOCKS", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: the background refresher must not flash consoles.
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// The `.git` directory of a working tree (`.git` may be a file pointing elsewhere: worktrees,
/// submodules).
fn git_dir(root: &Path) -> Option<PathBuf> {
    let dot = root.join(".git");
    if dot.is_dir() {
        return Some(dot);
    }
    let text = fs::read_to_string(&dot).ok()?;
    let p = PathBuf::from(text.trim().strip_prefix("gitdir:")?.trim());
    Some(if p.is_absolute() { p } else { root.join(p) })
}

/// Level from `git status --porcelain=v2 --branch` plus the in-progress operation markers.
pub fn parse_level(porcelain: &str, in_progress: bool) -> Level {
    if in_progress {
        return Level::Danger;
    }
    let mut changed = false;
    let mut has_upstream = false;
    let mut has_ab = false;
    for line in porcelain.lines() {
        if line.starts_with("u ") {
            return Level::Danger;
        }
        if line.starts_with("1 ") || line.starts_with("2 ") || line.starts_with("? ") {
            changed = true;
        } else if line.starts_with("# branch.upstream ") {
            has_upstream = true;
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            has_ab = true;
            if ab.split_whitespace().any(|n| n != "+0" && n != "-0") {
                changed = true;
            }
        }
    }
    // An upstream with no ahead/behind line means the remote branch is gone.
    if has_upstream && !has_ab {
        return Level::Danger;
    }
    if changed {
        Level::Changed
    } else {
        Level::Clean
    }
}

/// Level of the repository whose working tree is `root`; `None` if it is not one.
pub fn repo_level(root: &Path) -> Option<Level> {
    let gd = git_dir(root)?;
    let in_progress = [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-merge",
        "rebase-apply",
    ]
    .iter()
    .any(|m| gd.join(m).exists());
    let out = git(root)
        .args([
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=normal",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(parse_level(
        &String::from_utf8_lossy(&out.stdout),
        in_progress,
    ))
}

fn is_repo(dir: &Path) -> bool {
    dir.join(".git").exists()
}

/// Repositories to watch: recent ones, workspace members and their sibling repositories.
pub fn roots() -> Vec<PathBuf> {
    let mut known: Vec<PathBuf> = settings::load()
        .recent
        .into_iter()
        .map(|r| PathBuf::from(r.path))
        .collect();
    for w in workspace::load().items {
        known.extend(w.repos.into_iter().map(PathBuf::from));
    }
    let mut out: BTreeMap<String, PathBuf> = BTreeMap::new();
    let mut parents: BTreeMap<String, PathBuf> = BTreeMap::new();
    for p in known {
        if is_repo(&p) {
            if let Some(parent) = p.parent() {
                parents.insert(key(parent), parent.to_path_buf());
            }
            out.insert(key(&p), p);
        }
    }
    for parent in parents.values() {
        let Ok(rd) = fs::read_dir(parent) else {
            continue;
        };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() && is_repo(&p) {
                out.entry(key(&p)).or_insert(p);
            }
        }
    }
    out.into_values().collect()
}

/// Levels for `roots`, a few repositories at a time.
pub fn compute(roots: &[PathBuf]) -> BTreeMap<String, Level> {
    let mut map = BTreeMap::new();
    for chunk in roots.chunks(6) {
        let handles: Vec<_> = chunk
            .iter()
            .map(|r| {
                let r = r.clone();
                std::thread::spawn(move || (key(&r), repo_level(&r)))
            })
            .collect();
        for h in handles {
            if let Ok((k, Some(level))) = h.join() {
                map.insert(k, level);
            }
        }
    }
    map
}

pub fn read() -> Option<StatusFile> {
    serde_json::from_slice(&fs::read(status_file()).ok()?).ok()
}

fn write_to(file: &Path, repos: BTreeMap<String, Level>) -> Result<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let data = StatusFile {
        version: 1,
        updated: now_ms(),
        pid: std::process::id(),
        repos,
        exe: crate::shell_menu::exe(),
    };
    // One temp file per process: the app and the sign-in agent may write at the same moment.
    let tmp = file.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&tmp, serde_json::to_vec(&data)?)?;
    fs::rename(&tmp, file)?;
    Ok(())
}

/// Rebuild the status file now. Returns the number of repositories found.
pub fn refresh() -> Result<usize> {
    let repos = compute(&roots());
    let n = repos.len();
    write_to(&status_file(), repos)?;
    Ok(n)
}

/// Whether another process refreshed the file recently (so this one can skip a round).
fn other_writer_active() -> bool {
    read().is_some_and(|f| {
        f.pid != std::process::id() && now_ms() - f.updated < (INTERVAL.as_millis() as i64) * 2
    })
}

/// Refresh forever (the login agent, `GitStudio --overlay-serve`). Stops when the overlays are
/// turned off in Preferences.
pub fn serve() {
    let mut off = 0;
    loop {
        // settings.json may be read while it is being rewritten (falls back to defaults): only
        // stop after the preference reads "off" several times in a row.
        match enabled_in_settings() {
            Some(false) => off += 1,
            _ => off = 0,
        }
        if off >= 3 {
            return;
        }
        if !other_writer_active() {
            let _ = refresh();
        }
        std::thread::sleep(INTERVAL);
    }
}

/// `overlayIcons` from settings.json; `None` when the file cannot be read or parsed right now.
fn enabled_in_settings() -> Option<bool> {
    let bytes = fs::read(settings::dir().join("settings.json")).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    Some(
        v.get("overlayIcons")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    )
}

/// One round for the app's own background thread, used while GitStudio is open.
pub fn tick() {
    if settings::load().overlay_icons && !other_writer_active() {
        let _ = refresh();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_from_porcelain() {
        let clean = "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n";
        assert_eq!(parse_level(clean, false), Level::Clean);
        assert_eq!(parse_level("# branch.head main\n", false), Level::Clean);
        let ahead = "# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -0\n";
        assert_eq!(parse_level(ahead, false), Level::Changed);
        let dirty = "# branch.head main\n1 .M N... 100644 100644 100644 a b f.txt\n";
        assert_eq!(parse_level(dirty, false), Level::Changed);
        assert_eq!(parse_level("? new.txt\n", false), Level::Changed);
        let conflict = "u UU N... 1 2 3 4 a b c f.txt\n";
        assert_eq!(parse_level(conflict, false), Level::Danger);
        let gone = "# branch.head main\n# branch.upstream origin/main\n";
        assert_eq!(parse_level(gone, false), Level::Danger);
        assert_eq!(parse_level(clean, true), Level::Danger);
    }

    #[test]
    fn real_repository_levels() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path().join("repo");
        fs::create_dir_all(&r).unwrap();
        let sh = |args: &[&str]| {
            assert!(
                Command::new("git")
                    .current_dir(&r)
                    .args(args)
                    .status()
                    .unwrap()
                    .success()
            )
        };
        sh(&["init", "-q", "-b", "main"]);
        fs::write(r.join("a"), "1").unwrap();
        sh(&["add", "."]);
        sh(&[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            "a",
        ]);
        assert_eq!(repo_level(&r), Some(Level::Clean));
        fs::write(r.join("a"), "2").unwrap();
        assert_eq!(repo_level(&r), Some(Level::Changed));
        assert_eq!(repo_level(dir.path()), None);

        let file = dir.path().join("overlay-status.json");
        write_to(&file, compute(std::slice::from_ref(&r))).unwrap();
        let f: StatusFile = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(f.repos.get(&key(&r)), Some(&Level::Changed));
    }

    #[test]
    fn keys_are_normalised() {
        if cfg!(windows) {
            assert_eq!(key(Path::new("H:/Work/Repo/")), r"h:\work\repo");
            assert_eq!(key(Path::new(r"\\?\C:\X")), r"c:\x");
            assert_eq!(key(Path::new("C:\\")), "c:\\");
        } else {
            assert_eq!(key(Path::new("/home/u/repo/")), "/home/u/repo");
        }
    }
}
