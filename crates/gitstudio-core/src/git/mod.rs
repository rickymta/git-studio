//! Git operations, implemented on top of the `git` CLI so behaviour (hooks, credential helpers,
//! config, LFS…) matches what the user gets in a terminal.

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
    let Some(token) = token else { return Vec::new() };
    let basic =
        base64::engine::general_purpose::STANDARD.encode(format!("x-access-token:{token}"));
    vec![
        ("GIT_CONFIG_COUNT".into(), "1".into()),
        (
            "GIT_CONFIG_KEY_0".into(),
            "http.https://github.com/.extraheader".into(),
        ),
        (
            "GIT_CONFIG_VALUE_0".into(),
            format!("AUTHORIZATION: basic {basic}"),
        ),
    ]
}

/// Options for commands that talk to a remote: GitHub token for HTTPS, chosen key for SSH.
fn net(token: Option<&str>) -> Opts<'static> {
    let mut env = github_auth_env(token);
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
            return Err(Error::Invalid(format!("Folder not found: {}", path.display())));
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
        let n = format!("-n{limit}");
        let s = format!("--skip={skip}");
        let out = run::raw(
            Some(&self.root),
            &[
                "log",
                "--date-order",
                "--exclude=refs/stash",
                "--all",
                "HEAD",
                &n,
                &s,
                parse::LOG_FORMAT,
            ],
            Opts::default(),
        )
        .await?;
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

        let base = ["diff", "--no-color", "--no-ext-diff", "-M"];
        let out = match req.source {
            DiffSource::Unstaged if req.untracked => {
                run::raw(
                    Some(&self.root),
                    &["diff", "--no-color", "--no-index", "--", "/dev/null", &req.path],
                    Opts::default(),
                )
                .await?
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
                    None => vec!["show", "--no-color", "--no-ext-diff", "--format=", hash],
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
        Ok(String::from_utf8_lossy(&text).into_owned())
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
    pub async fn apply_patch(&self, patch: &str, cached: bool, reverse: bool) -> Result<()> {
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
                stdin: Some(patch.as_bytes()),
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

    pub async fn head_message(&self) -> Result<String> {
        Ok(self.git(&["log", "-1", "--format=%B"]).await?.trim_end().to_string())
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
            CheckoutKind::Remote => {
                // origin/feature/x -> feature/x
                let local = target
                    .split_once('/')
                    .map(|(_, b)| b)
                    .ok_or_else(|| Error::Invalid(format!("Not a remote branch: {target}")))?;
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

    pub async fn create_branch(&self, name: &str, start: Option<&str>, checkout: bool) -> Result<()> {
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
                self.git(&["branch", "--set-upstream-to", u, branch]).await.map(drop)
            }
            None => self.git(&["branch", "--unset-upstream", branch]).await.map(drop),
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
            _ => return Err(Error::Invalid(format!("Unknown reset mode {mode}"))),
        };
        self.git(&["reset", flag, target]).await.map(drop)
    }

    // ---- tags ---------------------------------------------------------------------------------

    pub async fn create_tag(&self, name: &str, target: &str, message: Option<&str>) -> Result<()> {
        check_ref_name(&self.root, &format!("tags/{name}")).await?;
        check_rev(target)?;
        match message.filter(|m| !m.trim().is_empty()) {
            Some(m) => self.git(&["tag", "-a", name, "-m", m, target]).await.map(drop),
            None => self.git(&["tag", name, target]).await.map(drop),
        }
    }

    pub async fn delete_tag(&self, name: &str) -> Result<()> {
        check_rev(name)?;
        self.git(&["tag", "-d", name]).await.map(drop)
    }

    // ---- stash --------------------------------------------------------------------------------

    pub async fn stash_save(&self, message: Option<&str>, include_untracked: bool) -> Result<()> {
        let mut a = vec!["stash", "push"];
        if include_untracked {
            a.push("--include-untracked");
        }
        if let Some(m) = message.filter(|m| !m.trim().is_empty()) {
            a.extend(["-m", m]);
        }
        self.git(&a).await.map(drop)
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
        self.git_opts(&a, net(token)).await.map(drop)
    }

    pub async fn pull(&self, mode: &str, token: Option<&str>) -> Result<()> {
        let flag = match mode {
            "ff-only" => "--ff-only",
            "rebase" => "--rebase",
            _ => "--no-rebase",
        };
        self.git_opts(&["pull", "--no-edit", flag], net(token))
            .await
            .map(drop)
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
        self.git_opts(&args, net(token)).await.map(drop)
    }

    pub async fn delete_remote_ref(&self, remote: &str, name: &str, token: Option<&str>) -> Result<()> {
        check_rev(remote)?;
        check_rev(name)?;
        self.git_opts(&["push", remote, "--delete", name], net(token))
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

    pub async fn set_remote_url(&self, name: &str, url: &str) -> Result<()> {
        check_rev(name)?;
        check_url(url)?;
        self.git(&["remote", "set-url", name, url]).await.map(drop)
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
    run::ok(parent, &["clone", "--", url, &dest_s], net(token)).await?;
    Repo::open(dest).await
}

/// Open a terminal window in `path`. `kind`: `auto` (Windows Terminal, else cmd), `wt`,
/// `powershell`, `cmd` or `gitbash` (Windows); ignored elsewhere.
pub fn open_terminal(path: &Path, kind: &str) -> Result<()> {
    if !path.is_dir() {
        return Err(Error::Invalid(format!("Folder not found: {}", path.display())));
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
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").args(["-a", "Terminal"]).arg(path).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("x-terminal-emulator").current_dir(path).spawn()?;
    }
    Ok(())
}

#[cfg(windows)]
fn git_bash() -> Option<PathBuf> {
    let out = std::process::Command::new("git").arg("--exec-path").output().ok()?;
    let exec = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
    let p = exec.ancestors().nth(3)?.join("git-bash.exe");
    p.exists().then_some(p)
}

/// Open `path` with the user's editor command (e.g. `code`, `cursor`, `subl`).
pub fn open_in_editor(editor: &str, path: &Path) -> Result<()> {
    let editor = editor.trim();
    if editor.is_empty() {
        return Err(Error::Invalid("Set an external editor in Preferences first".into()));
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
];

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
        None => run::raw(None, &["config", "--global", "--unset", key], Opts::default()).await?,
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
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckoutKind {
    Branch,
    Remote,
    Detached,
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
fn check_rev(s: &str) -> Result<()> {
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
