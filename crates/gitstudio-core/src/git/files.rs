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

    /// Swap `hash` with its parent (`down`, older) or with the next commit on the branch (`up`),
    /// like GitKraken's "Move commit down / up". Uses an interactive rebase whose todo list we
    /// write ourselves; conflicts stop it like any rebase.
    pub async fn move_commit(&self, hash: &str, down: bool) -> Result<()> {
        self.check_rewritable(hash).await?;
        let rev = |r: String| async move {
            run::raw(
                Some(&self.root),
                &["rev-parse", "--verify", "-q", &r],
                Opts::default(),
            )
            .await
            .ok()
            .filter(|o| o.code == 0)
            .map(|o| o.text().trim().to_string())
        };
        let full = rev(format!("{hash}^{{commit}}"))
            .await
            .ok_or_else(|| Error::Invalid(format!("Unknown commit {hash}")))?;
        let (older, newer) = if down {
            let parent = rev(format!("{full}^"))
                .await
                .ok_or_else(|| Error::Invalid("This is already the first commit".into()))?;
            (parent, full)
        } else {
            let range = format!("{full}..HEAD");
            let next = run::ok(
                &self.root,
                &["rev-list", "--reverse", "--first-parent", &range],
                Opts::default(),
            )
            .await?
            .text()
            .lines()
            .next()
            .map(str::to_string)
            .ok_or_else(|| Error::Invalid("This is already the latest commit".into()))?;
            (full, next)
        };
        self.check_rewritable(&older).await?;
        let parents = |h: String| async move {
            run::ok(
                &self.root,
                &["rev-list", "--parents", "-n1", &h],
                Opts::default(),
            )
            .await
            .map(|o| o.text().split_whitespace().count().saturating_sub(1))
        };
        if parents(older.clone()).await? > 1 || parents(newer.clone()).await? > 1 {
            return Err(Error::Invalid("Merge commits cannot be moved".into()));
        }
        let base = rev(format!("{older}^")).await;
        let range = match &base {
            Some(b) => format!("{b}..HEAD"),
            None => "HEAD".into(),
        };
        let list = run::ok(
            &self.root,
            &["rev-list", "--reverse", "--first-parent", &range],
            Opts::default(),
        )
        .await?
        .text();
        let mut todo: Vec<&str> = list.lines().filter(|l| !l.is_empty()).collect();
        let i = todo
            .iter()
            .position(|h| *h == older)
            .ok_or_else(|| Error::Invalid("Commit not found on the current branch".into()))?;
        if todo.get(i + 1) != Some(&newer.as_str()) {
            return Err(Error::Invalid(
                "Commit not found on the current branch".into(),
            ));
        }
        todo.swap(i, i + 1);
        let text: String = todo.iter().map(|h| format!("pick {h}\n")).collect();
        let file = self.git_dir.join("gitstudio-rebase-todo");
        std::fs::write(&file, text)?;
        let path = file.to_string_lossy().replace('\\', "/");
        if path.contains('\'') {
            return Err(Error::Invalid("Unsupported repository path".into()));
        }
        let mut args = vec!["rebase", "-i", "--autostash"];
        match &base {
            Some(b) => args.push(b),
            None => args.push("--root"),
        }
        let res = run::ok(
            &self.root,
            &args,
            Opts {
                stdin: None,
                env: vec![
                    // Git runs the sequence editor through sh with the todo path appended.
                    ("GIT_SEQUENCE_EDITOR".into(), format!("cp '{path}'")),
                    ("GIT_EDITOR".into(), "true".into()),
                ],
            },
        )
        .await;
        let _ = std::fs::remove_file(&file);
        res.map(drop)
    }

    /// The commits an interactive rebase from `from` would rewrite: `from` (included) up to
    /// HEAD along the first parents, oldest first.
    pub async fn rebase_plan(&self, from: &str) -> Result<Vec<Commit>> {
        self.check_rewritable(from).await?;
        let base = self.parent_of(from).await;
        let range = match &base {
            Some(b) => format!("{b}..HEAD"),
            None => "HEAD".into(),
        };
        let out = run::ok(
            &self.root,
            &[
                "log",
                "--first-parent",
                "--reverse",
                super::parse::LOG_FORMAT,
                &range,
                "--",
            ],
            Opts::default(),
        )
        .await?;
        Ok(super::parse::parse_log(&out.text()))
    }

    /// First parent of `rev`, `None` for a root commit.
    async fn parent_of(&self, rev: &str) -> Option<String> {
        run::raw(
            Some(&self.root),
            &["rev-parse", "--verify", "-q", &format!("{rev}^")],
            Opts::default(),
        )
        .await
        .ok()
        .filter(|o| o.code == 0)
        .map(|o| o.text().trim().to_string())
    }

    /// Interactive rebase from `from` with a todo list chosen by the user: every commit of
    /// [`Repo::rebase_plan`] exactly once, in any order, each picked, reworded (with its new
    /// message), squashed or fixed up into the one before it, or dropped. Uncommitted changes are
    /// autostashed; a conflict stops the rebase like any other (continue / abort in the banner).
    pub async fn rebase_steps(&self, from: &str, steps: &[RebaseStep]) -> Result<()> {
        let plan = self.rebase_plan(from).await?;
        let mut want: Vec<&str> = plan.iter().map(|c| c.hash.as_str()).collect();
        let mut got: Vec<&str> = steps.iter().map(|s| s.hash.as_str()).collect();
        want.sort_unstable();
        got.sort_unstable();
        if want != got {
            return Err(Error::Invalid(
                "The branch changed; open the interactive rebase again".into(),
            ));
        }
        if plan.iter().any(|c| c.parents.len() > 1) {
            return Err(Error::Invalid(
                "Merge commits cannot be rebased here".into(),
            ));
        }
        match steps.iter().find(|s| s.action != RebaseAction::Drop) {
            None => {
                return Err(Error::Invalid(
                    "Keep at least one commit, or reset the branch instead".into(),
                ));
            }
            Some(s) if matches!(s.action, RebaseAction::Squash | RebaseAction::Fixup) => {
                return Err(Error::Invalid(
                    "The first kept commit cannot be squashed: there is nothing before it".into(),
                ));
            }
            _ => {}
        }

        let dir = self.git_dir.join("gitstudio-rebase");
        std::fs::create_dir_all(&dir)?;
        let quoted = |p: &Path| -> Result<String> {
            let s = p.to_string_lossy().replace('\\', "/");
            if s.contains('\'') {
                return Err(Error::Invalid("Unsupported repository path".into()));
            }
            Ok(format!("'{s}'"))
        };
        let mut todo = String::new();
        for (i, s) in steps.iter().enumerate() {
            let verb = match s.action {
                RebaseAction::Pick | RebaseAction::Reword => "pick",
                RebaseAction::Squash => "squash",
                RebaseAction::Fixup => "fixup",
                RebaseAction::Drop => "drop",
            };
            todo.push_str(&format!("{verb} {}\n", s.hash));
            if s.action == RebaseAction::Reword {
                let msg = s.message.as_deref().map(str::trim).unwrap_or_default();
                if msg.is_empty() {
                    return Err(Error::Invalid("A reworded commit needs a message".into()));
                }
                let file = dir.join(format!("msg-{i}"));
                std::fs::write(&file, format!("{msg}\n"))?;
                // Message-only amend of the commit just picked.
                todo.push_str(&format!(
                    "exec git commit --amend --only --allow-empty --no-verify -F {}\n",
                    quoted(&file)?
                ));
            }
        }
        let file = dir.join("todo");
        std::fs::write(&file, todo)?;
        let base = self.parent_of(from).await;
        let mut args = vec!["rebase", "-i", "--autostash"];
        match &base {
            Some(b) => args.push(b),
            None => args.push("--root"),
        }
        let res = run::ok(
            &self.root,
            &args,
            Opts {
                stdin: None,
                env: vec![
                    (
                        "GIT_SEQUENCE_EDITOR".into(),
                        format!("cp {}", quoted(&file)?),
                    ),
                    ("GIT_EDITOR".into(), "true".into()),
                ],
            },
        )
        .await;
        // Message files must outlive a rebase stopped on a conflict: `exec` lines still need
        // them when it is continued. Removed once the rebase is over.
        if self.state() == super::model::RepoState::Clean {
            let _ = std::fs::remove_dir_all(&dir);
        }
        res.map(drop)
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

    /// What changes from `base` to `target` (two commits, branches or tags): the files that
    /// differ between their trees, and how many commits each has that the other lacks.
    pub async fn compare_commits(&self, base: &str, target: &str) -> Result<Comparison> {
        check_rev(base)?;
        check_rev(target)?;
        let out = run::ok(
            &self.root,
            &["diff", "--name-status", "-z", "-M", base, target, "--"],
            Opts::default(),
        )
        .await?;
        let range = format!("{base}...{target}");
        let counts = run::ok(
            &self.root,
            &["rev-list", "--left-right", "--count", &range, "--"],
            Opts::default(),
        )
        .await?
        .text();
        let mut it = counts.split_whitespace().map(|n| n.parse().unwrap_or(0));
        let behind = it.next().unwrap_or(0);
        let ahead = it.next().unwrap_or(0);
        Ok(Comparison {
            files: super::parse::parse_name_status(&out.stdout),
            ahead,
            behind,
        })
    }
}

