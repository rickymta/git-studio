//! Merge preview: what merging a branch would produce, worked out with `git merge-tree` without
//! touching the working tree or the index, and the three versions of every file that would
//! conflict (for the merge tool, so conflicts can be resolved before merging).

use serde::Serialize;

use super::model::FileChange;
use super::parse::parse_name_status;
use super::run::{self, Opts};
use super::{Repo, check_rev};
use crate::error::{Error, Result};
use crate::text::TextFormat;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewConflict {
    pub path: String,
    /// Blob of each version; `None` when that side has no such file (added / deleted).
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    /// git's kind of conflict: "contents", "modify/delete", "add/add", "rename/delete", …
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePreview {
    /// Commits merged: the current one and the incoming one.
    pub ours: String,
    pub theirs: String,
    /// Nothing to merge: the incoming commit is already part of the current one.
    pub up_to_date: bool,
    /// The current commit is part of the incoming one: merging just moves the branch forward.
    pub fast_forward: bool,
    /// Tree the merge would produce (with conflict markers in conflicting files).
    pub tree: Option<String>,
    /// Files the merge changes on the current branch.
    pub files: Vec<FileChange>,
    pub conflicts: Vec<PreviewConflict>,
    /// git's notes about the merge (auto-merged files, conflicts, renames).
    pub messages: Vec<String>,
}

/// One version of a file to merge in the preview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFile {
    /// The file merged with the base shown (`|||||||`), or `None` for a missing side / binary.
    pub merged: Option<String>,
    pub format: Option<TextFormat>,
}

/// Parse `git merge-tree --write-tree -z` output: the tree, the conflicted entries, then the
/// informational messages (`<count> NUL <paths…> NUL <type> NUL <message> NUL` groups).
fn parse_merge_tree(raw: &[u8]) -> (Option<String>, Vec<PreviewConflict>, Vec<String>) {
    let text = String::from_utf8_lossy(raw);
    let mut fields = text.split('\0');
    let tree = fields
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let mut conflicts: Vec<PreviewConflict> = Vec::new();
    // Conflicted entries until the empty field that separates them from the messages.
    for f in fields.by_ref() {
        if f.is_empty() {
            break;
        }
        let Some((meta, path)) = f.split_once('\t') else {
            continue;
        };
        let mut m = meta.split(' ');
        let (_mode, oid, stage) = (m.next(), m.next(), m.next());
        let (Some(oid), Some(stage)) = (oid, stage) else {
            continue;
        };
        let i = match conflicts.iter().position(|c| c.path == path) {
            Some(i) => i,
            None => {
                conflicts.push(PreviewConflict {
                    path: path.to_string(),
                    base: None,
                    ours: None,
                    theirs: None,
                    kind: "contents".into(),
                });
                conflicts.len() - 1
            }
        };
        let c = &mut conflicts[i];
        match stage {
            "1" => c.base = Some(oid.to_string()),
            "2" => c.ours = Some(oid.to_string()),
            "3" => c.theirs = Some(oid.to_string()),
            _ => {}
        }
    }
    let mut messages = Vec::new();
    while let Some(count) = fields.next() {
        let Ok(n) = count.parse::<usize>() else {
            break;
        };
        let paths: Vec<&str> = fields.by_ref().take(n).collect();
        let (Some(kind), Some(msg)) = (fields.next(), fields.next()) else {
            break;
        };
        if let Some(k) = kind
            .strip_prefix("CONFLICT (")
            .and_then(|k| k.strip_suffix(')'))
        {
            for p in &paths {
                if let Some(c) = conflicts.iter_mut().find(|c| c.path == *p) {
                    c.kind = k.to_string();
                }
            }
        }
        let msg = msg.trim();
        if !msg.is_empty() {
            messages.push(msg.to_string());
        }
    }
    (tree, conflicts, messages)
}

impl Repo {
    async fn commit_of(&self, rev: &str) -> Result<String> {
        check_rev(rev)?;
        Ok(self
            .git(&["rev-parse", "--verify", &format!("{rev}^{{commit}}")])
            .await?
            .trim()
            .to_string())
    }

    async fn is_ancestor(&self, a: &str, b: &str) -> bool {
        run::raw(
            Some(&self.root),
            &["merge-base", "--is-ancestor", a, b],
            Opts::default(),
        )
        .await
        .is_ok_and(|o| o.code == 0)
    }

