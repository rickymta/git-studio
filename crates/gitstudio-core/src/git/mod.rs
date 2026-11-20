//! Git operations, implemented on top of the `git` CLI so behaviour (hooks, credential helpers,
//! config, LFS…) matches what the user gets in a terminal.

pub mod files;
pub mod model;
pub mod parse;
pub mod run;

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Deserialize;

use crate::error::{Error, Result};
use model::*;
use run::Opts;

/// Max bytes of diff text sent to the UI.
const MAX_DIFF: usize = 4 * 1024 * 1024;

/// Environment that makes HTTPS requests to github.com authenticate with `token`.
/// Uses `GIT_CONFIG_*` variables so the token never appears on a command line.
pub fn github_auth_env(token: Option<&str>) -> Vec<(String, String)> {
    auth_env(token, None)
}

/// Environment that makes HTTPS requests to github.com / gitlab.com authenticate with the stored
/// tokens. Uses `GIT_CONFIG_*` variables so tokens never appear on a command line.
pub fn auth_env(github: Option<&str>, gitlab: Option<&str>) -> Vec<(String, String)> {
    let b64 = |s: String| base64::engine::general_purpose::STANDARD.encode(s);
    let mut headers: Vec<(&str, String)> = Vec::new();
    if let Some(t) = github {
        headers.push(("https://github.com/", b64(format!("x-access-token:{t}"))));
    }
    if let Some(t) = gitlab {
        // GitLab accepts personal and OAuth tokens as the password of user `oauth2`.
        headers.push(("https://gitlab.com/", b64(format!("oauth2:{t}"))));
    }
    if headers.is_empty() {
        return Vec::new();
    }
    let mut env = vec![("GIT_CONFIG_COUNT".to_string(), headers.len().to_string())];
    for (i, (url, basic)) in headers.into_iter().enumerate() {
        env.push((
            format!("GIT_CONFIG_KEY_{i}"),
            format!("http.{url}.extraheader"),
        ));
        env.push((
            format!("GIT_CONFIG_VALUE_{i}"),
            format!("AUTHORIZATION: basic {basic}"),
        ));
    }
    env
}

/// Options for commands that talk to a remote: stored tokens for HTTPS, chosen key for SSH.
fn net(token: Option<&str>) -> Opts<'static> {
    let gitlab = crate::gitlab::load_token().ok().flatten();
    net_with(token, gitlab.as_deref())
}

fn net_with(github: Option<&str>, gitlab: Option<&str>) -> Opts<'static> {
    let mut env = auth_env(github, gitlab);
    env.extend(crate::ssh::git_env());
    Opts { stdin: None, env }
}

/// An opened repository (its working-tree root).
#[derive(Debug, Clone)]
pub struct Repo {
    pub root: PathBuf,
    pub git_dir: PathBuf,
}

impl Repo {
    /// Open the repository containing `path`.
    pub async fn open(path: &Path) -> Result<Repo> {
        if !path.is_dir() {
            return Err(Error::Invalid(format!(
                "Folder not found: {}",
                path.display()
            )));
        }
        let out = run::raw(
            Some(path),
            &["rev-parse", "--show-toplevel", "--absolute-git-dir"],
            Opts::default(),
        )
        .await?;
        if out.code != 0 {
            return Err(Error::Invalid(format!(
                "{} is not a Git repository",
                path.display()
            )));
        }
        let text = out.text();
        let mut lines = text.lines();
        let (Some(root), Some(git_dir)) = (lines.next(), lines.next()) else {
            return Err(Error::Invalid(
                "Bare repositories are not supported".to_string(),
            ));
        };
        Ok(Repo {
            root: PathBuf::from(root),
            git_dir: PathBuf::from(git_dir),
        })
    }

    async fn git(&self, args: &[&str]) -> Result<String> {
        run::text(&self.root, args).await
    }

    async fn git_opts(&self, args: &[&str], opts: Opts<'_>) -> Result<String> {
        Ok(run::ok(&self.root, args, opts).await?.text())
    }

