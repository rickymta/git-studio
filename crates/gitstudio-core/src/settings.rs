//! JSON settings file (preferences, recent repositories). Never holds secrets.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::Result;

const MAX_RECENT: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub recent: Vec<RecentRepo>,
    /// Client ID of a GitHub OAuth App with device flow enabled.
    pub github_client_id: String,
    /// Default folder for clones.
    pub clone_dir: String,
    /// `merge`, `rebase` or `ff-only`.
    pub pull_mode: String,
    /// How git authenticates over SSH.
    pub ssh: crate::ssh::SshSettings,
    /// Use SSH (not HTTPS) URLs when adding or cloning GitHub repositories.
    pub prefer_ssh: bool,
    /// Minutes between background fetches of the open repository; 0 disables.
    pub auto_fetch_minutes: u32,
    /// Remove remote-tracking branches deleted on the remote when fetching.
    pub auto_prune: bool,
    /// Initial branch for new repositories.
    pub default_branch: String,
    /// Commits loaded into the graph at a time.
    pub initial_commits: u32,
    /// Reopen the tabs of the last session.
    pub remember_tabs: bool,
    /// Command that opens a file or folder in an editor (e.g. `code`).
    pub external_editor: String,
    /// `auto`, `wt`, `powershell`, `cmd` or `gitbash`.
    pub terminal: String,
    /// Activity history older than this many days is deleted at startup; 0 keeps everything.
    pub history_retention_days: u32,
    /// Size of the activity file (MB) above which the app warns.
    pub history_warn_mb: u32,
    /// Size (MB) the activity file is never allowed to exceed: oldest entries are dropped.
    pub history_max_mb: u32,
    /// Most recent activity entries loaded into the app at startup.
    pub history_load_limit: u32,
    /// Git status icons on folders in Explorer / Finder / Nautilus (see overlay.rs).
    pub overlay_icons: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            recent: Vec::new(),
            github_client_id: String::new(),
            clone_dir: String::new(),
            pull_mode: "merge".into(),
            ssh: Default::default(),
            prefer_ssh: false,
            auto_fetch_minutes: 5,
            auto_prune: true,
            default_branch: "main".into(),
            initial_commits: 2000,
            remember_tabs: true,
            external_editor: "code".into(),
            terminal: "auto".into(),
            history_retention_days: 30,
            history_warn_mb: 5,
            history_max_mb: 20,
            history_load_limit: 2000,
            // On by default; the app finishes the setup on first launch (see overlaySetup.ts).
            overlay_icons: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentRepo {
    pub path: String,
    pub name: String,
    pub opened_at: i64,
}

/// Folder holding settings.json, activity.jsonl and ui-state.json.
pub fn dir() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(std::env::temp_dir);
    base.join("GitStudio")
}

fn file() -> PathBuf {
    dir().join("settings.json")
}

pub fn load() -> Settings {
    let mut s: Settings = std::fs::read(file())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    if s.github_client_id.is_empty() {
        if let Ok(id) = std::env::var("GITSTUDIO_GITHUB_CLIENT_ID") {
            s.github_client_id = id;
        }
    }
    if s.clone_dir.is_empty() {
        s.clone_dir = dirs::home_dir()
            .map(|h| h.join("source").join("repos").display().to_string())
            .unwrap_or_default();
    }
    if s.pull_mode.is_empty() {
        s.pull_mode = "merge".into();
    }
    if s.default_branch.trim().is_empty() {
        s.default_branch = "main".into();
    }
    s.initial_commits = s.initial_commits.clamp(500, 20_000);
    s.auto_fetch_minutes = s.auto_fetch_minutes.min(60);
    s.history_retention_days = s.history_retention_days.min(3650);
    s.history_max_mb = s.history_max_mb.clamp(1, 1024);
    s.history_warn_mb = s.history_warn_mb.clamp(1, s.history_max_mb);
    s.history_load_limit = s.history_load_limit.clamp(100, 100_000);
    s
}

pub fn save(s: &Settings) -> Result<()> {
    let path = file();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // Write then rename, so a reader (the overlay refresher) never sees a half-written file.
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&tmp, serde_json::to_vec_pretty(s)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Save preferences coming from the UI. The recent list is owned by the backend and kept as is,
/// so a stale copy in the UI cannot drop repositories opened meanwhile.
pub fn save_preferences(mut s: Settings) -> Result<Settings> {
    s.recent = load().recent;
    save(&s)?;
    Ok(load())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn touch_recent(path: &str, name: &str) -> Result<Settings> {
    let mut s = load();
    s.recent.retain(|r| !same_path(&r.path, path));
    s.recent.insert(
        0,
        RecentRepo {
            path: path.to_string(),
            name: name.to_string(),
            opened_at: now(),
        },
    );
    s.recent.truncate(MAX_RECENT);
    save(&s)?;
    Ok(s)
}

/// Append repositories that are not in the recent list yet (keeps the existing order first).
pub fn add_recent(repos: &[(String, String)]) -> Result<usize> {
    let mut s = load();
    let before = s.recent.len();
    for (path, name) in repos {
        if !s.recent.iter().any(|r| same_path(&r.path, path)) {
            s.recent.push(RecentRepo {
                path: path.clone(),
                name: name.clone(),
                opened_at: 0,
            });
        }
    }
    s.recent.truncate(MAX_RECENT);
    let added = s.recent.len().saturating_sub(before);
    save(&s)?;
    Ok(added)
}

pub fn forget_recent(path: &str) -> Result<Settings> {
    let mut s = load();
    s.recent.retain(|r| !same_path(&r.path, path));
    save(&s)?;
    Ok(s)
}

pub fn same_path(a: &str, b: &str) -> bool {
    let norm = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    norm(a) == norm(b)
}
