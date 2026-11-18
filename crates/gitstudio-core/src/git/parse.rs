//! Parsers for git's machine-readable output.

use super::model::*;

pub const US: char = '\u{1f}';
pub const RS: char = '\u{1e}';

/// `git log` format matching [`parse_log`].
pub const LOG_FORMAT: &str = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ct%x1f%s%x1f%b%x1e";

pub fn parse_log(text: &str) -> Vec<Commit> {
    text.split(RS)
        .filter_map(|rec| {
            let rec = rec.trim_start_matches(['\n', '\r']);
            if rec.is_empty() {
                return None;
            }
            let f: Vec<&str> = rec.split(US).collect();
            if f.len() < 8 {
                return None;
            }
            Some(Commit {
                hash: f[0].to_string(),
                parents: f[1].split_whitespace().map(str::to_string).collect(),
                author_name: f[2].to_string(),
                author_email: f[3].to_string(),
                author_time: f[4].parse().unwrap_or(0),
                committer_name: f[5].to_string(),
                commit_time: f[6].parse().unwrap_or(0),
                subject: f[7].to_string(),
                body: f.get(8).map(|b| flatten_body(b)).unwrap_or_default(),
            })
        })
        .collect()
}

/// Body as one line for the graph (bounded length).
fn flatten_body(b: &str) -> String {
    let mut out = b.split_whitespace().collect::<Vec<_>>().join(" ");
    if out.len() > 240 {
        let mut cut = 240;
        while !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
        out.push('…');
    }
    out
}

/// `git for-each-ref` format matching [`parse_refs`].
pub const REF_FORMAT: &str = "--format=%(refname)%1f%(objectname)%1f%(*objectname)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(HEAD)%1f%(symref)";

pub fn parse_refs(text: &str) -> Vec<GitRef> {
    let mut out = Vec::new();
    for line in text.lines() {
        let f: Vec<&str> = line.split(US).collect();
        if f.len() < 7 || !f[6].is_empty() {
            // Malformed, or a symbolic ref such as `origin/HEAD`.
            continue;
        }
        let full = f[0];
        let (kind, name, remote) = if let Some(n) = full.strip_prefix("refs/heads/") {
            (RefKind::Local, n.to_string(), None)
        } else if let Some(n) = full.strip_prefix("refs/remotes/") {
            let remote = n.split('/').next().unwrap_or_default().to_string();
            (RefKind::Remote, n.to_string(), Some(remote))
        } else if let Some(n) = full.strip_prefix("refs/tags/") {
            (RefKind::Tag, n.to_string(), None)
        } else {
            continue;
        };
        let target = if f[2].is_empty() { f[1] } else { f[2] };
        let (ahead, behind, gone) = parse_track(f[4]);
        out.push(GitRef {
            full_name: full.to_string(),
            name,
            kind,
            target: target.to_string(),
            is_head: f[5] == "*",
            upstream: (!f[3].is_empty()).then(|| f[3].to_string()),
            ahead,
            behind,
            upstream_gone: gone,
            remote,
        });
    }
    out
}

/// `ahead 1, behind 2` / `gone` / empty.
fn parse_track(s: &str) -> (u32, u32, bool) {
    if s == "gone" {
        return (0, 0, true);
    }
    let (mut a, mut b) = (0, 0);
    for part in s.split(',') {
        let part = part.trim();
        if let Some(n) = part.strip_prefix("ahead ") {
            a = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            b = n.parse().unwrap_or(0);
        }
    }
    (a, b, false)
}

pub const STASH_FORMAT: &str = "--format=%gd%x1f%H%x1f%gs%x1f%ct%x1f%P";