    /// Like [`net`], but a host with an account chosen for this repository (or globally) in
    /// Preferences → Credentials authenticates through the credential helper with that account
    /// instead of GitStudio's own sign-in token.
    async fn net(&self, github: Option<&str>) -> Opts<'static> {
        let github = match github {
            Some(t) if !crate::credentials::account_chosen(&self.root, "github.com").await => {
                Some(t)
            }
            _ => None,
        };
        let gitlab = match crate::gitlab::load_token().ok().flatten() {
            Some(t) if !crate::credentials::account_chosen(&self.root, "gitlab.com").await => {
                Some(t)
            }
            _ => None,
        };
        net_with(github, gitlab.as_deref())
    }

    pub fn state(&self) -> RepoState {
        let g = &self.git_dir;
        if g.join("rebase-merge").exists() || g.join("rebase-apply").exists() {
            RepoState::Rebasing
        } else if g.join("MERGE_HEAD").exists() {
            RepoState::Merging
        } else if g.join("CHERRY_PICK_HEAD").exists() {
            RepoState::CherryPicking
        } else if g.join("REVERT_HEAD").exists() {
            RepoState::Reverting
        } else {
            RepoState::Clean
        }
    }

    pub async fn info(&self) -> Result<RepoInfo> {
        let status = self.status().await?;
        Ok(RepoInfo {
            path: self.root.display().to_string(),
            name: self
                .root
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            git_dir: self.git_dir.display().to_string(),
            state: self.state(),
            status,
        })
    }

    pub async fn status(&self) -> Result<Status> {
        let out = run::ok(
            &self.root,
            &[
                "--no-optional-locks",
                "status",
                "--porcelain=v2",
                "-z",
                "--branch",
                "--untracked-files=all",
            ],
            Opts::default(),
        )
        .await?;
        Ok(parse::parse_status(&out.stdout))
    }

    async fn has_head(&self) -> bool {
        run::raw(
            Some(&self.root),
            &["rev-parse", "--verify", "-q", "HEAD"],
            Opts::default(),
        )
        .await
        .map(|o| o.code == 0)
        .unwrap_or(false)
    }

    // ---- history ------------------------------------------------------------------------------

    pub async fn log(&self, limit: u32, skip: u32) -> Result<Vec<Commit>> {
        self.log_view(limit, skip, &LogView::default()).await
    }

    /// History for the graph. `view.solo`: only these refs; `view.hidden`: every ref but these.
    pub async fn log_view(&self, limit: u32, skip: u32, view: &LogView) -> Result<Vec<Commit>> {
        let n = format!("-n{limit}");
        let s = format!("--skip={skip}");
        for r in view.solo.iter().chain(&view.hidden) {
            check_rev(r)?;
        }
        let mut a: Vec<String> = vec![
            "log".into(),
            "--date-order".into(),
            n,
            s,
            parse::LOG_FORMAT.to_string(),
        ];
        if view.solo.is_empty() && view.hidden.is_empty() {
            a.extend(["--exclude=refs/stash".into(), "--all".into(), "HEAD".into()]);
        } else if view.solo.is_empty() {
            // Not `--all`: it always includes HEAD, so the checked-out branch could not be
            // hidden. Each `--exclude` only applies to the next ref-set option.
            // Patterns are relative to each set's namespace (`side`, not `refs/heads/side`).
            for (set, prefix) in [
                ("--branches", "refs/heads/"),
                ("--remotes", "refs/remotes/"),
                ("--tags", "refs/tags/"),
            ] {
                for r in &view.hidden {
                    if let Some(name) = r.strip_prefix(prefix) {
                        a.push(format!("--exclude={name}"));
                    }
                }
                a.push(set.into());
            }
            // HEAD too (detached commits), unless it is the branch being hidden.
            let head_ref = run::raw(
                Some(&self.root),
                &["symbolic-ref", "-q", "HEAD"],
                Opts::default(),
            )
            .await
            .map(|o| o.text().trim().to_string())
            .unwrap_or_default();
            if !view.hidden.contains(&head_ref) {
                a.push("HEAD".into());
            }
        } else {
            a.extend(view.solo.iter().cloned());
            a.push("--".into());
        }
        let args: Vec<&str> = a.iter().map(String::as_str).collect();
        let out = run::raw(Some(&self.root), &args, Opts::default()).await?;
        if out.code != 0 {
            // Unborn HEAD with no other refs: nothing to show yet.
            if !self.has_head().await {
                return self.log_without_head(limit, skip).await;
            }
            return Err(run::failure(&out));
        }
        Ok(parse::parse_log(&out.text()))
    }

    async fn log_without_head(&self, limit: u32, skip: u32) -> Result<Vec<Commit>> {
        let n = format!("-n{limit}");
        let s = format!("--skip={skip}");
        let out = run::raw(
            Some(&self.root),
            &[
                "log",
                "--date-order",
                "--exclude=refs/stash",
                "--all",
                &n,
                &s,
                parse::LOG_FORMAT,
            ],
            Opts::default(),
        )
        .await?;
        Ok(if out.code == 0 {
            parse::parse_log(&out.text())
        } else {
            Vec::new()
        })
    }

    /// Commits of every branch, tag and remote branch (and HEAD) matching `q`, newest first.
    /// Unlike the graph's quick filter this asks git, so commits not loaded yet are found too.
    pub async fn search_commits(&self, q: &CommitSearch, limit: u32) -> Result<Vec<Commit>> {
        let (message, author, content, path) = (
            q.message.trim(),
            q.author.trim(),
            q.content.trim(),
            q.path.trim(),
        );
        if [message, author, content, path]
            .iter()
            .all(|s| s.is_empty())
        {
            return Err(Error::Invalid("Nothing to search for".into()));
        }
        if [message, author, content, path]
            .iter()
            .any(|s| s.contains(['\0', '\n']))
        {
            return Err(Error::Invalid("Search text must be a single line".into()));
        }
        let mut a: Vec<String> = vec![
            "log".into(),
            "--date-order".into(),
            format!("-n{limit}"),
            parse::LOG_FORMAT.into(),
            "--regexp-ignore-case".into(),
            "--fixed-strings".into(),
            // `--grep` and `--author` both have to match (not either).
            "--all-match".into(),
        ];
        if !message.is_empty() {
            a.push(format!("--grep={message}"));
        }
        if !author.is_empty() {
            a.push(format!("--author={author}"));
        }
        if !content.is_empty() {
            a.push(format!("-S{content}"));
        }
        a.extend(["--exclude=refs/stash".into(), "--all".into()]);
        if self.has_head().await {
            a.push("HEAD".into());
        }
        a.push("--".into());
        if !path.is_empty() {
            check_path(path)?;
            a.push(path.replace('\\', "/"));
        }
        let args: Vec<&str> = a.iter().map(String::as_str).collect();
        let out = run::raw(Some(&self.root), &args, Opts::default()).await?;
        if out.code != 0 {
            if !self.has_head().await && out.text().trim().is_empty() {
                return Ok(Vec::new());
            }
            return Err(run::failure(&out));
        }
        Ok(parse::parse_log(&out.text()))
    }

    pub async fn commit_detail(&self, hash: &str) -> Result<CommitDetail> {
        check_rev(hash)?;
        let fmt = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ct%x1f%s%x1f%ce%x1f%B";
        let text = self.git(&["show", "-s", fmt, hash]).await?;
        let f: Vec<&str> = text.splitn(10, parse::US).collect();
        if f.len() < 10 {
            return Err(Error::Git(format!("Unexpected output for commit {hash}")));
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
        let files = self.commit_files(&commit).await?;
        Ok(CommitDetail {
            committer_email: f[8].to_string(),
            body: f[9].trim_end().to_string(),
            files,
            commit,
        })
    }

    async fn commit_files(&self, c: &Commit) -> Result<Vec<FileChange>> {
        let out = match c.parents.first() {
            Some(p) => {
                run::ok(
                    &self.root,
                    &["diff-tree", "-r", "-M", "--name-status", "-z", p, &c.hash],
                    Opts::default(),
                )
                .await?
            }
            None => {
                run::ok(
                    &self.root,
                    &[
                        "diff-tree",
                        "--root",
                        "--no-commit-id",
                        "-r",
                        "--name-status",
                        "-z",
                        &c.hash,
                    ],
                    Opts::default(),
                )
                .await?
            }
        };
        Ok(parse::parse_name_status(&out.stdout))
    }

    // ---- refs ---------------------------------------------------------------------------------

    pub async fn refs(&self) -> Result<Refs> {
        let refs_text = self
            .git(&[
                "for-each-ref",
                parse::REF_FORMAT,
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ])
            .await?;
        let stash_out = run::raw(
            Some(&self.root),
            &["stash", "list", parse::STASH_FORMAT],
            Opts::default(),
        )
        .await?;
        let remotes_text = self.git(&["remote", "-v"]).await?;
        Ok(Refs {
            refs: parse::parse_refs(&refs_text),
            stashes: if stash_out.code == 0 {
                parse::parse_stashes(&stash_out.text())
            } else {
                Vec::new()
            },
            remotes: parse::parse_remotes(&remotes_text),
        })
    }

    // ---- diffs --------------------------------------------------------------------------------

    pub async fn diff(&self, req: &DiffRequest) -> Result<String> {
        check_path(&req.path)?;
        let mut paths: Vec<&str> = Vec::new();
        if let Some(o) = &req.orig_path {
            check_path(o)?;
            paths.push(o);
        }
        paths.push(&req.path);

        let context = req
            .context
            .map(|n| format!("--unified={}", n.min(1_000_000)));
        let mut extra: Vec<&str> = Vec::new();
        if req.ignore_whitespace {
            // Leading/trailing and amount-of-whitespace changes.
            extra.extend(["--ignore-space-change", "--ignore-space-at-eol"]);
        }
        if let Some(c) = &context {
            extra.push(c);
        }
        let mut base = vec!["diff", "--no-color", "--no-ext-diff", "-M"];
        base.extend(&extra);
        let out = match req.source {
            DiffSource::Unstaged if req.untracked => {
                let mut a = vec!["diff", "--no-color", "--no-index"];
                a.extend(&extra);
                a.extend(["--", "/dev/null", &req.path]);
                run::raw(Some(&self.root), &a, Opts::default()).await?
            }
            DiffSource::Unstaged => {
                let mut a: Vec<&str> = base.to_vec();
                a.push("--");
                a.extend(&paths);
                run::ok(&self.root, &a, Opts::default()).await?
            }
            DiffSource::Staged => {
                let mut a: Vec<&str> = base.to_vec();
                a.push("--cached");
                a.push("--");
                a.extend(&paths);
                run::ok(&self.root, &a, Opts::default()).await?
            }
            DiffSource::Worktree => {
                let hash = req
                    .commit
                    .as_deref()
                    .ok_or_else(|| Error::Invalid("commit is required".into()))?;
                check_rev(hash)?;
                let mut a: Vec<&str> = base.to_vec();
                a.push(hash);
                a.push("--");
                a.extend(&paths);
                run::ok(&self.root, &a, Opts::default()).await?
            }
            DiffSource::Commit => {
                let hash = req
                    .commit
                    .as_deref()
                    .ok_or_else(|| Error::Invalid("commit is required".into()))?;
                check_rev(hash)?;
                let parent = req.parent.as_deref();
                let mut a: Vec<&str> = match parent {
                    Some(p) => {
                        check_rev(p)?;
                        let mut v = base.to_vec();
                        v.push(p);
                        v.push(hash);
                        v
                    }
                    None => {
                        let mut v = vec!["show", "--no-color", "--no-ext-diff", "--format="];
                        v.extend(&extra);
                        v.push(hash);
                        v
                    }
                };
                a.push("--");
                a.extend(&paths);
                run::ok(&self.root, &a, Opts::default()).await?
            }
        };
        let mut text = out.stdout;
        if text.len() > MAX_DIFF {
            text.truncate(MAX_DIFF);
        }
        Ok(crate::text::decode_raw(&text, req.encoding.as_deref()))
    }

    // ---- index and working tree --------------------------------------------------------------

    pub async fn stage(&self, paths: &[String]) -> Result<()> {
        if paths.is_empty() {
            self.git(&["add", "-A"]).await?;
            return Ok(());
        }
        let mut a = vec!["add", "-A", "--"];
        a.extend(checked_paths(paths)?);
        self.git(&a).await.map(drop)
    }

    pub async fn unstage(&self, paths: &[String]) -> Result<()> {
        let has_head = self.has_head().await;
        let mut a: Vec<&str> = if has_head {
            vec!["reset", "-q", "HEAD", "--"]
        } else {
            vec!["rm", "--cached", "-r", "-q", "--"]
        };
        if paths.is_empty() {
            if has_head {
                a.truncate(3);
            } else {
                a.push(".");
            }
        } else {
            a.extend(checked_paths(paths)?);
        }
        self.git(&a).await.map(drop)
    }

    /// Throw away working-tree changes. Untracked paths are deleted.
    pub async fn discard(&self, tracked: &[String], untracked: &[String]) -> Result<()> {
        if !tracked.is_empty() {
            let mut a = vec!["checkout", "--"];
            a.extend(checked_paths(tracked)?);
            self.git(&a).await?;
        }
        if !untracked.is_empty() {
            let mut a = vec!["clean", "-f", "-q", "--"];
            a.extend(checked_paths(untracked)?);
            self.git(&a).await?;
        }
        Ok(())
    }

    /// Apply a patch (built by the UI from one hunk) to the index or the working tree.
    pub async fn apply_patch(
        &self,
        patch: &str,
        cached: bool,
        reverse: bool,
        encoding: Option<&str>,
    ) -> Result<()> {
        let bytes = crate::text::encode_raw(patch, encoding);
        let mut a = vec!["apply", "--whitespace=nowarn", "--recount"];
        if cached {
            a.push("--cached");
        }
        if reverse {
            a.push("--reverse");
        }
        a.push("-");
        self.git_opts(
            &a,
            Opts {
                stdin: Some(&bytes),
                env: Vec::new(),
            },
        )
        .await
        .map(drop)
    }

    pub async fn commit(&self, message: &str, amend: bool) -> Result<()> {
        if message.trim().is_empty() {
            return Err(Error::Invalid("Commit message is empty".into()));
        }
        let mut a = vec!["commit", "-F", "-"];
        if amend {
            a.push("--amend");
        }
        self.git_opts(
            &a,
            Opts {
                stdin: Some(message.as_bytes()),
                env: Vec::new(),
            },
        )
        .await
        .map(drop)
    }

    /// Remote-tracking branches (`origin/main`, …) whose history already contains `hash`, so
    /// rewriting it would rewrite published history even when the branch has no upstream.
    pub async fn remotes_containing(&self, hash: &str) -> Result<Vec<String>> {
        check_rev(hash)?;
        let out = self
            .git(&[
                "branch",
                "-r",
                "--format=%(refname:short)",
                "--contains",
                hash,
            ])
            .await?;
        Ok(out
            .lines()
            .map(str::trim)
            // `origin/HEAD` is only a pointer to another remote branch.
            .filter(|l| !l.is_empty() && !l.ends_with("/HEAD"))
            .map(str::to_string)
            .collect())
    }

    /// Replace the message of HEAD, which must still be `expected` (the commit the user was
    /// editing), without folding in staged changes: `commit --amend --only` with no paths commits
    /// HEAD's own tree, leaving the index and working tree as they are. Returns the new HEAD.
    pub async fn amend_message(&self, expected: &str, message: &str) -> Result<String> {
        check_rev(expected)?;
        if message.trim().is_empty() {
            return Err(Error::Invalid("Commit message is empty".into()));
        }
        if self.state() != RepoState::Clean {
            return Err(Error::Invalid(
                "Finish or abort the operation in progress first".into(),
            ));
        }
        let head = self.git(&["rev-parse", "--verify", "-q", "HEAD"]).await?;
        let want = self
            .git(&[
                "rev-parse",
                "--verify",
                "-q",
                &format!("{expected}^{{commit}}"),
            ])
            .await?;
        if head.trim() != want.trim() {
            return Err(Error::Invalid(
                "HEAD has moved; only the latest commit of the current branch can be amended"
                    .into(),
            ));
        }
        self.git_opts(
            &["commit", "--amend", "--only", "--allow-empty", "-F", "-"],
            Opts {
                stdin: Some(message.as_bytes()),
                env: Vec::new(),
            },
        )
        .await?;
        Ok(self.git(&["rev-parse", "HEAD"]).await?.trim().to_string())
    }

    pub async fn head_message(&self) -> Result<String> {
        Ok(self
            .git(&["log", "-1", "--format=%B"])
            .await?
            .trim_end()
            .to_string())
    }

    // ---- conflicts ----------------------------------------------------------------------------

    /// Resolve conflicted paths by taking one side entirely, then stage them.
    pub async fn resolve(&self, paths: &[String], side: &str) -> Result<()> {
        let flag = match side {
            "ours" => "--ours",
            "theirs" => "--theirs",
            _ => return Err(Error::Invalid(format!("Unknown side {side}"))),
        };
        let mut a = vec!["checkout", flag, "--"];
        a.extend(checked_paths(paths)?);
        self.git(&a).await?;
        self.stage(paths).await
    }

    pub async fn abort(&self) -> Result<()> {
        let args: &[&str] = match self.state() {
            RepoState::Merging => &["merge", "--abort"],
            RepoState::Rebasing => &["rebase", "--abort"],
            RepoState::CherryPicking => &["cherry-pick", "--abort"],
            RepoState::Reverting => &["revert", "--abort"],
            RepoState::Clean => return Ok(()),
        };
        self.git(args).await.map(drop)
    }

    pub async fn continue_op(&self) -> Result<()> {
        let args: &[&str] = match self.state() {
            RepoState::Merging => &["commit", "--no-edit"],
            RepoState::Rebasing => &["rebase", "--continue"],
            RepoState::CherryPicking => &["cherry-pick", "--continue"],
            RepoState::Reverting => &["revert", "--continue"],
            RepoState::Clean => return Ok(()),
        };
        self.git(args).await.map(drop)
    }

    // ---- branches -----------------------------------------------------------------------------

    pub async fn checkout(&self, target: &str, kind: CheckoutKind) -> Result<()> {
        check_rev(target)?;
        match kind {
            CheckoutKind::Branch => self.git(&["switch", target]).await.map(drop),
            CheckoutKind::Detached => self.git(&["switch", "--detach", target]).await.map(drop),
            CheckoutKind::RemoteReset => {
                let local = local_name_of(target)?;
                self.git(&["switch", "-C", local, "--track", target])
                    .await
                    .map(drop)
            }
            CheckoutKind::Remote => {
                let local = local_name_of(target)?;
                let exists = run::raw(
                    Some(&self.root),
                    &["show-ref", "--verify", "-q", &format!("refs/heads/{local}")],
                    Opts::default(),
                )
                .await?
                .code
                    == 0;
                if exists {
                    self.git(&["switch", local]).await.map(drop)
                } else {
                    self.git(&["switch", "-c", local, "--track", target])
                        .await
                        .map(drop)
                }
            }
        }
    }

    /// Where HEAD has been, newest first, `limit` entries after `skip`. Entries whose commit no
    /// branch, tag or remote branch contains are flagged (`unreferenced`): lost work to recover.
    /// Empty for a repository without a reflog (unborn HEAD).
    pub async fn reflog(&self, limit: u32, skip: u32) -> Result<Vec<ReflogEntry>> {
        let n = format!("-n{limit}");
        let s = format!("--skip={skip}");
        let out = run::raw(
            Some(&self.root),
            &[
                "log",
                "-g",
                "--date=unix",
                parse::REFLOG_FORMAT,
                &n,
                &s,
                "HEAD",
            ],
            Opts::default(),
        )
        .await?;
        if out.code != 0 {
            return Ok(Vec::new());
        }
        let mut entries = parse::parse_reflog(&out.text(), skip as usize);
        let mut tips: Vec<&str> = entries.iter().map(|e| e.hash.as_str()).collect();
        tips.sort_unstable();
        tips.dedup();
        if tips.is_empty() {
            return Ok(entries);
        }
        // One walk for all entries: commits reachable from them but from no ref.
        let mut a = vec!["rev-list"];
        a.extend(tips.iter().copied());
        a.extend(["--not", "--branches", "--tags", "--remotes"]);
        let lost: std::collections::HashSet<String> =
            self.git(&a).await?.lines().map(str::to_string).collect();
        for e in &mut entries {
            e.unreferenced = lost.contains(&e.hash);
        }
        Ok(entries)
    }

    /// Commits reachable from `rev` but from no branch, tag or remote branch: what would be hard
    /// to find again once HEAD leaves a detached `rev`.
    pub async fn unreferenced_commits(&self, rev: &str) -> Result<u32> {
        check_rev(rev)?;
        let out = self
            .git(&[
                "rev-list",
                "--count",
                rev,
                "--not",
                "--branches",
                "--tags",
                "--remotes",
            ])
            .await?;
        Ok(out.trim().parse().unwrap_or(0))
    }

    pub async fn create_branch(
        &self,
        name: &str,
        start: Option<&str>,
        checkout: bool,
    ) -> Result<()> {
        check_ref_name(&self.root, name).await?;
        let start = start.unwrap_or("HEAD");
        check_rev(start)?;
        if checkout {
            self.git(&["switch", "-c", name, start]).await.map(drop)
        } else {
            self.git(&["branch", name, start]).await.map(drop)
        }
    }

    pub async fn delete_branch(&self, name: &str, force: bool) -> Result<()> {
        check_rev(name)?;
        self.git(&["branch", if force { "-D" } else { "-d" }, name])
            .await
            .map(drop)
    }

    pub async fn rename_branch(&self, old: &str, new: &str) -> Result<()> {
        check_rev(old)?;
        check_ref_name(&self.root, new).await?;
        self.git(&["branch", "-m", old, new]).await.map(drop)
    }

    pub async fn set_upstream(&self, branch: &str, upstream: Option<&str>) -> Result<()> {
        check_rev(branch)?;
        match upstream {
            Some(u) => {
                check_rev(u)?;
                self.git(&["branch", "--set-upstream-to", u, branch])
                    .await
                    .map(drop)
            }
            None => self
                .git(&["branch", "--unset-upstream", branch])
                .await
                .map(drop),
        }
    }

    pub async fn merge(&self, target: &str, no_ff: bool) -> Result<()> {
        check_rev(target)?;
        let mut a = vec!["merge", "--no-edit"];
        if no_ff {
            a.push("--no-ff");
        }
        a.push(target);
        self.git(&a).await.map(drop)
    }

    /// Bring `target`'s changes into the index and working tree as one set of changes, without
    /// a merge commit or moving HEAD (`git merge --squash`); committing them is up to the user.
    pub async fn merge_squash(&self, target: &str) -> Result<()> {
        check_rev(target)?;
        self.git(&["merge", "--squash", target]).await.map(drop)
    }

    /// Move local `branch` forward to `target` without checking it out; anything but a
    /// fast-forward is refused. A branch checked out here or in another worktree is moved with
    /// `merge --ff-only` inside that worktree, so its files follow the branch.
    pub async fn fast_forward(&self, branch: &str, target: &str) -> Result<()> {
        check_rev(branch)?;
        check_rev(target)?;
        let full = format!("refs/heads/{branch}");
        let new = self
            .git(&["rev-parse", "--verify", &format!("{target}^{{commit}}")])
            .await?
            .trim()
            .to_string();
        let old = self
            .git(&["rev-parse", "--verify", &full])
            .await?
            .trim()
            .to_string();
        if old == new {
            return Ok(());
        }
        let ancestor = run::raw(
            Some(&self.root),
            &["merge-base", "--is-ancestor", &old, &new],
            Opts::default(),
        )
        .await?
        .code
            == 0;
        if !ancestor {
            return Err(Error::Invalid(format!(
                "{branch} cannot be fast-forwarded to {target}: the branches have diverged"
            )));
        }
        let checked_out = self
            .worktrees()
            .await?
            .into_iter()
            .find(|w| w.branch.as_deref() == Some(branch));
        match checked_out {
            Some(w) => run::ok(
                Path::new(&w.path),
                &["merge", "--ff-only", &new],
                Opts::default(),
            )
            .await
            .map(drop),
            None => {
                let msg = format!("fast-forward: {target}");
                self.git(&["update-ref", "-m", &msg, &full, &new, &old])
                    .await
                    .map(drop)
            }
        }
    }

    pub async fn rebase(&self, onto: &str) -> Result<()> {
        check_rev(onto)?;
        self.git(&["rebase", onto]).await.map(drop)
    }

    pub async fn cherry_pick(&self, hash: &str, is_merge: bool) -> Result<()> {
        check_rev(hash)?;
        let mut a = vec!["cherry-pick"];
        if is_merge {
            a.extend(["-m", "1"]);
        }
        a.push(hash);
        self.git(&a).await.map(drop)
    }

    pub async fn revert(&self, hash: &str, is_merge: bool) -> Result<()> {
        check_rev(hash)?;
        let mut a = vec!["revert", "--no-edit"];
        if is_merge {
            a.extend(["-m", "1"]);
        }
        a.push(hash);
        self.git(&a).await.map(drop)
    }

    pub async fn reset(&self, target: &str, mode: &str) -> Result<()> {
        check_rev(target)?;
        let flag = match mode {
            "soft" => "--soft",
            "mixed" => "--mixed",
            "hard" => "--hard",
            // Like hard, but refuses to overwrite uncommitted changes (used by Undo).
            "keep" => "--keep",
            _ => return Err(Error::Invalid(format!("Unknown reset mode {mode}"))),
        };
        self.git(&["reset", flag, target]).await.map(drop)
    }

    // ---- tags ---------------------------------------------------------------------------------

    pub async fn create_tag(&self, name: &str, target: &str, message: Option<&str>) -> Result<()> {
        check_ref_name(&self.root, &format!("tags/{name}")).await?;
        check_rev(target)?;
        match message.filter(|m| !m.trim().is_empty()) {
            Some(m) => self
                .git(&["tag", "-a", name, "-m", m, target])
                .await
                .map(drop),
            None => self.git(&["tag", name, target]).await.map(drop),
        }
    }

    pub async fn delete_tag(&self, name: &str) -> Result<()> {
        check_rev(name)?;
        self.git(&["tag", "-d", name]).await.map(drop)
    }

    // ---- stash --------------------------------------------------------------------------------

    pub async fn stash_save(&self, message: Option<&str>, include_untracked: bool) -> Result<()> {
        self.stash_save_with(message, include_untracked, false)
            .await
    }

    /// `staged_only`: stash just the staged changes (`git stash push --staged`), like
    /// GitKraken's "Stage Changes to Stash".
    pub async fn stash_save_with(
        &self,
        message: Option<&str>,
        include_untracked: bool,
        staged_only: bool,
    ) -> Result<()> {
        self.stash_push(&StashPush {
            message: message.map(str::to_string),
            include_untracked,
            staged_only,
            ..Default::default()
        })
        .await
    }

    /// `git stash push` with every option the UI offers: only some files (`paths`), keep the
    /// staged changes in place as well (`keep_index`), or only the staged changes.
    pub async fn stash_push(&self, o: &StashPush) -> Result<()> {
        let mut a = vec!["stash", "push"];
        if o.staged_only {
            a.push("--staged");
        } else {
            if o.include_untracked {
                a.push("--include-untracked");
            }
            if o.keep_index {
                a.push("--keep-index");
            }
        }
        if let Some(m) = o.message.as_deref().filter(|m| !m.trim().is_empty()) {
            a.extend(["-m", m]);
        }
        if !o.paths.is_empty() {
            a.push("--");
            a.extend(checked_paths(&o.paths)?);
        }
        self.git(&a).await.map(drop)
    }

    /// Check out a new branch at the commit stash `index` was made on and apply the stash there
    /// (dropped when it applies cleanly): `git stash branch`.
    pub async fn stash_branch(&self, name: &str, index: u32) -> Result<()> {
        check_ref_name(&self.root, &format!("heads/{name}")).await?;
        self.git(&["stash", "branch", name, &format!("stash@{{{index}}}")])
            .await
            .map(drop)
    }

    async fn stashes(&self) -> Result<Vec<model::Stash>> {
        let out = self.git(&["stash", "list", parse::STASH_FORMAT]).await?;
        Ok(parse::parse_stashes(&out))
    }

    /// Change a stash's message, keeping every stash in its place. Git has no command for it:
    /// the newer stashes and this one are dropped and stored back, oldest first.
    pub async fn stash_rename(&self, index: u32, message: &str) -> Result<()> {
        if message.trim().is_empty() {
            return Err(Error::Invalid("Stash message is empty".into()));
        }
        let list = self.stashes().await?;
        let target = list
            .iter()
            .find(|s| s.index == index)
            .ok_or_else(|| Error::Invalid(format!("stash@{{{index}}} not found")))?;
        // Keep git's "On <branch>: " prefix so the stash still says where it came from.
        let prefix = target
            .message
            .split_once(": ")
            .filter(|(p, _)| p.starts_with("On ") || p.starts_with("WIP on "))
            .map(|(p, _)| format!("{p}: "))
            .unwrap_or_default();
        let mut top: Vec<(String, String)> = list
            .iter()
            .filter(|s| s.index <= index)
            .map(|s| {
                let msg = if s.index == index {
                    format!("{prefix}{}", message.trim())
                } else {
                    s.message.clone()
                };
                (s.hash.clone(), msg)
            })
            .collect();
        for _ in 0..top.len() {
            self.git(&["stash", "drop", "-q", "stash@{0}"]).await?;
        }
        // Oldest first, so the newest ends up as stash@{0} again.
        top.reverse();
        for (hash, msg) in &top {
            self.git(&["stash", "store", "-m", msg, hash]).await?;
        }
        Ok(())
    }

    pub async fn stash_op(&self, op: &str, index: u32) -> Result<()> {
        let name = format!("stash@{{{index}}}");
        let verb = match op {
            "apply" | "pop" | "drop" => op,
            _ => return Err(Error::Invalid(format!("Unknown stash op {op}"))),
        };
        self.git(&["stash", verb, &name]).await.map(drop)
    }

    // ---- remotes ------------------------------------------------------------------------------

    pub async fn fetch(&self, remote: Option<&str>, token: Option<&str>) -> Result<()> {
        let mut a = vec!["fetch", "--tags"];
        if crate::settings::load().auto_prune {
            a.push("--prune");
        }
        match remote {
            Some(r) => {
                check_rev(r)?;
                a.push(r);
            }
            None => a.push("--all"),
        }
        self.git_opts(&a, self.net(token).await).await.map(drop)
    }

    /// `remote`: pull from that remote instead of the upstream. The branch pulled is the
    /// upstream's branch when it lives on that remote, otherwise the current branch's name.
    pub async fn pull(&self, mode: &str, remote: Option<&str>, token: Option<&str>) -> Result<()> {
        let flag = match mode {
            "ff-only" => "--ff-only",
            "rebase" => "--rebase",
            _ => "--no-rebase",
        };
        let mut a: Vec<String> = vec!["pull".into(), "--no-edit".into(), flag.into()];
        if let Some(remote) = remote {
            check_rev(remote)?;
            let status = self.status().await?;
            let branch = status
                .branch
                .clone()
                .ok_or_else(|| Error::Invalid("HEAD is detached; nothing to pull into".into()))?;
            let merge = status
                .upstream
                .as_deref()
                .and_then(|u| u.strip_prefix(remote)?.strip_prefix('/'))
                .map(str::to_string)
                .unwrap_or(branch);
            check_rev(&merge)?;
            a.push(remote.into());
            a.push(merge);
        }
        let args: Vec<&str> = a.iter().map(String::as_str).collect();
        self.git_opts(&args, self.net(token).await).await.map(drop)
    }

    pub async fn push(&self, req: &PushRequest, token: Option<&str>) -> Result<()> {
        let status = self.status().await?;
        let mut a: Vec<String> = vec!["push".into()];
        if req.force {
            a.push("--force-with-lease".into());
        }
        if let Some(tag) = &req.tag {
            check_rev(tag)?;
            a.push(req.remote.clone().unwrap_or_else(|| "origin".into()));
            a.push(format!("refs/tags/{tag}"));
        } else {
            let branch = match &req.branch {
                Some(b) => b.clone(),
                None => status
                    .branch
                    .clone()
                    .ok_or_else(|| Error::Invalid("HEAD is detached; nothing to push".into()))?,
            };
            check_rev(&branch)?;
            let has_upstream = req.branch.is_none() && status.upstream.is_some();
            if has_upstream && req.remote.is_none() {
                // Plain `git push` to the configured upstream.
            } else {
                let remote = match &req.remote {
                    Some(r) => r.clone(),
                    None => self.default_remote().await?,
                };
                check_rev(&remote)?;
                if !has_upstream {
                    a.push("--set-upstream".into());
                }
                a.push(remote);
                a.push(format!("{branch}:{branch}"));
            }
        }
        let args: Vec<&str> = a.iter().map(String::as_str).collect();
        self.git_opts(&args, self.net(token).await).await.map(drop)
    }

    pub async fn delete_remote_ref(
        &self,
        remote: &str,
        name: &str,
        token: Option<&str>,
    ) -> Result<()> {
        check_rev(remote)?;
        check_rev(name)?;
        self.git_opts(&["push", remote, "--delete", name], self.net(token).await)
            .await
            .map(drop)
    }

    async fn default_remote(&self) -> Result<String> {
        let remotes = self.git(&["remote"]).await?;
        let list: Vec<&str> = remotes.lines().collect();
        if list.contains(&"origin") {
            return Ok("origin".into());
        }
        list.first()
            .map(|s| s.to_string())
            .ok_or_else(|| Error::Invalid("This repository has no remote. Add one first.".into()))
    }

    pub async fn add_remote(&self, name: &str, url: &str) -> Result<()> {
        check_rev(name)?;
        check_url(url)?;
        self.git(&["remote", "add", name, url]).await.map(drop)
    }

    /// `push`: set the push URL (`remote.<name>.pushurl`) instead of the fetch URL.
    pub async fn set_remote_url(&self, name: &str, url: &str, push: bool) -> Result<()> {
        check_rev(name)?;
        check_url(url)?;
        if push {
            self.git(&["remote", "set-url", "--push", name, url])
                .await
                .map(drop)
        } else {
            self.git(&["remote", "set-url", name, url]).await.map(drop)
        }
    }

    pub async fn rename_remote(&self, from: &str, to: &str) -> Result<()> {
        check_rev(from)?;
        check_rev(to)?;
        self.git(&["remote", "rename", from, to]).await.map(drop)
    }

    pub async fn remove_remote(&self, name: &str) -> Result<()> {
        check_rev(name)?;
        self.git(&["remote", "remove", name]).await.map(drop)
    }

    // ---- identity -----------------------------------------------------------------------------

    pub async fn identity(&self) -> Result<Identity> {
        let get = |key: &'static str| async move {
            run::raw(Some(&self.root), &["config", "--get", key], Opts::default())
                .await
                .map(|o| o.text().trim().to_string())
                .unwrap_or_default()
        };
        Ok(Identity {
            name: get("user.name").await,
            email: get("user.email").await,
        })
    }

    pub async fn set_identity(&self, name: &str, email: &str, global: bool) -> Result<()> {
        let scope = if global { "--global" } else { "--local" };
        self.git(&["config", scope, "user.name", name]).await?;
        self.git(&["config", scope, "user.email", email]).await?;
        Ok(())
    }
}

