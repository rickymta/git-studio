//! Small JSON settings file (recent repositories, GitHub OAuth client ID…). Never holds secrets.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::Result;

const MAX_RECENT: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub recent: Vec<RecentRepo>,
    /// Client ID of a GitHub OAuth App with device flow enabled.
    pub github_client_id: String,
    /// Default folder for clones.
    pub clone_dir: String,
    /// `merge`, `rebase` or `ff-only`.
    pub pull_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentRepo {
    pub path: String,
    pub name: String,
    pub opened_at: i64,
}

fn file() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(std::env::temp_dir);
    base.join("GitStudio").join("settings.json")
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
    s
}

pub fn save(s: &Settings) -> Result<()> {
    let path = file();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(s)?)?;
    Ok(())
}

pub fn touch_recent(path: &str, name: &str) -> Result<Settings> {
    let mut s = load();
    s.recent.retain(|r| !same_path(&r.path, path));
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    s.recent.insert(
        0,
        RecentRepo {
            path: path.to_string(),
            name: name.to_string(),
            opened_at: now,
        },
    );
    s.recent.truncate(MAX_RECENT);
    save(&s)?;
    Ok(s)
}

pub fn forget_recent(path: &str) -> Result<Settings> {
    let mut s = load();
    s.recent.retain(|r| !same_path(&r.path, path));
    save(&s)?;
    Ok(s)
}

fn same_path(a: &str, b: &str) -> bool {
    let norm = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    norm(a) == norm(b)
}
