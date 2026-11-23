//! Making a repository show up fast. Every `git` process costs ~80–100 ms on Windows before it
//! does anything, so what can be read straight from `.git` is read from files (HEAD, refs,
//! worktrees), repositories are opened once per session, and the commands the first screen needs
//! run together in one call (`load`). A `git status` that has become slow because the index's
//! file times are stale gets the index refreshed in the background.

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::files::Worktree;
use super::model::{Commit, Refs, RepoInfo, Status};
use super::{LogView, Repo};
use crate::error::Result;

// ---- opened repositories ------------------------------------------------------------------------

fn opened() -> &'static Mutex<HashMap<PathBuf, Repo>> {
    static OPENED: OnceLock<Mutex<HashMap<PathBuf, Repo>>> = OnceLock::new();
    OPENED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A repository opened earlier for `path`, if it is still there (its `.git` and git dir exist).
pub(super) fn cached(path: &Path) -> Option<Repo> {
    let r = opened().lock().ok()?.get(path).cloned()?;
    (r.root.join(".git").exists() && r.git_dir.is_dir()).then_some(r)
}

pub(super) fn remember(path: &Path, repo: &Repo) {
    if let Ok(mut m) = opened().lock() {
        if m.len() > 4096 {
            m.clear();
        }
        m.insert(path.to_path_buf(), repo.clone());
    }
}

// ---- HEAD and refs from files -------------------------------------------------------------------

/// The directory shared by all worktrees (refs, packed-refs, objects, worktrees/).
pub(super) fn common_dir(git_dir: &Path) -> PathBuf {
    std::fs::read_to_string(git_dir.join("commondir"))
        .map(|c| {
            let p = PathBuf::from(c.trim());
            if p.is_absolute() { p } else { git_dir.join(p) }
        })
        .unwrap_or_else(|_| git_dir.to_path_buf())
}