// ---- repository creation ----------------------------------------------------------------------

pub async fn init(path: &Path, branch: &str) -> Result<Repo> {
    std::fs::create_dir_all(path)?;
    check_rev(branch)?;
    run::ok(path, &["init", "-b", branch], Opts::default()).await?;
    Repo::open(path).await
}

pub async fn clone(url: &str, dest: &Path, token: Option<&str>) -> Result<Repo> {
    clone_with(url, dest, token, CloneOptions::default()).await
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CloneOptions {
    /// Only the latest commit of each branch (`--depth 1 --no-single-branch`).
    pub shallow: bool,
    /// Check out only the top-level files; add folders later with `git sparse-checkout`.
    pub sparse: bool,
    /// `--depth N` (history depth); overrides `shallow`.
    pub depth: Option<u32>,
    /// `--recurse-submodules`.
    pub recursive: bool,
    /// `--bare`: a repository without a working tree.
    pub bare: bool,
    /// `--no-checkout`.
    pub no_checkout: bool,
    /// `--branch <name>`: check out this branch instead of the remote's default.
    pub branch: Option<String>,
    /// `--origin <name>`: name of the remote (default `origin`).
    pub origin: Option<String>,
    /// Download Git LFS files after cloning (`git lfs install --local` + `git lfs pull`).
    pub lfs: bool,
}

pub async fn clone_with(
    url: &str,
    dest: &Path,
    token: Option<&str>,
    opts: CloneOptions,
) -> Result<Repo> {
    clone_run(url, dest, token, &opts).await?;
    Repo::open(dest).await
}

/// Run `git clone` with `opts` (also bare clones, which have no working tree to open).
pub async fn clone_run(
    url: &str,
    dest: &Path,
    token: Option<&str>,
    opts: &CloneOptions,
) -> Result<()> {
    check_url(url)?;
    if dest.exists() && std::fs::read_dir(dest)?.next().is_some() {
        return Err(Error::Invalid(format!(
            "Destination {} already exists and is not empty",
            dest.display()
        )));
    }
    let parent = dest
        .parent()
        .ok_or_else(|| Error::Invalid("Invalid destination".into()))?;
    std::fs::create_dir_all(parent)?;
    let dest_s = dest.to_string_lossy().into_owned();
    let mut args: Vec<String> = vec!["clone".into()];
    match opts.depth.filter(|d| *d > 0) {
        Some(d) => args.extend(["--depth".into(), d.to_string(), "--no-single-branch".into()]),
        None if opts.shallow => {
            args.extend(["--depth".into(), "1".into(), "--no-single-branch".into()])
        }
        None => {}
    }
    if opts.sparse {
        args.push("--sparse".into());
    }
    if opts.recursive {
        args.push("--recurse-submodules".into());
    }
    if opts.bare {
        args.push("--bare".into());
    } else if opts.no_checkout {
        args.push("--no-checkout".into());
    }
    if let Some(b) = opts
        .branch
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty())
    {
        check_rev(b)?;
        args.extend(["--branch".into(), b.to_string()]);
    }
    if let Some(o) = opts
        .origin
        .as_deref()
        .map(str::trim)
        .filter(|o| !o.is_empty())
    {
        check_rev(o)?;
        args.extend(["--origin".into(), o.to_string()]);
    }
    args.extend(["--".into(), url.to_string(), dest_s]);
    let a: Vec<&str> = args.iter().map(String::as_str).collect();
    run::ok(parent, &a, net(token)).await?;
    if opts.lfs && !opts.bare {
        run::ok(dest, &["lfs", "install", "--local"], Opts::default()).await?;
        if !opts.no_checkout {
            run::ok(dest, &["lfs", "pull"], net(token)).await?;
        }
    }
    Ok(())
}

