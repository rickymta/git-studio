//! Git's commit-graph file for large histories. Without it, `git log --date-order` (the graph's
//! order) reads every commit of the repository before it prints the first one: about a second per
//! 200,000 commits, on every page and every refresh. With it, a page costs the same whatever the
//! history's size. Git only writes the file during `git gc` / `git maintenance`, so repositories
//! that never ran those (most clones) do not have one; GitStudio writes it in the background.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

/// An existing graph is brought up to date once it is this old and fetches came in since.
const STALE: Duration = Duration::from_secs(24 * 60 * 60);

/// The objects folder shared by all worktrees of the repository whose git dir is `git_dir`.
fn objects_dir(git_dir: &Path) -> PathBuf {
    let common = std::fs::read_to_string(git_dir.join("commondir"))
        .map(|c| {
            let p = PathBuf::from(c.trim());
            if p.is_absolute() { p } else { git_dir.join(p) }
        })
        .unwrap_or_else(|_| git_dir.to_path_buf());
    common.join("objects")
}

fn modified(p: &Path) -> Option<SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// Whether the repository needs a (new) commit-graph: none yet, or an old one with fetches since.
pub fn needed(git_dir: &Path) -> bool {
    let info = objects_dir(git_dir).join("info");
    let graph = modified(&info.join("commit-graph"))
        .into_iter()
        .chain(modified(
            &info.join("commit-graphs").join("commit-graph-chain"),
        ))
        .max();
    let Some(graph) = graph else {
        return true;
    };
    let old = graph.elapsed().is_ok_and(|age| age > STALE);
    let fetched_since = modified(&git_dir.join("FETCH_HEAD")).is_some_and(|f| f > graph);
    old && fetched_since
}

/// Repositories handled this session (or being handled now): at most one write each.
fn done() -> &'static Mutex<HashSet<PathBuf>> {
    static DONE: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    DONE.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Write or update the commit-graph of the repository at `root` (git dir `git_dir`) when it needs
/// one, in a low-priority background thread. `--split` adds a small layer instead of rewriting
/// the whole file. Returns whether a write was started.
pub fn ensure(root: &Path, git_dir: &Path) -> bool {
    let key = objects_dir(git_dir);
    if !done().lock().unwrap_or_else(|e| e.into_inner()).insert(key) {
        return false;
    }
    if !needed(git_dir) {
        return false;
    }
    let root = root.to_path_buf();
    std::thread::spawn(move || {
        let mut cmd = Command::new("git");
        cmd.arg("-C")
            .arg(&root)
            .args(["commit-graph", "write", "--reachable", "--split"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS: never in the way of the app's git.
            cmd.creation_flags(0x0800_0000 | 0x0000_4000);
        }
        let _ = cmd.status();
    });
    true
}

/// The repository has a commit-graph (one file or a split chain).
pub fn has_graph(git_dir: &Path) -> bool {
    let info = objects_dir(git_dir).join("info");
    info.join("commit-graph").exists()
        || info
            .join("commit-graphs")
            .join("commit-graph-chain")
            .exists()
}

/// Packs bigger than this mean a history long enough that `--date-order` without a
/// commit-graph would read for seconds (about 4.5 s per million commits) before printing.
const BIG_PACKS: u64 = 64 * 1024 * 1024;

/// Total size of the repository's packs is over `BIG_PACKS`.
pub fn big_history(git_dir: &Path) -> bool {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(objects_dir(git_dir).join("pack")) {
        for e in entries.flatten() {
            if e.file_name().to_string_lossy().ends_with(".pack") {
                total += e.metadata().map(|m| m.len()).unwrap_or(0);
                if total > BIG_PACKS {
                    return true;
                }
            }
        }
    }
    false
}

/// Loose ref files past this many slow every ref listing down (one file each); `git pack-refs`
/// puts them in one `packed-refs` file, as `git gc` would.
const MANY_LOOSE_REFS: usize = 1000;

fn count_files(dir: &Path, limit: usize, n: &mut usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        if *n > limit {
            return;
        }
        match e.file_type() {
            Ok(t) if t.is_dir() => count_files(&e.path(), limit, n),
            Ok(_) => *n += 1,
            Err(_) => {}
        }
    }
}

/// Pack the loose refs in the background when there are many (once per session per repository).
/// Returns whether it started.
pub fn pack_refs_if_many(root: &Path, git_dir: &Path) -> bool {
    static PACKED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    let common = objects_dir(git_dir)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| git_dir.to_path_buf());
    if !PACKED
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(common.clone())
    {
        return false;
    }
    let mut n = 0;
    count_files(&common.join("refs"), MANY_LOOSE_REFS, &mut n);
    if n <= MANY_LOOSE_REFS {
        return false;
    }
    let root = root.to_path_buf();
    std::thread::spawn(move || {
        let mut cmd = Command::new("git");
        cmd.arg("-C")
            .arg(&root)
            .args(["pack-refs", "--all"])
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
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_graph_once_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        let sh = |args: &[&str]| {
            assert!(
                Command::new("git")
                    .current_dir(r)
                    .args(args)
                    .status()
                    .unwrap()
                    .success()
            )
        };
        sh(&["init", "-q", "-b", "main"]);
        std::fs::write(r.join("a"), "1").unwrap();
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
        let gd = r.join(".git");
        assert!(needed(&gd));
        assert!(ensure(r, &gd));
        // Once per session.
        assert!(!ensure(r, &gd));
        let chain = gd.join("objects/info/commit-graphs/commit-graph-chain");
        for _ in 0..100 {
            if chain.exists() || gd.join("objects/info/commit-graph").exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(!needed(&gd));
    }
}
