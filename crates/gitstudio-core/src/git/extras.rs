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

// ---- commit signatures ------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SignatureStatus {
    /// Valid signature by a trusted key (`G`).
    Good,
    /// Valid signature, key not known to be trusted (`U`).
    Untrusted,
    /// Valid signature that has expired (`X`), or made by an expired key (`Y`).
    Expired,
    /// Signed by a revoked key (`R`).
    Revoked,
    /// The signature does not match the commit (`B`).
    Bad,
    /// Signed, but it could not be checked: key missing, no allowed-signers file… (`E`).
    Unverifiable,
    /// Not signed (`N`).
    None,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSignature {
    pub status: SignatureStatus,
    pub signer: String,
    pub key: String,
    pub fingerprint: String,
}

/// Commit / tag signing settings (`commit.gpgSign`, `tag.gpgSign`, `gpg.format`,
/// `user.signingKey`), as set in one scope.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SigningConfig {
    pub sign_commits: bool,
    pub sign_tags: bool,
    /// `openpgp` (GPG), `ssh` or `x509`; empty = git's default (openpgp).
    pub format: String,
    /// Key id (GPG) or public key / key file (SSH); empty = git's default.
    pub key: String,
}

fn config_scope(scope: &str) -> Result<Option<&'static str>> {
    match scope {
        "effective" => Ok(None),
        "local" => Ok(Some("--local")),
        "global" => Ok(Some("--global")),
        _ => Err(Error::Invalid(format!("Unknown config scope {scope}"))),
    }
}

impl Repo {
    /// Whether `hash` is signed, and whether the signature checks out.
    pub async fn commit_signature(&self, hash: &str) -> Result<CommitSignature> {
        check_rev(hash)?;
        let out = self
            .git(&[
                "show",
                "-s",
                "--format=%G?%x1f%GS%x1f%GK%x1f%GF",
                hash,
                "--",
            ])
            .await?;
        let mut f = out.trim_end_matches(['\n', '\r']).split('\x1f');
        let status = match f.next().unwrap_or("N") {
            "G" => SignatureStatus::Good,
            "U" => SignatureStatus::Untrusted,
            "X" | "Y" => SignatureStatus::Expired,
            "R" => SignatureStatus::Revoked,
            "B" => SignatureStatus::Bad,
            "E" => SignatureStatus::Unverifiable,
            _ => SignatureStatus::None,
        };
        let mut next = || f.next().unwrap_or("").to_string();
        // Without gpg.ssh.allowedSignersFile git reports an SSH-signed commit as unsigned: look
        // for the signature header itself.
        let status = if status == SignatureStatus::None
            && self
                .git(&["cat-file", "commit", hash])
                .await?
                .split("\n\n")
                .next()
                .is_some_and(|h| h.lines().any(|l| l.starts_with("gpgsig")))
        {
            SignatureStatus::Unverifiable
        } else {
            status
        };
        Ok(CommitSignature {
            status,
            signer: next(),
            key: next(),
            fingerprint: next(),
        })
    }

    async fn config_get(&self, scope: Option<&str>, key: &str) -> Option<String> {
        let mut a = vec!["config"];
        a.extend(scope);
        a.extend(["--get", key]);
        run::raw(Some(&self.root), &a, Opts::default())
            .await
            .ok()
            .filter(|o| o.code == 0)
            .map(|o| o.text().trim().to_string())
    }

    /// Signing settings in `scope`: `effective` (what git uses here), `local` or `global`.
    pub async fn signing_config(&self, scope: &str) -> Result<SigningConfig> {
        let s = config_scope(scope)?;
        let truthy = |v: Option<String>| {
            v.is_some_and(|v| matches!(v.to_lowercase().as_str(), "true" | "yes" | "on" | "1"))
        };
        Ok(SigningConfig {
            sign_commits: truthy(self.config_get(s, "commit.gpgsign").await),
            sign_tags: truthy(self.config_get(s, "tag.gpgsign").await),
            format: self.config_get(s, "gpg.format").await.unwrap_or_default(),
            key: self
                .config_get(s, "user.signingkey")
                .await
                .unwrap_or_default(),
        })
    }