/// Open a terminal window in `path`. `kind`: `auto` (Windows Terminal, else cmd), `wt`,
/// `powershell`, `cmd` or `gitbash` (Windows); ignored elsewhere.
pub fn open_terminal(path: &Path, kind: &str) -> Result<()> {
    if !path.is_dir() {
        return Err(Error::Invalid(format!(
            "Folder not found: {}",
            path.display()
        )));
    }
    #[cfg(windows)]
    {
        use std::process::Command;
        let start = |prog: &str, args: &[&str]| -> std::io::Result<std::process::Child> {
            Command::new("cmd.exe")
                .args(["/C", "start", "", prog])
                .args(args)
                .current_dir(path)
                .spawn()
        };
        match kind {
            "powershell" => drop(start("powershell.exe", &["-NoExit"])?),
            "cmd" => drop(start("cmd.exe", &[])?),
            "gitbash" => {
                let bash = git_bash();
                match bash {
                    Some(b) => drop(
                        Command::new(b)
                            .arg(format!("--cd={}", path.display()))
                            .spawn()?,
                    ),
                    None => return Err(Error::Invalid("Git Bash was not found".into())),
                }
            }
            "wt" => drop(Command::new("wt.exe").arg("-d").arg(path).spawn()?),
            _ => {
                if Command::new("wt.exe").arg("-d").arg(path).spawn().is_err() {
                    drop(start("cmd.exe", &[])?);
                }
            }
        }
    }
    #[cfg(not(windows))]
    let _ = kind; // the terminal choice only applies on Windows
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-a", "Terminal"])
            .arg(path)
            .spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("x-terminal-emulator")
            .current_dir(path)
            .spawn()?;
    }
    Ok(())
}

