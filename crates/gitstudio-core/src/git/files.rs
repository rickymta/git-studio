//! File-level operations: read/write a file in its own encoding, blame, per-file history, and
//! worktrees.

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::model::{Commit, FileChange};
use super::parse::{RS, US};
use super::run::{self, Opts};
use super::{Repo, check_rev};
use crate::error::{Error, Result};
use crate::text::{self, DecodedText, TextFormat};

/// `path` relative to the repository, refusing anything that escapes it.
fn safe_rel(path: &str) -> Result<PathBuf> {
    let p = Path::new(path);
    if path.is_empty()
        || p.is_absolute()
        || p.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        })
    {
        return Err(Error::Invalid(format!("Invalid path {path:?}")));
    }
    Ok(p.to_path_buf())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    pub hash: String,
    pub author: String,
    pub author_email: String,
    pub time: i64,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    /// Commit of each line, in order (line 1 first). All zeros = not committed yet.
    pub lines: Vec<String>,
    pub commits: Vec<BlameCommit>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryEntry {
    #[serde(flatten)]
    pub commit: Commit,
    /// How the file changed in this commit, with its path at that time.
    pub change: FileChange,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub head: Option<String>,
    /// Branch name without `refs/heads/`; `None` when detached.
    pub branch: Option<String>,
    pub is_main: bool,
    pub is_current: bool,
    pub bare: bool,
    pub locked: bool,
    pub prunable: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewWorktree {
    pub path: String,
    /// Existing branch to check out, or the start point of `new_branch`.
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub new_branch: Option<String>,
}

impl Repo {
    /// Read a file from the working tree (`rev` = None) or from a commit, decoded.
    pub async fn read_file(
        &self,
        path: &str,
        rev: Option<&str>,
        encoding: Option<&str>,
    ) -> Result<DecodedText> {
        let rel = safe_rel(path)?;
        let bytes = match rev {
            None => std::fs::read(self.root.join(&rel))?,
            Some(r) => {
                check_rev(r)?;
                let spec = format!("{r}:{}", rel.to_string_lossy().replace('\\', "/"));
                run::ok(&self.root, &["show", &spec], Opts::default())
                    .await?
                    .stdout
            }
        };
        text::decode(&bytes, encoding)
    }

    /// Write a working-tree file, encoded with `format` (encoding, BOM, line endings).
    pub fn write_file(&self, path: &str, content: &str, format: &TextFormat) -> Result<()> {
        let rel = safe_rel(path)?;
        let bytes = text::encode(content, format)?;
        let full = self.root.join(rel);
        if let Some(dir) = full.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(full, bytes)?;
        Ok(())
    }

    pub async fn blame(&self, path: &str, rev: Option<&str>) -> Result<Blame> {
        let rel = safe_rel(path)?;
        let rel = rel.to_string_lossy().replace('\\', "/");
        let mut args = vec!["blame", "--porcelain"];
        if let Some(r) = rev {
            check_rev(r)?;
            args.push(r);
        }
        args.extend(["--", &rel]);
        let out = run::ok(&self.root, &args, Opts::default()).await?;
        Ok(parse_blame(&String::from_utf8_lossy(&out.stdout)))
    }

    /// Commits that touched `path`, following renames, newest first.
    pub async fn file_history(&self, path: &str, limit: u32) -> Result<Vec<FileHistoryEntry>> {
        let rel = safe_rel(path)?;
        let rel = rel.to_string_lossy().replace('\\', "/");
        let n = format!("-n{}", limit.clamp(1, 5000));
        let out = run::ok(
            &self.root,
            &[
                "log",
                "--follow",
                "-M",
                &n,
                "--name-status",
                "--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ct%x1f%s",
                "--",
                &rel,
            ],
            Opts::default(),
        )
        .await?;
        Ok(parse_history(&String::from_utf8_lossy(&out.stdout)))
    }

    // ---- worktrees ----

    pub async fn worktrees(&self) -> Result<Vec<Worktree>> {
        let out = run::ok(
            &self.root,
            &["worktree", "list", "--porcelain"],
            Opts::default(),
        )
        .await?;
        let mut list = parse_worktrees(&String::from_utf8_lossy(&out.stdout));
        let me = self.root.canonicalize().ok();
        for (i, w) in list.iter_mut().enumerate() {
            w.is_main = i == 0;
            w.is_current = me.is_some() && Path::new(&w.path).canonicalize().ok() == me;
        }
        Ok(list)
    }

    pub async fn add_worktree(&self, req: &NewWorktree) -> Result<()> {
        if req.path.trim().is_empty() || req.path.starts_with('-') {
            return Err(Error::Invalid("Choose a folder for the worktree".into()));
        }
        let mut args = vec!["worktree", "add"];
        if let Some(b) = req.new_branch.as_deref().filter(|b| !b.trim().is_empty()) {
            check_rev(b)?;
            args.extend(["-b", b]);
        }
        args.push(&req.path);
        if let Some(b) = req.branch.as_deref().filter(|b| !b.is_empty()) {
            check_rev(b)?;
            args.push(b);
        }
        run::ok(&self.root, &args, Opts::default()).await.map(drop)
    }

    pub async fn remove_worktree(&self, path: &str, force: bool) -> Result<()> {
        let mut args = vec!["worktree", "remove"];
        if force {
            args.push("--force");
        }
        args.extend(["--", path]);
        run::ok(&self.root, &args, Opts::default()).await.map(drop)
    }

    pub async fn lock_worktree(&self, path: &str, lock: bool) -> Result<()> {
        let verb = if lock { "lock" } else { "unlock" };
        run::ok(&self.root, &["worktree", verb, "--", path], Opts::default())
            .await
            .map(drop)
    }

    pub async fn prune_worktrees(&self) -> Result<()> {
        run::ok(&self.root, &["worktree", "prune"], Opts::default())
            .await
            .map(drop)
    }
}

fn parse_blame(text: &str) -> Blame {
    let mut lines = Vec::new();
    let mut commits: Vec<BlameCommit> = Vec::new();
    let mut cur: Option<usize> = None;
    for line in text.lines() {
        if let Some(content) = line.strip_prefix('\t') {
            let _ = content;
            continue;
        }
        let mut parts = line.split(' ');
        let first = parts.next().unwrap_or_default();
        if first.len() == 40 && first.chars().all(|c| c.is_ascii_hexdigit()) {
            // "<hash> <orig-line> <final-line> [<group-size>]"
            lines.push(first.to_string());
            cur = match commits.iter().position(|c| c.hash == first) {
                Some(i) => Some(i),
                None => {
                    commits.push(BlameCommit {
                        hash: first.to_string(),
                        author: String::new(),
                        author_email: String::new(),
                        time: 0,
                        summary: String::new(),
                    });
                    Some(commits.len() - 1)
                }
            };
            continue;
        }
        let Some(i) = cur else { continue };
        let rest = line.split_once(' ').map(|(_, r)| r).unwrap_or_default();
        let c = &mut commits[i];
        match first {
            "author" => c.author = rest.to_string(),
            "author-mail" => c.author_email = rest.trim_matches(['<', '>']).to_string(),
            "author-time" => c.time = rest.parse().unwrap_or(0),
            "summary" => c.summary = rest.to_string(),
            _ => {}
        }
    }
    Blame { lines, commits }
}

fn parse_history(text: &str) -> Vec<FileHistoryEntry> {
    let mut out = Vec::new();
    for rec in text.split(RS) {
        let rec = rec.trim();
        if rec.is_empty() {
            continue;
        }
        let mut lines = rec.lines();
        let head = lines.next().unwrap_or_default();
        let f: Vec<&str> = head.split(US).collect();
        if f.len() < 8 {
            continue;
        }
        let commit = Commit {
            hash: f[0].to_string(),
            parents: f[1].split_whitespace().map(str::to_string).collect(),
            author_name: f[2].to_string(),
            author_email: f[3].to_string(),
            author_time: f[4].parse().unwrap_or(0),
            committer_name: f[5].to_string(),
            commit_time: f[6].parse().unwrap_or(0),
            subject: f[7].to_string(),
            body: String::new(),
        };
        let change = lines.map(str::trim).find(|l| !l.is_empty()).map(|l| {
            let cols: Vec<&str> = l.split('\t').collect();
            let status = cols[0].chars().next().unwrap_or('M');
            if cols.len() >= 3 {
                FileChange {
                    path: cols[2].to_string(),
                    orig_path: Some(cols[1].to_string()),
                    status,
                }
            } else {
                FileChange {
                    path: cols.get(1).copied().unwrap_or_default().to_string(),
                    orig_path: None,
                    status,
                }
            }
        });
        if let Some(change) = change {
            out.push(FileHistoryEntry { commit, change });
        }
    }
    out
}

fn parse_worktrees(text: &str) -> Vec<Worktree> {
    let mut out = Vec::new();
    for block in text.split("\n\n") {
        let mut w = Worktree {
            path: String::new(),
            head: None,
            branch: None,
            is_main: false,
            is_current: false,
            bare: false,
            locked: false,
            prunable: false,
        };
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                w.path = p.to_string();
            } else if let Some(h) = line.strip_prefix("HEAD ") {
                w.head = Some(h.to_string());
            } else if let Some(b) = line.strip_prefix("branch ") {
                w.branch = Some(b.trim_start_matches("refs/heads/").to_string());
            } else if line == "bare" {
                w.bare = true;
            } else if line.starts_with("locked") {
                w.locked = true;
            } else if line.starts_with("prunable") {
                w.prunable = true;
            }
        }
        if !w.path.is_empty() {
            out.push(w);
        }
    }
    out
}

