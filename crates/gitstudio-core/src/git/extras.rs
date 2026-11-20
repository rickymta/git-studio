//! Less common repository features: submodules, Git LFS, commit signatures, bisect, external
//! merge / diff tools, file contents at a revision (image diffs) and maintenance.

use std::collections::BTreeMap;

use serde::Serialize;

use super::run::{self, Opts};
use super::{Repo, check_path, check_rev};
use crate::error::{Error, Result};

// ---- submodules -------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SubmoduleState {
    /// Checked out at the commit the superproject records.
    Clean,
    /// Listed in .gitmodules but not cloned / initialised yet.
    Uninitialized,
    /// Checked out at another commit than the recorded one.
    Modified,
    /// Merge conflict on the submodule entry.
    Conflict,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    pub name: String,
    /// Relative to the superproject root.
    pub path: String,
    pub url: String,
    /// Branch to follow (`submodule.<name>.branch`), if set.
    pub branch: Option<String>,
    /// Commit the superproject records for it (index).
    pub recorded: Option<String>,
    /// Commit checked out in it, when initialised.
    pub current: Option<String>,
    pub state: SubmoduleState,
}

impl Repo {
    /// Submodules from `.gitmodules`, with what is checked out in each.
    pub async fn submodules(&self) -> Result<Vec<Submodule>> {
        if !self.root.join(".gitmodules").exists() {
            return Ok(Vec::new());
        }
        let cfg = run::raw(
            Some(&self.root),
            &[
                "config",
                "-z",
                "-f",
                ".gitmodules",
                "--get-regexp",
                r"^submodule\..*\.(path|url|branch)$",
            ],
            Opts::default(),
        )
        .await?;
        // name → (path, url, branch)
        let mut by_name: BTreeMap<String, (String, String, Option<String>)> = BTreeMap::new();
        // `-z`: `key\nvalue\0`, so names and paths may contain spaces.
        for entry in cfg.text().split('\0') {
            let Some((key, value)) = entry.split_once('\n') else {
                continue;
            };
            let Some(rest) = key.strip_prefix("submodule.") else {
                continue;
            };
            let Some((name, field)) = rest.rsplit_once('.') else {
                continue;
            };
            let e = by_name.entry(name.to_string()).or_default();
            match field {
                "path" => e.0 = value.to_string(),
                "url" => e.1 = value.to_string(),
                "branch" => e.2 = Some(value.to_string()),
                _ => {}
            }
        }
        // Recorded commits: gitlinks (mode 160000) in the index.
        let staged = run::ok(&self.root, &["ls-files", "-s", "-z"], Opts::default()).await?;
        let mut recorded: BTreeMap<String, String> = BTreeMap::new();
        for entry in staged.text().split('\0') {
            let Some((meta, path)) = entry.split_once('\t') else {
                continue;
            };
            let mut parts = meta.split(' ');
            if parts.next() == Some("160000")
                && let Some(hash) = parts.next()
            {
                recorded.insert(path.to_string(), hash.to_string());
            }
        }
        let status = run::raw(Some(&self.root), &["submodule", "status"], Opts::default()).await?;
        let mut state: BTreeMap<String, SubmoduleState> = BTreeMap::new();
        for line in status.text().lines() {
            // `<flag><sha> <path>[ (<describe>)]`
            let Some(flag) = line.chars().next() else {
                continue;
            };
            let Some((_, rest)) = line[flag.len_utf8()..].split_once(' ') else {
                continue;
            };
            let path = match rest.rfind(" (") {
                Some(i) if rest.ends_with(')') => &rest[..i],
                _ => rest,
            };
            state.insert(
                path.to_string(),
                match flag {
                    '-' => SubmoduleState::Uninitialized,
                    '+' => SubmoduleState::Modified,
                    'U' => SubmoduleState::Conflict,
                    _ => SubmoduleState::Clean,
                },
            );
        }
        let mut out = Vec::new();
        for (name, (path, url, branch)) in by_name {
            if path.is_empty() {
                continue;
            }
            let st = state
                .get(&path)
                .copied()
                .unwrap_or(SubmoduleState::Uninitialized);
            let current = if st == SubmoduleState::Uninitialized {
                None
            } else {
                run::raw(
                    Some(&self.root.join(&path)),
                    &["rev-parse", "--verify", "-q", "HEAD"],
                    Opts::default(),
                )
                .await
                .ok()
                .filter(|o| o.code == 0)
                .map(|o| o.text().trim().to_string())
            };
            out.push(Submodule {
                recorded: recorded.get(&path).cloned(),
                name,
                path,
                url,
                branch,
                current,
                state: st,
            });
        }
        Ok(out)
    }

    /// `git submodule update --init` for `paths` (all when empty).
    pub async fn submodule_update(&self, paths: &[String], recursive: bool) -> Result<()> {
        let mut a = vec!["submodule", "update", "--init"];
        if recursive {
            a.push("--recursive");
        }
        a.push("--");
        a.extend(super::checked_paths(paths)?);
        self.git_opts(&a, self.net(None).await).await.map(drop)
    }