#[cfg(windows)]
fn git_bash() -> Option<PathBuf> {
    let out = std::process::Command::new("git")
        .arg("--exec-path")
        .output()
        .ok()?;
    let exec = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
    let p = exec.ancestors().nth(3)?.join("git-bash.exe");
    p.exists().then_some(p)
}

/// Open `path` with the user's editor command (e.g. `code`, `cursor`, `subl`).
pub fn open_in_editor(editor: &str, path: &Path) -> Result<()> {
    let editor = editor.trim();
    if editor.is_empty() {
        return Err(Error::Invalid(
            "Set an external editor in Preferences first".into(),
        ));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Through cmd so `code` resolves to code.cmd. The path is a separate argument.
        std::process::Command::new("cmd.exe")
            .args(["/C", editor])
            .arg(path)
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| Error::Invalid(format!("Could not start {editor}: {e}")))?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new(editor)
            .arg(path)
            .spawn()
            .map_err(|e| Error::Invalid(format!("Could not start {editor}: {e}")))?;
    }
    Ok(())
}

/// Global git config values the Preferences page may read and change.
pub const GLOBAL_KEYS: &[&str] = &[
    "user.name",
    "user.email",
    "core.longpaths",
    "core.autocrlf",
    "init.defaultBranch",
    "pull.rebase",
    "commit.gpgsign",
    "credential.helper",
    "credential.useHttpPath",
];