pub fn parse_stashes(text: &str) -> Vec<Stash> {
    text.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split(US).collect();
            if f.len() < 4 {
                return None;
            }
            let index = f[0]
                .trim_start_matches("stash@{")
                .trim_end_matches('}')
                .parse()
                .ok()?;
            Some(Stash {
                index,
                name: f[0].to_string(),
                hash: f[1].to_string(),
                message: f[2].to_string(),
                time: f[3].parse().unwrap_or(0),
                // First parent: the commit the stash was made on.
                base: f
                    .get(4)
                    .and_then(|p| p.split_whitespace().next())
                    .map(str::to_string),
            })
        })
        .collect()
}

/// `git remote -v` output.
pub fn parse_remotes(text: &str) -> Vec<Remote> {
    let mut out: Vec<Remote> = Vec::new();
    for line in text.lines() {
        let mut it = line.split_whitespace();
        let (Some(name), Some(url), Some(kind)) = (it.next(), it.next(), it.next()) else {
            continue;
        };
        let idx = match out.iter().position(|r| r.name == name) {
            Some(i) => i,
            None => {
                out.push(Remote {
                    name: name.to_string(),
                    url: String::new(),
                    push_url: String::new(),
                    github: None,
                });
                out.len() - 1
            }
        };
        let r = &mut out[idx];
        if kind == "(fetch)" {
            r.url = url.to_string();
            r.github = github_slug(url);
        } else {
            r.push_url = url.to_string();
        }
    }
    out
}

/// `owner/repo` of a github.com remote URL (https, ssh or scp-like).
pub fn github_slug(url: &str) -> Option<GitHubSlug> {
    let rest = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("git@github.com:"))
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))
        .or_else(|| {
            // https://user@github.com/owner/repo
            let after = url.strip_prefix("https://")?;
            let at = after.find('@')?;
            after[at + 1..].strip_prefix("github.com/")
        })?;
    let rest = rest.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let mut parts = rest.split('/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();
    if owner.is_empty() || repo.is_empty() || parts.next().is_some() {
        return None;
    }
    Some(GitHubSlug { owner, repo })
}