fn is_hash(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Commit a full ref name points at, from the loose file or `packed-refs`. `None` when it is not
/// there (unborn branch), and `Err(())` when the layout is one this does not read (reftable…).
fn resolve_ref(common: &Path, name: &str) -> std::result::Result<Option<String>, ()> {
    if common.join("reftable").exists() {
        return Err(());
    }
    if let Ok(s) = std::fs::read_to_string(common.join(name)) {
        let s = s.trim();
        if is_hash(s) {
            return Ok(Some(s.to_string()));
        }
        // A symbolic ref inside refs/: rare, let git handle it.
        return Err(());
    }
    if let Ok(packed) = std::fs::read_to_string(common.join("packed-refs")) {
        for line in packed.lines() {
            if let Some((hash, r)) = line.split_once(' ') {
                if r == name && is_hash(hash) {
                    return Ok(Some(hash.to_string()));
                }
            }
        }
    }
    Ok(None)
}

/// Branch (short name) and commit of the HEAD file in `git_dir`. `Err(())`: ask git instead.
fn read_head(git_dir: &Path) -> std::result::Result<(Option<String>, Option<String>), ()> {
    let head = std::fs::read_to_string(git_dir.join("HEAD")).map_err(|_| ())?;
    let head = head.trim();
    if let Some(r) = head.strip_prefix("ref: ") {
        let branch = r.strip_prefix("refs/heads/").map(str::to_string);
        let hash = resolve_ref(&common_dir(git_dir), r)?;
        Ok((branch, hash))
    } else if is_hash(head) {
        Ok((None, Some(head.to_string())))
    } else {
        Err(())
    }
}

impl Repo {
    /// What the toolbar needs right away (branch, HEAD, operation in progress), without running
    /// `git status`: the changed files arrive with `info()` a moment later.
    pub async fn info_quick(&self) -> Result<RepoInfo> {
        let (branch, head) = match read_head(&self.git_dir) {
            Ok(h) => h,
            Err(()) => return self.info().await,
        };
        Ok(RepoInfo {
            path: self.root.display().to_string(),
            name: self
                .root
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            git_dir: self.git_dir.display().to_string(),
            state: self.state(),
            status: Status {
                branch,
                head,
                ..Status::default()
            },
        })
    }

    /// The worktrees, read from `.git/worktrees` (same result as `git worktree list`), or from git
    /// when the layout is unusual.
    pub async fn worktrees(&self) -> Result<Vec<Worktree>> {
        match worktrees_from_files(&self.root, &self.git_dir) {
            Some(list) => Ok(list),
            None => self.worktrees_git().await,
        }
    }

    /// The first screen of a repository in one call: a page of history, the refs and the
    /// worktrees, read at the same time.
    pub async fn load(&self, limit: u32, skip: u32, view: &LogView) -> Result<Loaded> {
        let (commits, refs, worktrees) = tokio::join!(
            self.log_view(limit, skip, view),
            self.refs(),
            self.worktrees()
        );
        Ok(Loaded {
            commits: commits?,
            refs: refs?,
            worktrees: worktrees.unwrap_or_default(),
        })
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    pub commits: Vec<Commit>,
    pub refs: Refs,
    pub worktrees: Vec<Worktree>,
}

fn slashes(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => slashes(a).eq_ignore_ascii_case(&slashes(b)),
    }
}

/// `git worktree list` from the files under the common dir: the main worktree, then each linked
/// one (`worktrees/<name>/gitdir` points at its `.git` file). `None` for layouts this does not
/// read (bare repositories, reftable, symbolic refs…).
fn worktrees_from_files(root: &Path, git_dir: &Path) -> Option<Vec<Worktree>> {
    let common = common_dir(git_dir);
    if common.file_name()? != ".git" {
        return None; // bare or a separate git dir: let git describe it
    }
    let main_root = common.parent()?.to_path_buf();
    let mut out = Vec::new();
    let (branch, head) = read_head(&common).ok()?;
    out.push(Worktree {
        path: slashes(&main_root),
        head,
        branch,
        is_main: true,
        is_current: same_dir(&main_root, root),
        bare: false,
        locked: false,
        prunable: false,
    });
    let mut linked: Vec<(String, Worktree)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(common.join("worktrees")) {
        for e in entries.flatten() {
            let dir = e.path();
            if !dir.is_dir() {
                continue;
            }
            let gitdir = std::fs::read_to_string(dir.join("gitdir")).ok()?;
            let dot_git = PathBuf::from(gitdir.trim());
            let path = dot_git.parent()?.to_path_buf();
            let (branch, head) = read_head(&dir).ok()?;
            linked.push((
                e.file_name().to_string_lossy().into_owned(),
                Worktree {
                    path: slashes(&path),
                    head,
                    branch,
                    is_main: false,
                    is_current: same_dir(&path, root),
                    bare: false,
                    locked: dir.join("locked").exists(),
                    prunable: !dot_git.exists(),
                },
            ));
        }
    }
    // git lists linked worktrees by their admin folder's name.
    linked.sort_by(|a, b| a.0.cmp(&b.0));
    out.extend(linked.into_iter().map(|(_, w)| w));
    Some(out)
}

// ---- history order for very long histories ----------------------------------------------------------

/// Read the graph's history in `--date-order` (children always before parents)? Yes, unless
/// the history is very long and has no commit-graph yet: then `--date-order` reads every commit
/// before printing the first (minutes for tens of millions), so git's default order is used —
/// newest first as it walks, which puts a parent before a child only when commit times disagree
/// with the history — until the commit-graph being written in the background is there.
///
/// The choice is kept per repository from one first page (`fresh`, skip 0) to the next, so the
/// pages of one load all come in the same order.
pub(super) fn date_order(git_dir: &Path, fresh: bool) -> bool {
    static ORDER: OnceLock<Mutex<HashMap<PathBuf, bool>>> = OnceLock::new();
    let order = ORDER.get_or_init(|| Mutex::new(HashMap::new()));
    let Ok(mut m) = order.lock() else {
        return true;
    };
    if !fresh {
        if let Some(&d) = m.get(git_dir) {
            return d;
        }
    }
    let d = super::commit_graph::has_graph(git_dir) || !super::commit_graph::big_history(git_dir);
    m.insert(git_dir.to_path_buf(), d);
    d
}

// ---- keeping `git status` fast -------------------------------------------------------------------

/// A status slower than this suggests stale file times in the index (git re-reads the files).
const SLOW_STATUS: Duration = Duration::from_millis(250);
/// At most one background refresh per repository this often.
const REFRESH_EVERY: Duration = Duration::from_secs(10 * 60);

/// After a slow `git status`: refresh the index's file times in the background, once in a while.
///
/// GitStudio reads status with `--no-optional-locks` so it never takes the index lock from under
/// another git command, but that also means git never writes back what it learned: once the
/// index's file times are stale (a checkout, a line-ending change, files touched by a tool…),
/// every status re-reads the files (≈0.5 s on a few thousand files instead of ≈0.1 s).
/// `git update-index -q --refresh` writes them back. It takes the index lock for a moment, so it
/// only runs when nothing else holds it, at low priority, and a failure is ignored.
pub fn status_took(root: &Path, git_dir: &Path, took: Duration) {
    if took < SLOW_STATUS {
        return;
    }
    static LAST: OnceLock<Mutex<HashMap<PathBuf, Instant>>> = OnceLock::new();
    let last = LAST.get_or_init(|| Mutex::new(HashMap::new()));
    {
        let Ok(mut m) = last.lock() else { return };
        if m.get(git_dir).is_some_and(|t| t.elapsed() < REFRESH_EVERY) {
            return;
        }
        m.insert(git_dir.to_path_buf(), Instant::now());
    }
    if git_dir.join("index.lock").exists() {
        return;
    }
    let root = root.to_path_buf();
    std::thread::spawn(move || {
        let mut cmd = std::process::Command::new("git");
        cmd.arg("-C")
            .arg(&root)
            .args(["update-index", "-q", "--refresh"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS
            cmd.creation_flags(0x0800_0000 | 0x0000_4000);
        }
        let _ = cmd.status();
    });
}

// ---- noticing changes made outside the app -------------------------------------------------------

/// What git rewrites when refs move (`refs`: HEAD, branches, remotes, tags, packed-refs, a merge
/// or rebase starting or ending) and when the index is written (`index`), as two short
/// fingerprints of file times and sizes. Read from files only, with no git process, so every
/// open window can check it every few seconds and reload as soon as it changes (a merge in a
/// terminal, a fetch from another tool).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Stamp {
    pub refs: String,
    pub index: String,
}

/// Files seen and an order-free sum of (path, time, size) hashes.
#[derive(Default)]
struct Fingerprint {
    count: u64,
    sum: u64,
}

impl Fingerprint {
    fn add(&mut self, p: &Path) {
        let Ok(m) = std::fs::metadata(p) else { return };
        let nanos = m
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_nanos() as u64);
        let mut h = DefaultHasher::new();
        (p, nanos, m.len()).hash(&mut h);
        self.count += 1;
        self.sum = self.sum.wrapping_add(h.finish());
    }

    /// Every file under `dir` but lock files (a ref being written; the result follows).
    fn walk(&mut self, dir: &Path, depth: u8) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let p = e.path();
            match e.file_type() {
                Ok(t) if t.is_dir() => {
                    if depth < 32 {
                        self.walk(&p, depth + 1)
                    }
                }
                Ok(_) if p.extension().is_some_and(|x| x == "lock") => {}
                Ok(_) => self.add(&p),
                Err(_) => {}
            }
        }
    }

    fn text(&self) -> String {
        format!("{}:{:x}", self.count, self.sum)
    }
}