/// GitStudio's defaults for the global git config, applied at startup: `core.longpaths=true` on
/// Windows (paths over 260 characters, e.g. deep `node_modules`, otherwise fail with "Filename
/// too long"). A value the user already set, `false` included, is left alone. Returns the keys
/// that were changed.
pub async fn ensure_git_defaults() -> Result<Vec<String>> {
    if !cfg!(windows) {
        return Ok(Vec::new());
    }
    let mut changed = Vec::new();
    if ensure_longpaths(None).await? {
        changed.push("core.longpaths".to_string());
    }
    Ok(changed)
}

/// Set `core.longpaths=true` in the global config (or in `file`) when it is not set at all.
pub async fn ensure_longpaths(file: Option<&Path>) -> Result<bool> {
    let file_arg = file.map(|f| f.to_string_lossy().into_owned());
    let scope: Vec<&str> = match &file_arg {
        Some(f) => vec!["--file", f.as_str()],
        None => vec!["--global"],
    };
    let mut get = vec!["config"];
    get.extend(&scope);
    get.extend(["--get", "core.longpaths"]);
    let out = run::raw(None, &get, Opts::default()).await?;
    match out.code {
        // Set either way: the user's choice.
        0 => return Ok(false),
        // 1: not set.
        1 => {}
        _ => return Err(run::failure(&out)),
    }
    let mut set = vec!["config"];
    set.extend(&scope);
    set.extend(["core.longpaths", "true"]);
    let out = run::raw(None, &set, Opts::default()).await?;
    if out.code != 0 {
        return Err(run::failure(&out));
    }
    Ok(true)
}

