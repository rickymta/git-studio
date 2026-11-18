//! Workspaces: named, local-first groups of repositories (`workspaces.json`), plus the helpers
//! the overview needs — finding repositories under a folder and summarising many at once.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::git::model::{GitHubSlug, RepoState};
use crate::git::Repo;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    /// Accent colour (CSS colour string).
    pub color: String,
    /// Repository working-tree paths.
    pub repos: Vec<String>,
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

const SKIP: &[&str] = &["node_modules", "target", "dist", "build", "vendor", ".venv", "bin", "obj"];

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
    let Ok(entries) = std::fs::read_dir(dir) else { return };
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
            s.conflicts = st.conflicted.len() as u32;
            s.branch = st.branch;
            s.upstream = st.upstream;
            s.ahead = st.ahead;
            s.behind = st.behind;
        }
        Err(e) => s.error = Some(e.to_string()),
    }
    s.state = Some(repo.state());
    if let Ok(log) = repo.log(1, 0).await {
        // `log` walks --all; the first entry is the newest commit anywhere, which is what an
        // overview wants ("last activity").
        if let Some(c) = log.into_iter().next() {
            s.last_commit = Some(LastCommit {
                hash: c.hash,
                subject: c.subject,
                author: c.author_name,
                time: c.commit_time,
            });
        }
    }
    if let Ok(r) = repo.refs().await {
        let gh = r
            .remotes
            .iter()
            .find(|x| x.name == "origin" && x.github.is_some())
            .or_else(|| r.remotes.iter().find(|x| x.github.is_some()));
        s.github = gh.and_then(|x| x.github.clone());
    }
    s
}

/// Summaries of `paths`, computed concurrently (bounded), in the input order.
pub async fn status(paths: Vec<String>) -> Vec<RepoSummary> {
    const PARALLEL: usize = 6;
    let mut out: Vec<Option<RepoSummary>> = vec![None; paths.len()];
    let mut set = tokio::task::JoinSet::new();
    let mut next = 0;
    while next < paths.len() || !set.is_empty() {
        while next < paths.len() && set.len() < PARALLEL {
            let i = next;
            let p = paths[i].clone();
            set.spawn(async move { (i, summarise(p).await) });
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
    fn scan_finds_nested_repos_and_skips_noise() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        for d in ["a/.git", "group/b/.git", "node_modules/c/.git", "a/inner/.git"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        let found = scan(root, 3);
        let names: Vec<String> = found
            .iter()
            .map(|p| Path::new(p).file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["a", "b"]);
    }
}