// ---- history edits and patches ----

impl Repo {
    async fn is_ancestor_of_head(&self, hash: &str) -> bool {
        run::raw(
            Some(&self.root),
            &["merge-base", "--is-ancestor", hash, "HEAD"],
            Opts::default(),
        )
        .await
        .map(|o| o.code == 0)
        .unwrap_or(false)
    }

    async fn has_merges_since(&self, hash: &str) -> Result<bool> {
        let range = format!("{hash}..HEAD");
        let out = run::ok(
            &self.root,
            &["rev-list", "--merges", &range],
            Opts::default(),
        )
        .await?;
        Ok(!out.text().trim().is_empty())
    }

    async fn check_rewritable(&self, hash: &str) -> Result<()> {
        check_rev(hash)?;
        if !self.is_ancestor_of_head(hash).await {
            return Err(Error::Invalid(
                "Only commits on the current branch can be changed".into(),
            ));
        }
        if self.has_merges_since(hash).await? {
            return Err(Error::Invalid(
                "There is a merge commit after this commit; rewriting it here would flatten the merge"
                    .into(),
            ));
        }
        if self.state() != super::model::RepoState::Clean {
            return Err(Error::Invalid(
                "Finish or abort the operation in progress first".into(),
            ));
        }
        Ok(())
    }