    /// What merging `theirs` into `ours` (default: HEAD) would do. Nothing on disk changes.
    pub async fn merge_preview(&self, theirs: &str, ours: Option<&str>) -> Result<MergePreview> {
        let ours = self.commit_of(ours.unwrap_or("HEAD")).await?;
        let theirs = self.commit_of(theirs).await?;
        let mut out = MergePreview {
            up_to_date: self.is_ancestor(&theirs, &ours).await,
            fast_forward: false,
            tree: None,
            files: Vec::new(),
            conflicts: Vec::new(),
            messages: Vec::new(),
            ours: ours.clone(),
            theirs: theirs.clone(),
        };
        if out.up_to_date {
            return Ok(out);
        }
        out.fast_forward = self.is_ancestor(&ours, &theirs).await;
        let res = run::raw(
            Some(&self.root),
            &["merge-tree", "--write-tree", "-z", &ours, &theirs],
            Opts::default(),
        )
        .await?;
        // 0 = clean, 1 = conflicts; anything else is a failure (unrelated histories, …).
        if res.code != 0 && res.code != 1 {
            return Err(Error::Git(res.stderr));
        }
        let (tree, conflicts, messages) = parse_merge_tree(&res.stdout);
        if let Some(t) = &tree {
            let diff = run::ok(
                &self.root,
                &["diff", "--name-status", "-z", "-M", &ours, t],
                Opts::default(),
            )
            .await?;
            out.files = parse_name_status(&diff.stdout);
        }
        out.tree = tree;
        out.conflicts = conflicts;
        out.messages = messages;
        Ok(out)
    }

    async fn blob(&self, oid: Option<&str>) -> Result<Option<Vec<u8>>> {
        let Some(oid) = oid else {
            return Ok(None);
        };
        check_rev(oid)?;
        if !oid.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(Error::Invalid(format!("Not an object id: {oid}")));
        }
        Ok(Some(
            run::ok(&self.root, &["cat-file", "blob", oid], Opts::default())
                .await?
                .stdout,
        ))
    }

    /// One conflicting file of a preview, merged with the base shown, for the merge tool.
    pub async fn merge_preview_file(
        &self,
        base: Option<&str>,
        ours: Option<&str>,
        theirs: Option<&str>,
        ours_label: &str,
        theirs_label: &str,
    ) -> Result<PreviewFile> {
        let (base, ours, theirs) = (
            self.blob(base).await?,
            self.blob(ours).await?,
            self.blob(theirs).await?,
        );
        let (Some(ours), Some(theirs)) = (ours, theirs) else {
            return Ok(PreviewFile {
                merged: None,
                format: None,
            });
        };
        let (merged, format) = self
            .diff3(
                base.unwrap_or_default(),
                ours,
                theirs,
                ours_label,
                theirs_label,
            )
            .await?;
        Ok(PreviewFile { merged, format })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_merge_tree_output() {
        let raw = [
            "abc123",
            "100644 b1 1\tf.txt",
            "100644 o1 2\tf.txt",
            "100644 t1 3\tf.txt",
            "100644 o2 2\tgone.txt",
            "",
            "1",
            "f.txt",
            "Auto-merging",
            "Auto-merging f.txt\n",
            "1",
            "f.txt",
            "CONFLICT (contents)",
            "CONFLICT (content): Merge conflict in f.txt\n",
            "1",
            "gone.txt",
            "CONFLICT (modify/delete)",
            "CONFLICT (modify/delete): gone.txt deleted in b\n",
            "",
        ]
        .join("\0");
        let (tree, conflicts, messages) = parse_merge_tree(raw.as_bytes());
        assert_eq!(tree.as_deref(), Some("abc123"));
        assert_eq!(conflicts.len(), 2);
        assert_eq!(conflicts[0].path, "f.txt");
        assert_eq!(conflicts[0].base.as_deref(), Some("b1"));
        assert_eq!(conflicts[0].ours.as_deref(), Some("o1"));
        assert_eq!(conflicts[0].theirs.as_deref(), Some("t1"));
        assert_eq!(conflicts[0].kind, "contents");
        assert_eq!(conflicts[1].kind, "modify/delete");
        assert_eq!(conflicts[1].theirs, None);
        assert_eq!(messages.len(), 3);
    }
}