/// The change stamp of the repository whose git dir is `git_dir` (a linked worktree's refs live
/// in the common dir).
pub fn stamp(git_dir: &Path) -> Stamp {
    let common = common_dir(git_dir);
    let mut refs = Fingerprint::default();
    for name in [
        "HEAD",
        "ORIG_HEAD",
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "BISECT_LOG",
        "rebase-merge",
        "rebase-apply",
        "logs/HEAD",
    ] {
        refs.add(&git_dir.join(name));
    }
    refs.add(&common.join("packed-refs"));
    refs.walk(&common.join("refs"), 0);
    refs.walk(&common.join("reftable"), 0);
    if common != git_dir {
        refs.walk(&git_dir.join("refs"), 0);
    }
    let mut index = Fingerprint::default();
    index.add(&git_dir.join("index"));
    Stamp {
        refs: refs.text(),
        index: index.text(),
    }
}

impl Repo {
    /// See [`Stamp`].
    pub fn stamp(&self) -> Stamp {
        stamp(&self.git_dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_head_and_refs_from_files() {
        let tmp = tempfile::tempdir().unwrap();
        let g = tmp.path();
        std::fs::create_dir_all(g.join("refs/heads")).unwrap();
        let a = "a".repeat(40);
        let b = "b".repeat(40);
        std::fs::write(g.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(g.join("refs/heads/main"), format!("{a}\n")).unwrap();
        assert_eq!(read_head(g), Ok((Some("main".into()), Some(a.clone()))));
        // Packed ref.
        std::fs::write(g.join("HEAD"), "ref: refs/heads/dev\n").unwrap();
        std::fs::write(
            g.join("packed-refs"),
            format!("# pack-refs with: peeled fully-peeled sorted\n{b} refs/heads/dev\n"),
        )
        .unwrap();
        assert_eq!(read_head(g), Ok((Some("dev".into()), Some(b.clone()))));
        // Unborn branch, detached HEAD, unreadable layout.
        std::fs::write(g.join("HEAD"), "ref: refs/heads/none\n").unwrap();
        assert_eq!(read_head(g), Ok((Some("none".into()), None)));
        std::fs::write(g.join("HEAD"), format!("{a}\n")).unwrap();
        assert_eq!(read_head(g), Ok((None, Some(a))));
        std::fs::create_dir_all(g.join("reftable")).unwrap();
        std::fs::write(g.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        assert_eq!(read_head(g), Err(()));
    }
}