    /// Change the message of `hash` (HEAD: amend; older: autosquash rebase, autostashing changes).
    pub async fn reword(&self, hash: &str, message: &str) -> Result<()> {
        if message.trim().is_empty() {
            return Err(Error::Invalid("Commit message is empty".into()));
        }
        self.check_rewritable(hash).await?;
        let head = run::ok(&self.root, &["rev-parse", "HEAD"], Opts::default())
            .await?
            .text();
        let full = run::ok(&self.root, &["rev-parse", hash], Opts::default())
            .await?
            .text();
        if head.trim() == full.trim() {
            return run::ok(
                &self.root,
                &["commit", "--amend", "--only", "-F", "-"],
                Opts {
                    stdin: Some(message.as_bytes()),
                    env: Vec::new(),
                },
            )
            .await
            .map(drop);
        }
        // "amend!" commit carrying the new message, folded in by --autosquash.
        let subject = run::ok(
            &self.root,
            &["log", "-1", "--format=%s", hash],
            Opts::default(),
        )
        .await?
        .text();
        let fixup = format!("amend! {}\n\n{}", subject.trim(), message.trim());
        // An empty "amend!" commit on top of HEAD, built with commit-tree so staged changes are
        // left alone; `rebase --autosquash` folds it into `hash`, replacing the message.
        let created = run::ok(
            &self.root,
            &["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-F", "-"],
            Opts {
                stdin: Some(fixup.as_bytes()),
                env: Vec::new(),
            },
        )
        .await?
        .text();
        run::ok(
            &self.root,
            &[
                "update-ref",
                "-m",
                "reword",
                "HEAD",
                created.trim(),
                head.trim(),
            ],
            Opts::default(),
        )
        .await?;
        let base = format!("{hash}^");
        let out = run::raw(
            Some(&self.root),
            &["rebase", "-i", "--autosquash", "--autostash", &base],
            Opts::default(),
        )
        .await?;
        if out.code != 0 {
            return Err(run::failure(&out));
        }
        Ok(())
    }