/// What to do with one commit in [`Repo::rebase_steps`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RebaseAction {
    Pick,
    Reword,
    /// Fold into the commit before it, keeping both messages.
    Squash,
    /// Fold into the commit before it, keeping only that commit's message.
    Fixup,
    Drop,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStep {
    pub action: RebaseAction,
    /// Full commit hash, as listed by [`Repo::rebase_plan`].
    pub hash: String,
    /// New message for `reword`.
    #[serde(default)]
    pub message: Option<String>,
}

/// Result of [`Repo::compare_commits`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub files: Vec<FileChange>,
    /// Commits on `target` that `base` does not have.
    pub ahead: u32,
    /// Commits on `base` that `target` does not have.
    pub behind: u32,
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

    /// Add `pattern` to the repository's top-level `.gitignore` (created when missing), in the
    /// file's own line endings. Returns false when the pattern is already listed.
    pub async fn add_to_gitignore(&self, pattern: &str) -> Result<bool> {
        let pattern = pattern.trim();
        if pattern.is_empty() || pattern.contains(['\n', '\r', '\0']) {
            return Err(Error::Invalid(format!(
                "Invalid ignore pattern {pattern:?}"
            )));
        }
        let file = self.root.join(".gitignore");
        let mut text = match std::fs::read(&file) {
            Ok(b) => String::from_utf8_lossy(&b).into_owned(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(e.into()),
        };
        if text.lines().any(|l| l.trim() == pattern) {
            return Ok(false);
        }
        let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
        if !text.is_empty() && !text.ends_with('\n') {
            text.push_str(eol);
        }
        text.push_str(pattern);
        text.push_str(eol);
        std::fs::write(&file, text)?;
        Ok(true)
    }

    /// What `git clean` would delete: untracked files and folders, ignored ones too with
    /// `ignored`. Folders end with `/`.
    pub async fn clean_preview(&self, ignored: bool) -> Result<Vec<String>> {
        let mut a = vec!["-c", "core.quotePath=false", "clean", "-n", "-d"];
        if ignored {
            a.push("-x");
        }
        let out = run::ok(&self.root, &a, Opts::default()).await?;
        Ok(out
            .text()
            .lines()
            .filter_map(|l| l.strip_prefix("Would remove "))
            .map(|p| {
                // Paths with quotes or control characters come back C-quoted.
                p.strip_prefix('"')
                    .and_then(|p| p.strip_suffix('"'))
                    .unwrap_or(p)
                    .to_string()
            })
            .collect())
    }

    /// Delete these untracked (or, with `ignored`, ignored) files and folders: `git clean`.
    pub async fn clean_paths(&self, paths: &[String], ignored: bool) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let mut a = vec!["clean", "-f", "-d", "-q"];
        if ignored {
            a.push("-x");
        }
        a.push("--");
        a.extend(super::checked_paths(paths)?);
        run::ok(&self.root, &a, Opts::default()).await.map(drop)
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
