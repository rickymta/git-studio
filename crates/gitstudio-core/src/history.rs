//! Durable app data next to settings.json:
//! - `activity.jsonl`: the Activity Logs, one JSON object per line (append-only, cheap to write);
//!   entries older than the retention period are dropped at startup, and the file never grows
//!   past `history_max_mb` (oldest entries go first).
//! - `ui-state.json`: small UI preferences (tabs, column widths, graph filters, …) read once at
//!   startup.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::error::Result;
use crate::settings;

const MB: u64 = 1024 * 1024;
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// One writer at a time for both files (Tauri commands may run concurrently).
static LOCK: Mutex<()> = Mutex::new(());

fn activity_file(dir: &Path) -> PathBuf {
    dir.join("activity.jsonl")
}

fn state_file(dir: &Path) -> PathBuf {
    dir.join("ui-state.json")
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub path: String,
    pub bytes: u64,
    pub entries: usize,
    /// `ok`, `warn` (over the warning size) or `full` (at the hard limit, oldest being dropped).
    pub level: &'static str,
    pub warn_bytes: u64,
    pub max_bytes: u64,
    pub retention_days: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    /// Most recent entries, oldest first.
    pub entries: Vec<Value>,
    /// Entries deleted by the retention period during this load.
    pub pruned: usize,
    pub stats: Stats,
}

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub retention_days: u32,
    pub warn_bytes: u64,
    pub max_bytes: u64,
    pub load_limit: usize,
}

impl Limits {
    fn from_settings() -> Self {
        let s = settings::load();
        Limits {
            retention_days: s.history_retention_days,
            warn_bytes: s.history_warn_mb as u64 * MB,
            max_bytes: s.history_max_mb as u64 * MB,
            load_limit: s.history_load_limit as usize,
        }
    }
}

fn entry_time(v: &Value) -> i64 {
    v.get("at").and_then(Value::as_i64).unwrap_or(0)
}