/// Read `key` from the global config, or from `repo`'s own config (`--local`) when given.
pub async fn config_get(repo: Option<&Repo>, key: &str) -> Result<String> {
    if !GLOBAL_KEYS.contains(&key) {
        return Err(Error::Invalid(format!("{key} is not editable here")));
    }
    let out = match repo {
        Some(r) => {
            run::raw(
                Some(&r.root),
                &["config", "--local", "--get", key],
                Opts::default(),
            )
            .await?
        }
        None => run::raw(None, &["config", "--global", "--get", key], Opts::default()).await?,
    };
    Ok(out.text().trim().to_string())
}

/// Set (or unset with `None`) `key` globally, or for `repo` only.
pub async fn config_set(repo: Option<&Repo>, key: &str, value: Option<&str>) -> Result<()> {
    if !GLOBAL_KEYS.contains(&key) {
        return Err(Error::Invalid(format!("{key} is not editable here")));
    }
    if value.is_some_and(|v| v.contains(['\n', '\0'])) {
        return Err(Error::Invalid("Value must be on one line".into()));
    }
    let scope = if repo.is_some() {
        "--local"
    } else {
        "--global"
    };
    let mut args = vec!["config", scope];
    match value {
        Some(v) => args.extend([key, v]),
        None => args.extend(["--unset", key]),
    }
    let out = run::raw(repo.map(|r| r.root.as_path()), &args, Opts::default()).await?;
    if out.code != 0 && !(value.is_none() && out.code == 5) {
        return Err(run::failure(&out));
    }
    Ok(())
}