    /// Write signing settings to `local` (this repository) or `global` config. Empty format /
    /// key are removed, so git's defaults apply.
    pub async fn set_signing(&self, cfg: &SigningConfig, scope: &str) -> Result<()> {
        let s = match config_scope(scope)? {
            Some(s) => s,
            None => return Err(Error::Invalid("Choose local or global".into())),
        };
        if !matches!(cfg.format.as_str(), "" | "openpgp" | "ssh" | "x509") {
            return Err(Error::Invalid(format!(
                "Unknown signing format {}",
                cfg.format
            )));
        }
        if cfg.key.contains(['\0', '\n']) {
            return Err(Error::Invalid("Invalid signing key".into()));
        }
        let bool_str = |b: bool| if b { "true" } else { "false" };
        self.git(&["config", s, "commit.gpgsign", bool_str(cfg.sign_commits)])
            .await?;
        self.git(&["config", s, "tag.gpgsign", bool_str(cfg.sign_tags)])
            .await?;
        for (key, value) in [("gpg.format", &cfg.format), ("user.signingkey", &cfg.key)] {
            let value = value.trim();
            if value.is_empty() {
                // Exit code 5: nothing to remove.
                run::raw(
                    Some(&self.root),
                    &["config", s, "--unset", key],
                    Opts::default(),
                )
                .await?;
            } else {
                self.git(&["config", s, key, value]).await?;
            }
        }
        Ok(())
    }
}

// ---- bisect -----------------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BisectState {
    pub active: bool,
    pub bad: Option<String>,
    pub good: Vec<String>,
    pub skipped: Vec<String>,
    /// Commit checked out for testing.
    pub current: Option<String>,
    /// Revisions still to look through, once a good and a bad commit are known.
    pub remaining: Option<u32>,
    /// Roughly how many more tests that takes.
    pub steps: Option<u32>,
    /// The search is over: this commit introduced the change.
    pub first_bad: Option<String>,
}

impl Repo {
    pub async fn bisect_state(&self) -> Result<BisectState> {
        if !self.git_dir.join("BISECT_START").exists() {
            return Ok(BisectState::default());
        }
        let refs = self
            .git(&[
                "for-each-ref",
                "--format=%(refname)%09%(objectname)",
                "refs/bisect/",
            ])
            .await?;
        let mut st = BisectState {
            active: true,
            ..Default::default()
        };
        for line in refs.lines() {
            let Some((name, hash)) = line.split_once('\t') else {
                continue;
            };
            let name = name.trim_start_matches("refs/bisect/");
            if name == "bad" {
                st.bad = Some(hash.to_string());
            } else if name.starts_with("good-") {
                st.good.push(hash.to_string());
            } else if name.starts_with("skip-") {
                st.skipped.push(hash.to_string());
            }
        }
        st.current = run::raw(
            Some(&self.root),
            &["rev-parse", "--verify", "-q", "HEAD"],
            Opts::default(),
        )
        .await
        .ok()
        .filter(|o| o.code == 0)
        .map(|o| o.text().trim().to_string());
        // `git bisect` notes the answer in its log once it is found.
        if let Ok(log) = std::fs::read_to_string(self.git_dir.join("BISECT_LOG")) {
            st.first_bad = log.lines().rev().find_map(|l| {
                l.strip_prefix("# first bad commit: [")
                    .and_then(|r| r.split(']').next())
                    .map(str::to_string)
            });
        }
        if let (Some(bad), false, None) = (&st.bad, st.good.is_empty(), &st.first_bad) {
            let mut a = vec!["rev-list", "--bisect-vars", bad.as_str(), "--not"];
            a.extend(st.good.iter().map(String::as_str));
            if let Ok(vars) = self.git(&a).await {
                for l in vars.lines() {
                    if let Some(v) = l.strip_prefix("bisect_nr=") {
                        st.remaining = v.trim().parse().ok();
                    } else if let Some(v) = l.strip_prefix("bisect_steps=") {
                        st.steps = v.trim().parse().ok();
                    }
                }
            }
        }
        Ok(st)
    }