fn read_lines(file: &Path) -> Vec<String> {
    fs::read_to_string(file)
        .map(|t| {
            t.lines()
                .filter(|l| !l.trim().is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn write_lines(file: &Path, lines: &[String]) -> Result<()> {
    if let Some(d) = file.parent() {
        fs::create_dir_all(d)?;
    }
    let tmp = file.with_extension("jsonl.tmp");
    let mut text = lines.join("\n");
    if !text.is_empty() {
        text.push('\n');
    }
    fs::write(&tmp, text)?;
    fs::rename(&tmp, file)?;
    Ok(())
}

fn stats(dir: &Path, entries: usize, limits: Limits) -> Stats {
    let file = activity_file(dir);
    let bytes = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    let level = if bytes >= limits.max_bytes * 9 / 10 {
        "full"
    } else if bytes >= limits.warn_bytes {
        "warn"
    } else {
        "ok"
    };
    Stats {
        path: file.display().to_string(),
        bytes,
        entries,
        level,
        warn_bytes: limits.warn_bytes,
        max_bytes: limits.max_bytes,
        retention_days: limits.retention_days,
    }
}

/// Keep the newest lines that fit in `budget` bytes.
fn newest_within(lines: Vec<String>, budget: u64) -> Vec<String> {
    let mut size = 0u64;
    let mut keep = Vec::new();
    for l in lines.into_iter().rev() {
        size += l.len() as u64 + 1;
        if size > budget {
            break;
        }
        keep.push(l);
    }
    keep.reverse();
    keep
}

pub fn load_in(dir: &Path, limits: Limits) -> Result<Loaded> {
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let file = activity_file(dir);
    let lines = read_lines(&file);
    let total = lines.len();
    let cutoff = if limits.retention_days == 0 {
        i64::MIN
    } else {
        now_ms() - limits.retention_days as i64 * DAY_MS
    };
    // Unparsable lines (a crash mid-write) are dropped along with expired ones.
    let kept: Vec<String> = lines
        .into_iter()
        .filter(|l| {
            serde_json::from_str::<Value>(l)
                .map(|v| entry_time(&v) >= cutoff)
                .unwrap_or(false)
        })
        .collect();
    let pruned = total - kept.len();
    let kept = if kept.iter().map(|l| l.len() as u64 + 1).sum::<u64>() > limits.max_bytes {
        newest_within(kept, limits.max_bytes * 8 / 10)
    } else {
        kept
    };
    if kept.len() != total {
        write_lines(&file, &kept)?;
    }
    let entries: Vec<Value> = kept[kept.len().saturating_sub(limits.load_limit)..]
        .iter()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    Ok(Loaded {
        entries,
        pruned,
        stats: stats(dir, kept.len(), limits),
    })
}

pub fn append_in(dir: &Path, entries: &[Value], limits: Limits) -> Result<Stats> {
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let file = activity_file(dir);
    fs::create_dir_all(dir)?;
    let mut out = String::new();
    for e in entries {
        let mut e = e.clone();
        if entry_time(&e) == 0 {
            if let Some(o) = e.as_object_mut() {
                o.insert("at".into(), now_ms().into());
            }
        }
        out.push_str(&serde_json::to_string(&e)?);
        out.push('\n');
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)?
        .write_all(out.as_bytes())?;
    let bytes = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    let mut count = None;
    if bytes > limits.max_bytes {
        // Over the hard limit: keep the newest 80% so this does not happen on every write.
        let kept = newest_within(read_lines(&file), limits.max_bytes * 8 / 10);
        count = Some(kept.len());
        write_lines(&file, &kept)?;
    }
    let entries = count.unwrap_or_else(|| read_lines(&file).len());
    Ok(stats(dir, entries, limits))
}

/// Delete the activity of one repository (`Some(path)`), application events (`Some("")`), or all.
pub fn clear_in(dir: &Path, repo: Option<&str>, limits: Limits) -> Result<Stats> {
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let file = activity_file(dir);
    let kept: Vec<String> = match repo {
        None => Vec::new(),
        Some(r) => read_lines(&file)
            .into_iter()
            .filter(|l| {
                let v: Value = serde_json::from_str(l).unwrap_or(Value::Null);
                let repo = v.get("repo").and_then(Value::as_str).unwrap_or("");
                repo != r
            })
            .collect(),
    };
    write_lines(&file, &kept)?;
    Ok(stats(dir, kept.len(), limits))
}

pub fn state_load_in(dir: &Path) -> Map<String, Value> {
    fs::read(state_file(dir))
        .ok()
        .and_then(|b| serde_json::from_slice::<Map<String, Value>>(&b).ok())
        .unwrap_or_default()
}

/// Merge `changes` into ui-state.json; a `null` value removes the key.
pub fn state_set_in(dir: &Path, changes: Map<String, Value>) -> Result<()> {
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut state = state_load_in(dir);
    for (k, v) in changes {
        if v.is_null() {
            state.remove(&k);
        } else {
            state.insert(k, v);
        }
    }
    fs::create_dir_all(dir)?;
    let file = state_file(dir);
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(&state)?)?;
    fs::rename(&tmp, file)?;
    Ok(())
}

// ---- entry points used by the dispatcher (the real config folder) ---------------------------------

pub fn load() -> Result<Loaded> {
    load_in(&settings::dir(), Limits::from_settings())
}

pub fn append(entries: &[Value]) -> Result<Stats> {
    append_in(&settings::dir(), entries, Limits::from_settings())
}

pub fn clear(repo: Option<&str>) -> Result<Stats> {
    clear_in(&settings::dir(), repo, Limits::from_settings())
}

pub fn state_load() -> Map<String, Value> {
    state_load_in(&settings::dir())
}

pub fn state_set(changes: Map<String, Value>) -> Result<()> {
    state_set_in(&settings::dir(), changes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn limits() -> Limits {
        Limits {
            retention_days: 30,
            warn_bytes: 300,
            max_bytes: 1000,
            load_limit: 3,
        }
    }

    #[test]
    fn retention_size_limit_and_load_limit() {
        let dir = tempfile::tempdir().unwrap();
        let old = now_ms() - 31 * DAY_MS;
        append_in(
            dir.path(),
            &[
                json!({"at": old, "label": "old"}),
                json!({"label": "a"}),
                json!({"label": "b"}),
            ],
            limits(),
        )
        .unwrap();
        let l = load_in(dir.path(), limits()).unwrap();
        assert_eq!(l.pruned, 1);
        assert_eq!(l.stats.entries, 2);
        assert!(l.entries.iter().all(|e| e["label"] != "old"));

        // Grow past the hard limit: oldest entries go, the newest stay.
        let many: Vec<Value> = (0..40)
            .map(|i| json!({"label": format!("entry {i:02} ......................")}))
            .collect();
        let st = append_in(dir.path(), &many, limits()).unwrap();
        assert!(st.bytes <= 1000);
        assert_ne!(st.level, "ok");
        let l = load_in(dir.path(), limits()).unwrap();
        assert_eq!(l.entries.len(), 3);
        assert_eq!(l.entries[2]["label"], "entry 39 ......................");

        // Clearing one repository keeps the others.
        append_in(dir.path(), &[json!({"repo": "/r", "label": "x"})], limits()).unwrap();
        clear_in(dir.path(), Some("/r"), limits()).unwrap();
        let l = load_in(dir.path(), limits()).unwrap();
        assert!(l.entries.iter().all(|e| e["repo"] != "/r"));
    }

    #[test]
    fn ui_state_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let mut m = Map::new();
        m.insert("gitstudio.tabs".into(), json!("[1]"));
        m.insert("gitstudio.x".into(), json!("y"));
        state_set_in(dir.path(), m).unwrap();
        let mut rm = Map::new();
        rm.insert("gitstudio.x".into(), Value::Null);
        state_set_in(dir.path(), rm).unwrap();
        let s = state_load_in(dir.path());
        assert_eq!(s.get("gitstudio.tabs"), Some(&json!("[1]")));
        assert!(!s.contains_key("gitstudio.x"));
    }
}
