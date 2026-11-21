//! The first screen of each repository, kept on disk so reopening it (also after a restart)
//! shows the graph at once while git catches up. The UI decides what goes in (a page of commits,
//! refs, worktrees); this only stores and returns it, one small JSON file per repository.

use std::path::PathBuf;

use serde_json::Value;

use crate::error::Result;
use crate::settings;

/// Pages bigger than this are not kept (they would not load faster than git).
const MAX_BYTES: usize = 4 * 1024 * 1024;

fn file(repo: &str) -> PathBuf {
    let key = repo.replace('\\', "/").trim_end_matches('/').to_lowercase();
    // FNV-1a: a stable short name per repository.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in key.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    settings::dir().join("pages").join(format!("{h:016x}.json"))
}

/// The page saved for `repo`, or null. A page saved for another path (hash clash) is ignored.
pub fn load(repo: &str) -> Value {
    let Ok(bytes) = std::fs::read(file(repo)) else {
        return Value::Null;
    };
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(v) if v.get("repo").and_then(Value::as_str) == Some(repo) => v,
        _ => Value::Null,
    }
}

/// Keep `page` for `repo` (written to a temporary file, then renamed into place).
pub fn save(repo: &str, mut page: Value) -> Result<()> {
    if let Some(o) = page.as_object_mut() {
        o.insert("repo".into(), Value::String(repo.to_string()));
    }
    let bytes = serde_json::to_vec(&page)?;
    if bytes.len() > MAX_BYTES {
        return Ok(());
    }
    let path = file(repo);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}