    /// Start bisecting; `bad` / `good` may be given now or marked later.
    pub async fn bisect_start(&self, bad: Option<&str>, good: Option<&str>) -> Result<BisectState> {
        let mut a = vec!["bisect", "start"];
        if let Some(b) = bad {
            check_rev(b)?;
            a.push(b);
            if let Some(g) = good {
                check_rev(g)?;
                a.push(g);
            }
        }
        a.push("--");
        self.git(&a).await?;
        if let (None, Some(g)) = (bad, good) {
            self.bisect_mark("good", Some(g)).await?;
        }
        self.bisect_state().await
    }

    /// Mark `rev` (HEAD when none) as `good`, `bad` or `skip`; git checks out the next commit.
    pub async fn bisect_mark(&self, mark: &str, rev: Option<&str>) -> Result<BisectState> {
        let verb = match mark {
            "good" | "bad" | "skip" => mark,
            _ => return Err(Error::Invalid(format!("Unknown bisect mark {mark}"))),
        };
        let mut a = vec!["bisect", verb];
        if let Some(r) = rev {
            check_rev(r)?;
            a.push(r);
        }
        self.git(&a).await?;
        self.bisect_state().await
    }

    /// End the bisect and go back to where it started.
    pub async fn bisect_reset(&self) -> Result<()> {
        self.git(&["bisect", "reset"]).await.map(drop)
    }
}

// ---- external merge / diff tools --------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeTools {
    /// `merge.tool` from the global config (empty: not set).
    pub merge_tool: String,
    /// `diff.tool` from the global config (empty: not set).
    pub diff_tool: String,
    /// Tools git knows and found on this computer.
    pub available: Vec<String>,
    /// Tools git knows but did not find.
    pub other: Vec<String>,
}

/// The two lists of `git mergetool --tool-help`: tools found here, and the others git knows.
pub fn parse_tool_help(text: &str) -> (Vec<String>, Vec<String>) {
    let (mut found, mut other) = (Vec::new(), Vec::new());
    let mut into_other = false;
    for line in text.lines() {
        if line.starts_with("The following tools are valid, but not") {
            into_other = true;
            continue;
        }
        if line.starts_with("Some of the tools listed above") {
            break;
        }
        if !line.starts_with(['\t', ' ']) {
            continue;
        }
        if let Some(name) = line.split_whitespace().next() {
            if into_other {
                other.push(name.to_string());
            } else {
                found.push(name.to_string());
            }
        }
    }
    (found, other)
}

fn check_tool_name(name: &str) -> Result<()> {
    if name.starts_with('-')
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    {
        return Err(Error::Invalid(format!("Invalid tool name {name:?}")));
    }
    Ok(())
}

async fn global_get(key: &str) -> String {
    run::raw(None, &["config", "--global", "--get", key], Opts::default())
        .await
        .ok()
        .filter(|o| o.code == 0)
        .map(|o| o.text().trim().to_string())
        .unwrap_or_default()
}

/// The chosen merge and diff tools, and the tools git can drive.
pub async fn merge_tools() -> Result<MergeTools> {
    let help = run::raw(None, &["mergetool", "--tool-help"], Opts::default()).await?;
    let (available, other) = parse_tool_help(&help.text());
    Ok(MergeTools {
        merge_tool: global_get("merge.tool").await,
        diff_tool: global_get("diff.tool").await,
        available,
        other,
    })
}

