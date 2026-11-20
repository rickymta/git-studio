//! Status for file-manager overlay icons (Explorer, Finder, Nautilus/Nemo/Caja), like TortoiseGit.
//!
//! The file managers never run git themselves: GitStudio (the app, or `GitStudio --overlay-serve`
//! started at login) refreshes `overlay-status.json` in the config folder every few seconds, and
//! each platform's extension only reads that file. Repositories covered: the recent list, the
//! workspaces, and any other repository next to them (siblings in the same parent folder).
//!
//! Inside a repository every tracked file and folder gets a badge too, like TortoiseGit: for each
//! repository `overlay/<id>.json` lists the changed / conflicted paths and `overlay/<id>.files`
//! the tracked files (`git ls-files`, rewritten only when the index changes). Ignored and
//! untracked files get no badge.

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
    /// Normalised repository path → id of its detail files in `overlay/` (see `RepoDetail`).
    #[serde(default)]
    pub details: BTreeMap<String, String>,
}

/// `overlay/<id>.json`: what is inside one repository.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoDetail {
    pub root: String,
    /// Changed (`changed`) or conflicted (`danger`) paths, relative with `/`. Folders above them
    /// take the most serious level of their contents.
    pub dirty: BTreeMap<String, Level>,
    /// Modification time (ms) of the index when `<id>.files` was written.
    pub index_mtime: i64,
}

/// Folder holding the per-repository detail files.
pub fn details_dir() -> PathBuf {
    settings::dir().join("overlay")
}

/// Stable id of a repository's detail files (FNV-1a of its key).
pub fn detail_id(key: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in key.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
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

/// Records of `git status --porcelain=v2 -z`: the repository's level and its changed paths.
pub fn parse_status_z(out: &[u8], in_progress: bool) -> (Level, BTreeMap<String, Level>) {
    let text = String::from_utf8_lossy(out);
    let mut records = text.split('\0').filter(|r| !r.is_empty());
    let mut lines = Vec::new();
    let mut dirty = BTreeMap::new();
    while let Some(r) = records.next() {
        lines.push(r.to_string());
        let (path, level) = if r.starts_with("1 ") {
            (r.splitn(9, ' ').nth(8), Level::Changed)
        } else if r.starts_with("2 ") {
            // A rename / copy: the original path follows as its own record.
            records.next();
            (r.splitn(10, ' ').nth(9), Level::Changed)
        } else if r.starts_with("u ") {
            (r.splitn(11, ' ').nth(10), Level::Danger)
        } else {
            (None, Level::Clean)
        };
        if let Some(p) = path {
            dirty.insert(p.to_string(), level);
        }
    }
    (parse_level(&lines.join("\n"), in_progress), dirty)
}

fn mtime_ms(p: &Path) -> i64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Write `<id>.json` (only when it changed) and `<id>.files` (only when the index changed).
fn write_detail(
    dir: &Path,
    root: &Path,
    gd: &Path,
    dirty: BTreeMap<String, Level>,
) -> Option<String> {
    let k = key(root);
    let id = detail_id(&k);
    fs::create_dir_all(dir).ok()?;
    let json = dir.join(format!("{id}.json"));
    let files = dir.join(format!("{id}.files"));
    let index_mtime = mtime_ms(&gd.join("index"));
    let previous: Option<RepoDetail> = fs::read(&json)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok());
    if previous.as_ref().map(|p| p.index_mtime) != Some(index_mtime) || !files.exists() {
        let out = git(root).args(["ls-files", "-z"]).output().ok()?;
        if !out.status.success() {
            return None;
        }
        let list = String::from_utf8_lossy(&out.stdout).replace('\0', "\n");
        let tmp = files.with_extension(format!("{}.tmp", std::process::id()));
        fs::write(&tmp, list).ok()?;
        fs::rename(&tmp, &files).ok()?;
    }
    let detail = RepoDetail {
        root: k,
        dirty,
        index_mtime,
    };
    if previous.as_ref() != Some(&detail) {
        let tmp = json.with_extension(format!("{}.tmp", std::process::id()));
        fs::write(&tmp, serde_json::to_vec(&detail).ok()?).ok()?;
        fs::rename(&tmp, &json).ok()?;
    }
    Some(id)
}