    /// Remove `hash` from the current branch (`rebase --onto hash^ hash`).
    pub async fn drop_commit(&self, hash: &str) -> Result<()> {
        self.check_rewritable(hash).await?;
        let parent = run::raw(
            Some(&self.root),
            &["rev-parse", "--verify", "-q", &format!("{hash}^")],
            Opts::default(),
        )
        .await?;
        if parent.code != 0 {
            return Err(Error::Invalid(
                "The first commit of a branch cannot be dropped".into(),
            ));
        }
        let parent = parent.text();
        run::ok(
            &self.root,
            &["rebase", "--autostash", "--onto", parent.trim(), hash],
            Opts::default(),
        )
        .await
        .map(drop)
    }

    /// `git format-patch` of one commit into `dest` (a file path).
    pub async fn create_patch(&self, hash: &str, dest: &Path) -> Result<()> {
        check_rev(hash)?;
        let out = run::ok(
            &self.root,
            &["format-patch", "-1", "--stdout", hash],
            Opts::default(),
        )
        .await?;
        std::fs::write(dest, out.stdout)?;
        Ok(())
    }

    /// Apply a patch file to the working tree (3-way when possible).
    pub async fn apply_patch_file(&self, file: &Path) -> Result<()> {
        if !file.is_file() {
            return Err(Error::Invalid(format!(
                "Patch not found: {}",
                file.display()
            )));
        }
        let f = file.to_string_lossy().into_owned();
        run::ok(
            &self.root,
            &["apply", "--3way", "--whitespace=nowarn", "--", &f],
            Opts::default(),
        )
        .await
        .map(drop)
    }

    /// Files that differ between `hash` and the working tree.
    pub async fn compare_with_worktree(&self, hash: &str) -> Result<Vec<FileChange>> {
        check_rev(hash)?;
        let out = run::ok(
            &self.root,
            &["diff", "--name-status", "-z", "-M", hash],
            Opts::default(),
        )
        .await?;
        Ok(super::parse::parse_name_status(&out.stdout))
    }
}

impl Repo {
    /// Every file path in the tree of `rev` ("View all files").
    pub async fn list_files(&self, rev: &str) -> Result<Vec<String>> {
        check_rev(rev)?;
        let out = run::ok(
            &self.root,
            &["ls-tree", "-r", "--name-only", "-z", rev],
            Opts::default(),
        )
        .await?;
        Ok(String::from_utf8_lossy(&out.stdout)
            .split('\0')
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worktree_porcelain() {
        let t = "worktree /a\nHEAD 111\nbranch refs/heads/main\n\nworktree /b\nHEAD 222\ndetached\nlocked reason\n\n";
        let w = parse_worktrees(t);
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].branch.as_deref(), Some("main"));
        assert!(w[1].branch.is_none() && w[1].locked);
    }

    #[test]
    fn rejects_escaping_paths() {
        assert!(safe_rel("../x").is_err());
        assert!(safe_rel("/etc/passwd").is_err());
        assert!(safe_rel("src/a.rs").is_ok());
    }
}