/// `git status --porcelain=v2 -z --branch` output.
pub fn parse_status(raw: &[u8]) -> Status {
    let text = String::from_utf8_lossy(raw);
    let mut st = Status::default();
    let mut fields = text.split('\0');
    while let Some(entry) = fields.next() {
        if entry.is_empty() {
            continue;
        }
        if let Some(h) = entry.strip_prefix("# ") {
            if let Some(v) = h.strip_prefix("branch.oid ") {
                st.head = (v != "(initial)").then(|| v.to_string());
            } else if let Some(v) = h.strip_prefix("branch.head ") {
                st.branch = (v != "(detached)").then(|| v.to_string());
            } else if let Some(v) = h.strip_prefix("branch.upstream ") {
                st.upstream = Some(v.to_string());
            } else if let Some(v) = h.strip_prefix("branch.ab ") {
                for p in v.split_whitespace() {
                    if let Some(n) = p.strip_prefix('+') {
                        st.ahead = n.parse().unwrap_or(0);
                    } else if let Some(n) = p.strip_prefix('-') {
                        st.behind = n.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        let kind = entry.as_bytes()[0];
        match kind {
            b'1' | b'2' => {
                // 1 XY sub mH mI mW hH hI path
                // 2 XY sub mH mI mW hH hI Xscore path  (then NUL origPath)
                let n = if kind == b'1' { 9 } else { 10 };
                let f: Vec<&str> = entry.splitn(n, ' ').collect();
                if f.len() < n {
                    continue;
                }
                let xy: Vec<char> = f[1].chars().collect();
                let path = f[n - 1].to_string();
                let orig = if kind == b'2' {
                    fields.next().map(str::to_string)
                } else {
                    None
                };
                if xy[0] != '.' {
                    st.staged.push(FileChange {
                        path: path.clone(),
                        orig_path: orig.clone(),
                        status: xy[0],
                    });
                }
                if xy[1] != '.' {
                    st.unstaged.push(FileChange {
                        path,
                        orig_path: None,
                        status: xy[1],
                    });
                }
            }
            b'u' => {
                let f: Vec<&str> = entry.splitn(11, ' ').collect();
                if let Some(path) = f.get(10) {
                    st.conflicted.push(FileChange {
                        path: path.to_string(),
                        orig_path: None,
                        status: 'U',
                    });
                }
            }
            b'?' => st.unstaged.push(FileChange {
                path: entry[2..].to_string(),
                orig_path: None,
                status: '?',
            }),
            _ => {}
        }
    }
    st
}

/// `git diff-tree --name-status -z` output.
pub fn parse_name_status(raw: &[u8]) -> Vec<FileChange> {
    let text = String::from_utf8_lossy(raw);
    let mut out = Vec::new();
    let mut it = text.split('\0').filter(|s| !s.is_empty());
    while let Some(code) = it.next() {
        let status = code.chars().next().unwrap_or('M');
        if status == 'R' || status == 'C' {
            let (Some(from), Some(to)) = (it.next(), it.next()) else {
                break;
            };
            out.push(FileChange {
                path: to.to_string(),
                orig_path: Some(from.to_string()),
                status,
            });
        } else {
            let Some(path) = it.next() else { break };
            out.push(FileChange {
                path: path.to_string(),
                orig_path: None,
                status,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_variants() {
        let want = Some(GitHubSlug {
            owner: "acme".into(),
            repo: "app".into(),
        });
        assert_eq!(github_slug("https://github.com/acme/app.git"), want);
        assert_eq!(github_slug("https://github.com/acme/app"), want);
        assert_eq!(github_slug("git@github.com:acme/app.git"), want);
        assert_eq!(github_slug("ssh://git@github.com/acme/app.git"), want);
        assert_eq!(github_slug("https://bob@github.com/acme/app.git"), want);
        assert_eq!(github_slug("https://gitlab.com/acme/app.git"), None);
    }

    #[test]
    fn status_v2() {
        let raw = "# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
1 M. N... 100644 100644 100644 aaa bbb src/a.rs\0\
1 .M N... 100644 100644 100644 aaa bbb my file.txt\0\
2 R. N... 100644 100644 100644 aaa bbb R100 new.rs\0old.rs\0\
u UU N... 100644 100644 100644 100644 a b c conflict.rs\0\
? untracked.txt\0";
        let st = parse_status(raw.as_bytes());
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!((st.ahead, st.behind), (2, 1));
        assert_eq!(st.staged.len(), 2);
        assert_eq!(st.staged[1].orig_path.as_deref(), Some("old.rs"));
        assert_eq!(st.unstaged[0].path, "my file.txt");
        assert_eq!(st.unstaged[1].status, '?');
        assert_eq!(st.conflicted[0].path, "conflict.rs");
    }

    #[test]
    fn refs_and_track() {
        let line = "refs/heads/main\u{1f}abc\u{1f}\u{1f}origin/main\u{1f}ahead 1, behind 3\u{1f}*\u{1f}\n\
refs/remotes/origin/HEAD\u{1f}abc\u{1f}\u{1f}\u{1f}\u{1f} \u{1f}refs/remotes/origin/main\n\
refs/tags/v1\u{1f}tagobj\u{1f}commit1\u{1f}\u{1f}\u{1f} \u{1f}\n";
        let refs = parse_refs(line);
        assert_eq!(refs.len(), 2);
        assert!(refs[0].is_head);
        assert_eq!((refs[0].ahead, refs[0].behind), (1, 3));
        assert_eq!(refs[1].target, "commit1");
    }

    #[test]
    fn name_status() {
        let raw = "M\0a.txt\0R087\0old.txt\0new.txt\0A\0b.txt\0";
        let files = parse_name_status(raw.as_bytes());
        assert_eq!(files.len(), 3);
        assert_eq!(files[1].orig_path.as_deref(), Some("old.txt"));
        assert_eq!(files[1].path, "new.txt");
    }
}