/// Level of the repository whose working tree is `root`; `None` if it is not one.
pub fn repo_level(root: &Path) -> Option<Level> {
    repo_status(root, None).map(|(l, _)| l)
}

/// Level of the repository at `root`, and (with `details`) its detail files' id.
fn repo_status(root: &Path, details: Option<&Path>) -> Option<(Level, Option<String>)> {
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
            "-z",
            "--branch",
            "--untracked-files=normal",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let (level, dirty) = parse_status_z(&out.stdout, in_progress);
    let id = details.and_then(|d| write_detail(d, root, &gd, dirty));
    Some((level, id))
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
    compute_with(roots, None).0
}

type Computed = (BTreeMap<String, Level>, BTreeMap<String, String>);

/// Levels, and with `details` the detail files of every repository (key → id).
fn compute_with(roots: &[PathBuf], details: Option<&Path>) -> Computed {
    let mut levels = BTreeMap::new();
    let mut ids = BTreeMap::new();
    for chunk in roots.chunks(6) {
        let handles: Vec<_> = chunk
            .iter()
            .map(|r| {
                let r = r.clone();
                let d = details.map(Path::to_path_buf);
                std::thread::spawn(move || (key(&r), repo_status(&r, d.as_deref())))
            })
            .collect();
        for h in handles {
            if let Ok((k, Some((level, id)))) = h.join() {
                if let Some(id) = id {
                    ids.insert(k.clone(), id);
                }
                levels.insert(k, level);
            }
        }
    }
    (levels, ids)
}

pub fn read() -> Option<StatusFile> {
    serde_json::from_slice(&fs::read(status_file()).ok()?).ok()
}

fn write_to(
    file: &Path,
    repos: BTreeMap<String, Level>,
    details: BTreeMap<String, String>,
) -> Result<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let data = StatusFile {
        version: 1,
        updated: now_ms(),
        pid: std::process::id(),
        repos,
        exe: crate::shell_menu::exe(),
        details,
    };
    // One temp file per process: the app and the sign-in agent may write at the same moment.
    let tmp = file.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&tmp, serde_json::to_vec(&data)?)?;
    fs::rename(&tmp, file)?;
    Ok(())
}

/// Rebuild the status file now. Returns the number of repositories found.
pub fn refresh() -> Result<usize> {
    let (repos, details) = compute_with(&roots(), Some(&details_dir()));
    let n = repos.len();
    write_to(&status_file(), repos, details)?;
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
        let details = dir.path().join("overlay");
        let (levels, ids) = compute_with(std::slice::from_ref(&r), Some(&details));
        write_to(&file, levels, ids).unwrap();
        let f: StatusFile = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(f.repos.get(&key(&r)), Some(&Level::Changed));

        // Per-file detail: the changed file and the tracked list.
        let id = f.details.get(&key(&r)).unwrap();
        let d: RepoDetail =
            serde_json::from_slice(&fs::read(details.join(format!("{id}.json"))).unwrap()).unwrap();
        assert_eq!(d.dirty.get("a"), Some(&Level::Changed));
        let tracked = fs::read_to_string(details.join(format!("{id}.files"))).unwrap();
        assert_eq!(tracked.trim(), "a");
    }

    #[test]
    fn status_records() {
        let out = b"# branch.oid abc\0# branch.head main\0\
1 .M N... 100644 100644 100644 a b src/my file.rs\0\
2 R. N... 100644 100644 100644 a b R100 docs/new.md\0docs/old.md\0\
u UU N... 100644 100644 100644 100644 a b c lib/conflict.rs\0\
? untracked.txt\0";
        let (level, dirty) = parse_status_z(out, false);
        assert_eq!(level, Level::Danger);
        assert_eq!(dirty.get("src/my file.rs"), Some(&Level::Changed));
        assert_eq!(dirty.get("docs/new.md"), Some(&Level::Changed));
        assert_eq!(dirty.get("lib/conflict.rs"), Some(&Level::Danger));
        assert!(!dirty.contains_key("docs/old.md"));
        assert!(!dirty.contains_key("untracked.txt"));
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
