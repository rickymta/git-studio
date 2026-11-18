//! One-way import from a local GitKraken Desktop install: the repositories it knows, its open
//! tabs, and the SSH key it uses. Reads only plain JSON files; never touches GitKraken's
//! credentials (its `ssh`/`github` files are encrypted and left alone).

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::error::{Error, Result};
use crate::settings;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedRepo {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitKrakenData {
    /// Repositories GitKraken has opened, still present on disk.
    pub repos: Vec<ImportedRepo>,
    /// Repository tabs open in GitKraken, in order.
    pub tabs: Vec<ImportedRepo>,
    /// Path of the selected tab, if it is a repository.
    pub selected_tab: Option<String>,
    pub ssh_private_key: Option<String>,
    pub ssh_public_key: Option<String>,
    pub ssh_use_agent: Option<bool>,
    /// `dark` / `light`.
    pub theme: Option<String>,
    /// `full_path` / `tree`.
    pub file_view: Option<String>,
    pub max_commits: Option<u32>,
}

fn root() -> Option<PathBuf> {
    // Windows: %APPDATA%\.gitkraken; macOS/Linux: ~/.gitkraken
    let candidates = [
        dirs::config_dir().map(|d| d.join(".gitkraken")),
        dirs::home_dir().map(|d| d.join(".gitkraken")),
    ];
    candidates.into_iter().flatten().find(|p| p.join("config").exists())
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(p).ok()?).ok()
}

fn repo_of(path: &str) -> Option<ImportedRepo> {
    let p = path.trim_end_matches(['/', '\\']);
    let p = p.strip_suffix("/.git").or_else(|| p.strip_suffix("\\.git")).unwrap_or(p);
    let dir = Path::new(p);
    if !dir.join(".git").exists() {
        return None;
    }
    let display = dir.display().to_string().replace('/', std::path::MAIN_SEPARATOR_STR);
    Some(ImportedRepo {
        name: dir.file_name()?.to_string_lossy().into_owned(),
        path: display,
    })
}

/// What a GitKraken install has to offer; `None` when GitKraken is not installed.
pub fn read() -> Option<GitKrakenData> {
    let root = root()?;
    let profiles = root.join("profiles");
    // Prefer the most recently modified profile.
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(&profiles)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.join("profile").exists())
        .collect();
    dirs.sort_by_key(|p| {
        std::fs::metadata(p.join("profile"))
            .and_then(|m| m.modified())
            .ok()
    });
    let dir = dirs.pop()?;
    let profile = read_json(&dir.join("profile")).unwrap_or(Value::Null);
    let cache = read_json(&dir.join("localRepoCache")).unwrap_or(Value::Null);
    let config = read_json(&root.join("config")).unwrap_or(Value::Null);

    let mut repos: Vec<ImportedRepo> = Vec::new();
    let push = |r: ImportedRepo, list: &mut Vec<ImportedRepo>| {
        if !list.iter().any(|x| settings::same_path(&x.path, &r.path)) {
            list.push(r);
        }
    };
    let mut tabs: Vec<ImportedRepo> = Vec::new();
    let mut selected_tab = None;
    let selected_id = profile.pointer("/tabInfo/selectedTabId").and_then(Value::as_str);
    if let Some(list) = profile.pointer("/tabInfo/tabs").and_then(Value::as_array) {
        for t in list {
            if t.get("type").and_then(Value::as_str) != Some("REPO") {
                continue;
            }
            let Some(r) = t.get("repoPath").and_then(Value::as_str).and_then(repo_of) else {
                continue;
            };
            if selected_id.is_some() && t.get("id").and_then(Value::as_str) == selected_id {
                selected_tab = Some(r.path.clone());
            }
            push(r.clone(), &mut tabs);
            push(r, &mut repos);
        }
    }
    if let Some(list) = cache.get("localRepoCache").and_then(Value::as_array) {
        for p in list.iter().filter_map(Value::as_str) {
            if let Some(r) = repo_of(p) {
                push(r, &mut repos);
            }
        }
    }

    let s = |ptr: &str| {
        profile
            .pointer(ptr)
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    };
    Some(GitKrakenData {
        repos,
        tabs,
        selected_tab,
        ssh_private_key: s("/ssh/privateKey").filter(|p| Path::new(p).exists()),
        ssh_public_key: s("/ssh/publicKey").filter(|p| Path::new(p).exists()),
        ssh_use_agent: profile.pointer("/ssh/useLocalAgent").and_then(Value::as_bool),
        theme: s("/ui/theme"),
        file_view: s("/fileNodeList/viewMode"),
        max_commits: config
            .pointer("/commits/maxCommitsInGraph")
            .and_then(Value::as_u64)
            .map(|n| n as u32),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub data: GitKrakenData,
    pub added_repos: usize,
    pub ssh_imported: bool,
}

/// Merge GitKraken's repositories and SSH key into GitStudio's settings. Tabs, theme and file
/// view live in the UI, which applies them from `data`.
pub fn import(include_ssh: bool) -> Result<ImportResult> {
    let data = read().ok_or_else(|| Error::Invalid("GitKraken Desktop was not found on this computer".into()))?;
    let added = settings::add_recent(
        &data
            .repos
            .iter()
            .map(|r| (r.path.clone(), r.name.clone()))
            .collect::<Vec<_>>(),
    )?;
    let mut ssh_imported = false;
    let mut s = settings::load();
    if include_ssh {
        if let Some(key) = &data.ssh_private_key {
            s.ssh.private_key = key.clone();
            s.ssh.public_key = data.ssh_public_key.clone().unwrap_or_default();
            s.ssh.mode = if data.ssh_use_agent == Some(true) { "system".into() } else { "key".into() };
            ssh_imported = true;
        }
    }
    if let Some(n) = data.max_commits {
        s.initial_commits = n.clamp(500, 20_000);
    }
    settings::save(&s)?;
    Ok(ImportResult {
        data,
        added_repos: added,
        ssh_imported,
    })
}
