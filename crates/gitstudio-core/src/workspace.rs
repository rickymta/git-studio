//! Workspaces: named, local-first groups of repositories (`workspaces.json`), plus the helpers
//! the overview needs — finding repositories under a folder and summarising many at once.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::git::Repo;
use crate::git::model::{FileChange, GitHubSlug, GitLabSlug, RepoState};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    /// Accent colour (CSS colour string).
    pub color: String,
    /// Repository working-tree paths.
    pub repos: Vec<String>,
    /// Folders grouping the repositories (at most three levels; the UI keeps them valid).
    pub folders: Vec<WorkspaceFolder>,
    /// Normalised repository path → folder id; a repository not listed sits at the root.
    pub placement: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceFolder {
    pub id: String,
    pub name: String,
    /// Parent folder id; empty for the workspace's root.
    pub parent: String,
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Workspaces {
    pub items: Vec<Workspace>,
    /// Id of the active workspace; empty for none.
    pub active: String,
}

fn file() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(std::env::temp_dir);
    base.join("GitStudio").join("workspaces.json")
}

pub fn load() -> Workspaces {
    std::fs::read(file())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save(w: &Workspaces) -> Result<()> {
    let path = file();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(w)?)?;
    Ok(())
}

// ---- scanning -----------------------------------------------------------------------------------

const SKIP: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "vendor",
    ".venv",
    "bin",
    "obj",
];

/// Git working trees under `root` (including `root` itself), at most `depth` levels down.
/// Does not descend into a repository once found.
pub fn scan(root: &Path, depth: u32) -> Vec<String> {
    let mut out = Vec::new();
    walk(root, depth, &mut out);
    out.sort_by_key(|p| p.to_lowercase());
    out
}

fn walk(dir: &Path, depth: u32, out: &mut Vec<String>) {
    if dir.join(".git").exists() {
        out.push(dir.display().to_string());
        return;
    }
    if depth == 0 || out.len() >= 500 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        if !ft.is_dir() {
            continue;
        }
        let name = e.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || SKIP.contains(&name.as_ref()) {
            continue;
        }
        walk(&e.path(), depth - 1, out);
    }
}

// ---- summaries ----------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCommit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub time: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    pub path: String,
    pub name: String,
    /// Set when the folder is missing or not a repository any more.
    pub error: Option<String>,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub changes: u32,
    pub conflicts: u32,
    pub state: Option<RepoState>,
    pub last_commit: Option<LastCommit>,
    pub github: Option<GitHubSlug>,
    pub gitlab: Option<GitLabSlug>,
    /// Uncommitted files by kind (Launchpad's WIPs).
    pub wip: WipCounts,
}

#[derive(Debug, Clone, Copy, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WipCounts {
    pub modified: u32,
    pub added: u32,
    pub deleted: u32,
    pub renamed: u32,
}

/// Each changed path counted once, staged or not: renamed, else deleted, else added
/// (untracked included), else modified.
pub fn wip_counts<'a>(files: impl Iterator<Item = &'a FileChange>) -> WipCounts {
    let mut by_path: std::collections::BTreeMap<&str, u8> = std::collections::BTreeMap::new();
    for f in files {
        let rank = match f.status {
            'R' | 'C' => 4,
            'D' => 3,
            'A' | '?' => 2,
            _ => 1,
        };
        let e = by_path.entry(f.path.as_str()).or_insert(0);
        *e = (*e).max(rank);
    }
    let mut c = WipCounts::default();
    for rank in by_path.values() {
        match rank {
            4 => c.renamed += 1,
            3 => c.deleted += 1,
            2 => c.added += 1,
            _ => c.modified += 1,
        }
    }
    c
}

async fn summarise(path: String) -> RepoSummary {
    let name = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());
    let mut s = RepoSummary {
        path: path.clone(),
        name,
        error: None,
        branch: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        changes: 0,
        conflicts: 0,
        state: None,
        last_commit: None,
        github: None,
        gitlab: None,
        wip: WipCounts::default(),
    };
    let repo = match Repo::open(Path::new(&path)).await {
        Ok(r) => r,
        Err(e) => {
            s.error = Some(e.to_string());
            return s;
        }
    };
    match repo.status().await {
        Ok(st) => {
            let mut paths: Vec<&str> = st
                .staged
                .iter()
                .chain(&st.unstaged)
                .map(|f| f.path.as_str())
                .collect();
            paths.sort_unstable();
            paths.dedup();
            s.changes = paths.len() as u32;
            s.wip = wip_counts(st.staged.iter().chain(&st.unstaged));
            s.conflicts = st.conflicted.len() as u32;
            s.branch = st.branch;
            s.upstream = st.upstream;
            s.ahead = st.ahead;
            s.behind = st.behind;
        }
        Err(e) => s.error = Some(e.to_string()),
    }
    s.state = Some(repo.state());
    // The newest commit anywhere, which is what an overview wants ("last activity").
    if let Ok(Some(c)) = repo.newest_commit().await {
        s.last_commit = Some(LastCommit {
            hash: c.hash,
            subject: c.subject,
            author: c.author_name,
            time: c.commit_time,
        });
    }
    // Only the remotes are needed here (GitHub / GitLab links), not every ref.
    if let Ok(remotes) = repo.remotes().await {
        let gh = remotes
            .iter()
            .find(|x| x.name == "origin" && x.github.is_some())
            .or_else(|| remotes.iter().find(|x| x.github.is_some()));
        s.github = gh.and_then(|x| x.github.clone());
        let gl = remotes
            .iter()
            .find(|x| x.name == "origin" && x.gitlab.is_some())
            .or_else(|| remotes.iter().find(|x| x.gitlab.is_some()));
        s.gitlab = gl.and_then(|x| x.gitlab.clone());
    }
    s
}

/// Summaries of `paths`, computed concurrently (bounded), in the input order.
pub async fn status(paths: Vec<String>) -> Vec<RepoSummary> {
    // Background work: a few repositories at a time, at low priority, so opening a repository
    // meanwhile is not slowed down by dozens of git processes.
    const PARALLEL: usize = 4;
    let mut out: Vec<Option<RepoSummary>> = vec![None; paths.len()];
    let mut set = tokio::task::JoinSet::new();
    let mut next = 0;
    while next < paths.len() || !set.is_empty() {
        while next < paths.len() && set.len() < PARALLEL {
            let i = next;
            let p = paths[i].clone();
            set.spawn(crate::git::run::low_priority(async move {
                (i, summarise(p).await)
            }));
            next += 1;
        }
        if let Some(Ok((i, s))) = set.join_next().await {
            out[i] = Some(s);
        }
    }
    out.into_iter().flatten().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wip_counts_each_path_once() {
        let f = |path: &str, status: char| FileChange {
            path: path.into(),
            orig_path: None,
            status,
        };
        let files = [
            f("a.rs", 'M'),
            f("a.rs", 'M'),
            f("new.rs", '?'),
            f("staged.rs", 'A'),
            f("staged.rs", 'M'),
            f("gone.rs", 'D'),
            f("moved.rs", 'R'),
        ];
        assert_eq!(
            wip_counts(files.iter()),
            WipCounts {
                modified: 1,
                added: 2,
                deleted: 1,
                renamed: 1
            }
        );
    }

    #[test]
    fn scan_finds_nested_repos_and_skips_noise() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        for d in [
            "a/.git",
            "group/b/.git",
            "node_modules/c/.git",
            "a/inner/.git",
        ] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        let found = scan(root, 3);
        let names: Vec<String> = found
            .iter()
            .map(|p| {
                Path::new(p)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["a", "b"]);
    }
}