/// Set (or with an empty name, unset) `merge.tool` / `diff.tool` in the global config.
pub async fn set_tool(kind: &str, name: &str) -> Result<()> {
    let key = match kind {
        "merge" => "merge.tool",
        "diff" => "diff.tool",
        _ => return Err(Error::Invalid(format!("Unknown tool kind {kind}"))),
    };
    let name = name.trim();
    if name.is_empty() {
        run::raw(
            None,
            &["config", "--global", "--unset", key],
            Opts::default(),
        )
        .await?;
        return Ok(());
    }
    check_tool_name(name)?;
    run::ok(
        &std::env::temp_dir(),
        &["config", "--global", key, name],
        Opts::default(),
    )
    .await
    .map(drop)
}

impl Repo {
    /// Resolve a conflicted file in the external merge tool; returns when the tool closes. git
    /// stages the file when the tool reports success.
    pub async fn run_mergetool(&self, path: &str) -> Result<()> {
        check_path(path)?;
        self.git(&[
            "-c",
            "mergetool.keepBackup=false",
            "mergetool",
            "--no-prompt",
            "--",
            path,
        ])
        .await
        .map(drop)
    }

    /// Show a file's changes in the external diff tool: unstaged ones, `staged` ones, or those of
    /// `commit`.
    pub async fn run_difftool(&self, path: &str, staged: bool, commit: Option<&str>) -> Result<()> {
        check_path(path)?;
        let range;
        let mut a = vec!["difftool", "--no-prompt"];
        if let Some(c) = commit {
            check_rev(c)?;
            range = format!("{c}^!");
            a.push(&range);
        } else if staged {
            a.push("--cached");
        }
        a.extend(["--", path]);
        self.git(&a).await.map(drop)
    }
}

// ---- file contents at a revision (image diffs) ------------------------------------------------

/// A file's raw bytes somewhere (a commit, the index, the working tree).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBlob {
    pub size: u64,
    /// Base64 bytes; `None` when larger than the limit asked for.
    pub data: Option<String>,
}

impl Repo {
    /// The bytes of `path` in `rev` (a commit; `":"` = the index; `None` = the working tree),
    /// after smudge filters (so Git LFS files give their real content). `Ok(None)` when the file
    /// does not exist there.
    pub async fn file_blob(
        &self,
        path: &str,
        rev: Option<&str>,
        max: u64,
    ) -> Result<Option<FileBlob>> {
        use base64::Engine;
        let rel = super::files::safe_rel(path)?;
        let encode = |bytes: Vec<u8>| FileBlob {
            size: bytes.len() as u64,
            data: (bytes.len() as u64 <= max)
                .then(|| base64::engine::general_purpose::STANDARD.encode(&bytes)),
        };
        let Some(rev) = rev else {
            let full = self.root.join(&rel);
            let Ok(meta) = std::fs::metadata(&full) else {
                return Ok(None);
            };
            if !meta.is_file() {
                return Ok(None);
            }
            if meta.len() > max {
                return Ok(Some(FileBlob {
                    size: meta.len(),
                    data: None,
                }));
            }
            return Ok(Some(encode(std::fs::read(full)?)));
        };
        let rel = rel.to_string_lossy().replace('\\', "/");
        let spec = if rev == ":" {
            format!(":{rel}")
        } else {
            check_rev(rev)?;
            format!("{rev}:{rel}")
        };
        let size = run::raw(
            Some(&self.root),
            &["cat-file", "-s", &spec],
            Opts::default(),
        )
        .await?;
        if size.code != 0 {
            return Ok(None);
        }
        let size: u64 = size.text().trim().parse().unwrap_or(0);
        if size > max {
            return Ok(Some(FileBlob { size, data: None }));
        }
        let out = run::ok(
            &self.root,
            &["cat-file", "--filters", &spec],
            Opts::default(),
        )
        .await?;
        Ok(Some(encode(out.stdout)))
    }
}