    /// Copy the URLs from `.gitmodules` into the configuration (after a URL change).
    pub async fn submodule_sync(&self) -> Result<()> {
        self.git(&["submodule", "sync", "--recursive"])
            .await
            .map(drop)
    }

    /// Clone `url` into `path` as a new submodule (staged, not committed).
    pub async fn submodule_add(&self, url: &str, path: &str, branch: Option<&str>) -> Result<()> {
        if url.trim().is_empty() || url.starts_with('-') || url.contains(['\0', '\n']) {
            return Err(Error::Invalid(format!("Invalid URL: {url:?}")));
        }
        check_path(path)?;
        let mut a = vec!["submodule", "add"];
        if let Some(b) = branch.filter(|b| !b.trim().is_empty()) {
            check_rev(b)?;
            a.extend(["-b", b]);
        }
        a.extend(["--", url, path]);
        self.git_opts(&a, self.net(None).await).await.map(drop)
    }

    /// Empty a submodule's working tree and unregister it (`git submodule deinit`).
    pub async fn submodule_deinit(&self, path: &str, force: bool) -> Result<()> {
        check_path(path)?;
        let mut a = vec!["submodule", "deinit"];
        if force {
            a.push("--force");
        }
        a.extend(["--", path]);
        self.git(&a).await.map(drop)
    }
}

// ---- Git LFS ----------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LfsFile {
    pub path: String,
    /// Short object id, as `git lfs ls-files` prints it.
    pub oid: String,
    /// The real content is in the working tree (not just the pointer).
    pub downloaded: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LfsInfo {
    /// `git lfs` can run.
    pub available: bool,
    pub version: Option<String>,
    /// Patterns stored with LFS (`filter=lfs` in the top-level .gitattributes).
    pub patterns: Vec<String>,
    /// Files of HEAD stored with LFS.
    pub files: Vec<LfsFile>,
}

/// Patterns with `filter=lfs` in a .gitattributes text.
pub fn lfs_patterns(attributes: &str) -> Vec<String> {
    attributes
        .lines()
        .map(str::trim)
        .filter(|l| !l.starts_with('#'))
        .filter_map(|l| {
            let mut parts = l.split_whitespace();
            let pattern = parts.next()?;
            parts
                .any(|a| a == "filter=lfs")
                .then(|| pattern.to_string())
        })
        .collect()
}

fn check_pattern(p: &str) -> Result<&str> {
    let p = p.trim();
    if p.is_empty() || p.starts_with('-') || p.contains(['\0', '\n', '\r']) {
        return Err(Error::Invalid(format!("Invalid pattern {p:?}")));
    }
    Ok(p)
}

impl Repo {
    pub async fn lfs_info(&self) -> Result<LfsInfo> {
        let version = run::raw(Some(&self.root), &["lfs", "version"], Opts::default())
            .await
            .ok()
            .filter(|o| o.code == 0)
            .map(|o| o.text().trim().to_string());
        let patterns = std::fs::read(self.root.join(".gitattributes"))
            .map(|b| lfs_patterns(&String::from_utf8_lossy(&b)))
            .unwrap_or_default();
        let mut files = Vec::new();
        if version.is_some() && self.has_head().await {
            let out = run::raw(
                Some(&self.root),
                &["-c", "core.quotePath=false", "lfs", "ls-files"],
                Opts::default(),
            )
            .await?;
            if out.code == 0 {
                // `<oid> <*|-> <path>`: `*` full content, `-` pointer only.
                for line in out.text().lines() {
                    let mut it = line.splitn(3, ' ');
                    if let (Some(oid), Some(mark), Some(path)) = (it.next(), it.next(), it.next()) {
                        files.push(LfsFile {
                            path: path.to_string(),
                            oid: oid.to_string(),
                            downloaded: mark == "*",
                        });
                    }
                }
            }
        }
        Ok(LfsInfo {
            available: version.is_some(),
            version,
            patterns,
            files,
        })
    }

    /// Store files matching `pattern` with LFS from now on (`git lfs track`).
    pub async fn lfs_track(&self, pattern: &str) -> Result<()> {
        let p = check_pattern(pattern)?;
        self.git(&["lfs", "track", "--", p]).await.map(drop)
    }

    pub async fn lfs_untrack(&self, pattern: &str) -> Result<()> {
        let p = check_pattern(pattern)?;
        self.git(&["lfs", "untrack", "--", p]).await.map(drop)
    }

    /// Set up the LFS hooks and filters for this repository only (`git lfs install --local`).
    pub async fn lfs_install(&self) -> Result<()> {
        self.git(&["lfs", "install", "--local"]).await.map(drop)
    }

    /// `pull`: download the content of the checked-out LFS files; `fetch`: download without
    /// checking out; `prune`: delete old local copies already on the server.
    pub async fn lfs_op(&self, op: &str) -> Result<String> {
        let verb = match op {
            "pull" | "fetch" | "prune" => op,
            _ => return Err(Error::Invalid(format!("Unknown LFS operation {op}"))),
        };
        self.git_opts(&["lfs", verb], self.net(None).await).await
    }
}