pub async fn global_config(key: &str) -> Result<String> {
    if !GLOBAL_KEYS.contains(&key) {
        return Err(Error::Invalid(format!("{key} is not editable here")));
    }
    let out = run::raw(None, &["config", "--global", "--get", key], Opts::default()).await?;
    Ok(out.text().trim().to_string())
}

pub async fn set_global_config(key: &str, value: Option<&str>) -> Result<()> {
    if !GLOBAL_KEYS.contains(&key) {
        return Err(Error::Invalid(format!("{key} is not editable here")));
    }
    let out = match value {
        Some(v) => run::raw(None, &["config", "--global", key, v], Opts::default()).await?,
        None => {
            run::raw(
                None,
                &["config", "--global", "--unset", key],
                Opts::default(),
            )
            .await?
        }
    };
    // `--unset` of a missing key exits 5; that is fine.
    if out.code != 0 && !(value.is_none() && out.code == 5) {
        return Err(run::failure(&out));
    }
    Ok(())
}

pub async fn version() -> Result<String> {
    let out = run::raw(None, &["--version"], Opts::default()).await?;
    Ok(out.text().trim().to_string())
}

// ---- request shapes ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiffSource {
    Unstaged,
    Staged,
    Commit,
    /// `commit` against the working tree.
    Worktree,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRequest {
    pub source: DiffSource,
    pub path: String,
    #[serde(default)]
    pub orig_path: Option<String>,
    #[serde(default)]
    pub untracked: bool,
    #[serde(default)]
    pub commit: Option<String>,
    /// Parent to diff against (first parent); `None` for a root commit.
    #[serde(default)]
    pub parent: Option<String>,
    /// Ignore changes in leading/trailing whitespace and in amount of whitespace.
    #[serde(default)]
    pub ignore_whitespace: bool,
    /// Lines of context; a large value shows the whole file (inline view).
    #[serde(default)]
    pub context: Option<u32>,
    /// Encoding of the file, used to decode the diff text.
    #[serde(default)]
    pub encoding: Option<String>,
}

/// `origin/feature/x` -> `feature/x`.
fn local_name_of(remote_branch: &str) -> Result<&str> {
    remote_branch
        .split_once('/')
        .map(|(_, b)| b)
        .ok_or_else(|| Error::Invalid(format!("Not a remote branch: {remote_branch}")))
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckoutKind {
    Branch,
    Remote,
    /// A remote branch whose local namesake is moved onto it first (`switch -C`), so local
    /// commits not on the remote are left only in the reflog.
    RemoteReset,
    Detached,
}

/// Options of `stash.save`.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashPush {
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub include_untracked: bool,
    #[serde(default)]
    pub staged_only: bool,
    #[serde(default)]
    pub keep_index: bool,
    /// Only these files (empty: everything).
    #[serde(default)]
    pub paths: Vec<String>,
}

/// What to look for in the whole history (`history.search`). Every non-empty field must match;
/// text is matched literally and without regard to case.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSearch {
    /// In the commit message (`--grep`).
    #[serde(default)]
    pub message: String,
    /// In the author's name or email (`--author`).
    #[serde(default)]
    pub author: String,
    /// Added or removed by the commit's changes (`-S`, the "pickaxe").
    #[serde(default)]
    pub content: String,
    /// Commits touching this path (file or folder, relative to the repository root).
    #[serde(default)]
    pub path: String,
}

/// Graph filters ("Solo" / "Hide" in the commit and branch menus); full ref names.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogView {
    #[serde(default)]
    pub solo: Vec<String>,
    #[serde(default)]
    pub hidden: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PushRequest {
    #[serde(default)]
    pub remote: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub force: bool,
}

// ---- argument guards --------------------------------------------------------------------------

/// Refuse anything git could read as an option.
pub(crate) fn check_rev(s: &str) -> Result<()> {
    if s.is_empty() || s.starts_with('-') || s.contains(['\0', '\n']) {
        return Err(Error::Invalid(format!("Invalid name: {s:?}")));
    }
    Ok(())
}

fn check_path(s: &str) -> Result<()> {
    if s.is_empty() || s.contains('\0') {
        return Err(Error::Invalid(format!("Invalid path: {s:?}")));
    }
    Ok(())
}

fn checked_paths(paths: &[String]) -> Result<Vec<&str>> {
    paths
        .iter()
        .map(|p| check_path(p).map(|_| p.as_str()))
        .collect()
}

fn check_url(url: &str) -> Result<()> {
    if url.trim().is_empty() || url.starts_with('-') || url.contains(['\0', '\n']) {
        return Err(Error::Invalid(format!("Invalid URL: {url:?}")));
    }
    // `ext::` runs arbitrary commands.
    if url.to_ascii_lowercase().starts_with("ext::") {
        return Err(Error::Invalid("ext:: URLs are not allowed".into()));
    }
    Ok(())
}

async fn check_ref_name(root: &Path, name: &str) -> Result<()> {
    check_rev(name)?;
    let full = if name.starts_with("tags/") {
        format!("refs/{name}")
    } else {
        format!("refs/heads/{name}")
    };
    let out = run::raw(Some(root), &["check-ref-format", &full], Opts::default()).await?;
    if out.code != 0 {
        return Err(Error::Invalid(format!("{name:?} is not a valid name")));
    }
    Ok(())
}
