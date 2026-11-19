//! In-app terminal: real pseudo-terminals (ConPTY on Windows) running the user's shell.
//! The UI polls `read` for output, which works the same through Tauri and the dev bridge.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use base64::Engine;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;

use crate::error::{Error, Result};
use crate::settings;

/// Output kept while nobody reads (the panel is hidden); older bytes are dropped.
const MAX_BUFFER: usize = 2 * 1024 * 1024;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    out: Arc<Mutex<Vec<u8>>>,
    exited: Arc<AtomicBool>,
}

fn sessions() -> &'static Mutex<HashMap<u32, Session>> {
    static S: OnceLock<Mutex<HashMap<u32, Session>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

static NEXT: AtomicU32 = AtomicU32::new(1);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub id: u32,
    /// Human-readable shell name, e.g. "PowerShell".
    pub shell: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    /// Raw terminal bytes, base64.
    pub data: String,
    pub exited: bool,
}

#[cfg(windows)]
fn git_root() -> Option<std::path::PathBuf> {
    let out = std::process::Command::new("git")
        .arg("--exec-path")
        .output()
        .ok()?;
    let exec = std::path::PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
    exec.ancestors().nth(3).map(Path::to_path_buf)
}

/// Shell command for the terminal preference (`auto`, `powershell`, `cmd`, `gitbash`, `wt`).
fn shell_command(kind: &str) -> (CommandBuilder, String) {
    #[cfg(windows)]
    {
        if kind == "gitbash" {
            if let Some(bash) = git_root()
                .map(|r| r.join("bin").join("bash.exe"))
                .filter(|p| p.exists())
            {
                let mut c = CommandBuilder::new(bash);
                c.args(["--login", "-i"]);
                return (c, "Git Bash".into());
            }
        }
        if kind == "cmd" {
            return (CommandBuilder::new("cmd.exe"), "Command Prompt".into());
        }
        let mut c = CommandBuilder::new("powershell.exe");
        c.arg("-NoLogo");
        (c, "PowerShell".into())
    }
    #[cfg(not(windows))]
    {
        let _ = kind;
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        let name = Path::new(&shell)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "shell".into());
        let mut c = CommandBuilder::new(shell);
        c.arg("-l");
        (c, name)
    }
}

pub fn open(cwd: &Path, cols: u16, rows: u16) -> Result<Opened> {
    if !cwd.is_dir() {
        return Err(Error::Invalid(format!(
            "Folder not found: {}",
            cwd.display()
        )));
    }
    let pty = native_pty_system()
        .openpty(PtySize {
            rows: rows.max(2),
            cols: cols.max(10),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| Error::Invalid(format!("Could not create a terminal: {e}")))?;
    let (mut cmd, shell) = shell_command(&settings::load().terminal);
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let child = pty
        .slave
        .spawn_command(cmd)
        .map_err(|e| Error::Invalid(format!("Could not start {shell}: {e}")))?;
    drop(pty.slave);
    let mut reader = pty
        .master
        .try_clone_reader()
        .map_err(|e| Error::Invalid(e.to_string()))?;
    let writer = pty
        .master
        .take_writer()
        .map_err(|e| Error::Invalid(e.to_string()))?;

    let out = Arc::new(Mutex::new(Vec::new()));
    let exited = Arc::new(AtomicBool::new(false));
    {
        let out = out.clone();
        let exited = exited.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let mut o = out.lock().unwrap_or_else(|p| p.into_inner());
                        o.extend_from_slice(&buf[..n]);
                        if o.len() > MAX_BUFFER {
                            let cut = o.len() - MAX_BUFFER;
                            o.drain(..cut);
                        }
                    }
                }
            }
            exited.store(true, Ordering::SeqCst);
        });
    }

    let id = NEXT.fetch_add(1, Ordering::SeqCst);
    sessions().lock().unwrap_or_else(|p| p.into_inner()).insert(
        id,
        Session {
            master: pty.master,
            writer,
            child,
            out,
            exited,
        },
    );
    Ok(Opened { id, shell })
}

fn with<T>(id: u32, f: impl FnOnce(&mut Session) -> Result<T>) -> Result<T> {
    let mut map = sessions().lock().unwrap_or_else(|p| p.into_inner());
    let s = map
        .get_mut(&id)
        .ok_or_else(|| Error::Invalid(format!("Terminal {id} is closed")))?;
    f(s)
}

pub fn read(id: u32) -> Result<Output> {
    with(id, |s| {
        let bytes = std::mem::take(&mut *s.out.lock().unwrap_or_else(|p| p.into_inner()));
        Ok(Output {
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
            exited: s.exited.load(Ordering::SeqCst),
        })
    })
}

pub fn write(id: u32, data: &str) -> Result<()> {
    with(id, |s| {
        s.writer.write_all(data.as_bytes())?;
        s.writer.flush()?;
        Ok(())
    })
}

pub fn resize(id: u32, cols: u16, rows: u16) -> Result<()> {
    with(id, |s| {
        s.master
            .resize(PtySize {
                rows: rows.max(2),
                cols: cols.max(10),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| Error::Invalid(e.to_string()))
    })
}

pub fn close(id: u32) -> Result<()> {
    let s = sessions()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .remove(&id);
    if let Some(mut s) = s {
        let _ = s.child.kill();
    }
    Ok(())
}

// ---- font of the user's own terminal -------------------------------------------------------------

/// Font the user's own terminal is configured with, so prompts drawn with icon fonts
/// (oh-my-posh, starship, Nerd Fonts) render here exactly as they do there.
/// Only values the user actually set are filled in.
#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalFont {
    pub face: Option<String>,
    /// Points, as the terminal stores it.
    pub size: Option<f64>,
    /// CSS weight, 100–950.
    pub weight: Option<u16>,
    /// Where the values came from, e.g. "Windows Terminal".
    pub source: Option<String>,
}

pub fn font() -> TerminalFont {
    #[cfg(windows)]
    {
        let kind = settings::load().terminal;
        for path in windows_terminal_settings() {
            if let Some(f) = std::fs::read_to_string(&path)
                .ok()
                .and_then(|text| font_from_windows_terminal(&text, &kind))
            {
                return f;
            }
        }
    }
    TerminalFont::default()
}

/// settings.json of Windows Terminal (stable, Preview, Canary, then the unpackaged build).
#[cfg(windows)]
fn windows_terminal_settings() -> Vec<std::path::PathBuf> {
    let Some(local) = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from) else {
        return Vec::new();
    };
    let mut out: Vec<_> = [
        "Microsoft.WindowsTerminal_8wekyb3d8bbwe",
        "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe",
        "Microsoft.WindowsTerminalCanary_8wekyb3d8bbwe",
    ]
    .iter()
    .map(|pkg| {
        local
            .join("Packages")
            .join(pkg)
            .join("LocalState")
            .join("settings.json")
    })
    .collect();
    out.push(
        local
            .join("Microsoft")
            .join("Windows Terminal")
            .join("settings.json"),
    );
    out
}

// The parsing below is only called on Windows; tests exercise it on every platform.

/// GUID Windows Terminal gives its built-in "Windows PowerShell" profile.
#[cfg(any(windows, test))]
const WT_WINDOWS_POWERSHELL: &str = "{61c54bbd-c2c6-5271-96e7-009a87ff44bf}";

/// Font for the shell `kind` opens: `profiles.defaults`, overridden by the profile that runs the
/// same shell (falling back to the default profile).
#[cfg(any(windows, test))]
fn font_from_windows_terminal(text: &str, kind: &str) -> Option<TerminalFont> {
    use serde_json::Value;
    let v: Value = serde_json::from_str(&strip_jsonc(text)).ok()?;
    let profiles = v.get("profiles")?;
    // `profiles` is `{ defaults, list }`, or a bare list in old settings files.
    let (defaults, list): (Option<&Value>, &[Value]) = match profiles {
        Value::Array(a) => (None, a),
        p => (
            p.get("defaults"),
            p.get("list")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[]),
        ),
    };
    let field = |p: &Value, k: &str| {
        p.get(k)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_lowercase()
    };
    let runs_shell = |p: &Value| {
        let cmd = field(p, "commandline");
        match kind {
            "cmd" => cmd.contains("cmd.exe"),
            "gitbash" => cmd.contains("bash.exe") || field(p, "name").contains("git bash"),
            _ => cmd.contains("powershell.exe") || field(p, "guid") == WT_WINDOWS_POWERSHELL,
        }
    };
    let default_guid = v
        .get("defaultProfile")
        .and_then(Value::as_str)
        .map(str::to_lowercase);
    let profile = list.iter().find(|p| runs_shell(p)).or_else(|| {
        let g = default_guid.as_deref()?;
        list.iter().find(|p| field(p, "guid") == g)
    });

    let mut font = TerminalFont::default();
    for layer in [defaults, profile].into_iter().flatten() {
        apply_font(layer, &mut font);
    }
    if font == TerminalFont::default() {
        return None;
    }
    font.source = Some("Windows Terminal".into());
    Some(font)
}

/// Reads `font.{face,size,weight}` (or the older `fontFace`/`fontSize`/`fontWeight`) of one layer.
#[cfg(any(windows, test))]
fn apply_font(layer: &serde_json::Value, f: &mut TerminalFont) {
    use serde_json::Value;
    let get = |new: &str, old: &str| {
        layer
            .get("font")
            .and_then(|x| x.get(new))
            .or_else(|| layer.get(old))
    };
    if let Some(face) = get("face", "fontFace")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        // A comma-separated list is allowed; the first entry is the user's font.
        f.face = face.split(',').next().map(|s| s.trim().to_string());
    }
    if let Some(size) = get("size", "fontSize")
        .and_then(Value::as_f64)
        .filter(|n| *n > 0.0)
    {
        f.size = Some(size);
    }
    let weight = match get("weight", "fontWeight") {
        Some(Value::Number(n)) => n.as_u64().map(|n| n.clamp(1, 1000) as u16),
        Some(Value::String(s)) => match s.as_str() {
            "thin" => Some(100),
            "extra-light" => Some(200),
            "light" => Some(300),
            "semi-light" => Some(350),
            "normal" => Some(400),
            "medium" => Some(500),
            "semi-bold" => Some(600),
            "bold" => Some(700),
            "extra-bold" => Some(800),
            "black" => Some(900),
            "extra-black" => Some(950),
            _ => None,
        },
        _ => None,
    };
    if weight.is_some() {
        f.weight = weight;
    }
}

/// Turns JSON with comments and trailing commas (what Windows Terminal accepts) into plain JSON.
#[cfg(any(windows, test))]
fn strip_jsonc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.char_indices().map(|(i, c)| (c, i)).peekable();
    let mut in_str = false;
    while let Some((c, i)) = chars.next() {
        if in_str {
            out.push(c);
            match c {
                '\\' => {
                    if let Some((n, _)) = chars.next() {
                        out.push(n);
                    }
                }
                '"' => in_str = false,
                _ => {}
            }
            continue;
        }
        match (c, chars.peek().map(|&(n, _)| n)) {
            ('"', _) => {
                in_str = true;
                out.push(c);
            }
            ('/', Some('/')) => {
                for (n, _) in chars.by_ref() {
                    if n == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            ('/', Some('*')) => {
                chars.next();
                let mut prev = '\0';
                for (n, _) in chars.by_ref() {
                    if prev == '*' && n == '/' {
                        break;
                    }
                    prev = n;
                }
                out.push(' ');
            }
            (',', _) => {
                // Drop the comma when only whitespace/comments stand before `}` or `]`.
                if !matches!(strip_jsonc_lead(&text[i + 1..]), Some('}' | ']')) {
                    out.push(',');
                }
            }
            _ => out.push(c),
        }
    }
    out
}

/// First significant character of `s`, skipping whitespace and comments.
#[cfg(any(windows, test))]
fn strip_jsonc_lead(s: &str) -> Option<char> {
    let mut rest = s;
    loop {
        rest = rest.trim_start();
        if let Some(r) = rest.strip_prefix("//") {
            rest = r.split_once('\n').map(|(_, b)| b).unwrap_or("");
        } else if let Some(r) = rest.strip_prefix("/*") {
            rest = r.split_once("*/").map(|(_, b)| b).unwrap_or("");
        } else {
            return rest.chars().next();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WT: &str = r#"{
        // comment with "quotes", and a comma,
        "defaultProfile": "{574e775e-4f2a-5b96-ac1e-a2962a402336}",
        "profiles": {
            "defaults": { "font": { "face": "MesloLGL Nerd Font Mono" } },
            "list": [
                { "guid": "{61c54bbd-c2c6-5271-96e7-009a87ff44bf}", "name": "Windows PowerShell",
                  "commandline": "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" },
                { "guid": "{0caa0dad-35be-5f56-a8ff-afceeeaa6101}", "name": "Command Prompt",
                  "commandline": "%SystemRoot%\\System32\\cmd.exe",
                  "font": { "face": "Consolas, Cascadia Mono", "size": 11, "weight": "semi-bold" } },
                /* block comment */
                { "guid": "{574e775e-4f2a-5b96-ac1e-a2962a402336}", "name": "PowerShell",
                  "fontFace": "Old Style Key", "fontSize": 13, },
            ],
        },
    }"#;

    #[test]
    fn windows_terminal_defaults_apply_to_the_powershell_profile() {
        let f = font_from_windows_terminal(WT, "auto").unwrap();
        assert_eq!(f.face.as_deref(), Some("MesloLGL Nerd Font Mono"));
        assert_eq!(f.size, None);
        assert_eq!(f.source.as_deref(), Some("Windows Terminal"));
    }

    #[test]
    fn windows_terminal_profile_overrides_defaults() {
        let f = font_from_windows_terminal(WT, "cmd").unwrap();
        assert_eq!(f.face.as_deref(), Some("Consolas"));
        assert_eq!(f.size, Some(11.0));
        assert_eq!(f.weight, Some(600));
    }

    #[test]
    fn windows_terminal_falls_back_to_the_default_profile() {
        // No Git Bash profile: the default profile (with the legacy keys) is used.
        let f = font_from_windows_terminal(WT, "gitbash").unwrap();
        assert_eq!(f.face.as_deref(), Some("Old Style Key"));
        assert_eq!(f.size, Some(13.0));
    }

    #[test]
    fn windows_terminal_without_font_settings_gives_nothing() {
        assert_eq!(
            font_from_windows_terminal(r#"{"profiles":{"list":[{"name":"x"}]}}"#, "auto"),
            None
        );
        assert_eq!(font_from_windows_terminal("not json", "auto"), None);
    }

    #[test]
    fn jsonc_keeps_slashes_and_commas_inside_strings() {
        let s = strip_jsonc(r#"{"a": "http://x, y", /* c */ "b": [1, 2,], }"#);
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["a"], "http://x, y");
        assert_eq!(v["b"], serde_json::json!([1, 2]));
    }

    #[test]
    fn runs_a_command_and_reads_output() {
        let dir = tempfile::tempdir().unwrap();
        let t = open(dir.path(), 80, 24).unwrap();
        write(t.id, "echo gitstudio-pty-ok\r\n").unwrap();
        let mut seen = Vec::new();
        for _ in 0..100 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let o = read(t.id).unwrap();
            let chunk = base64::engine::general_purpose::STANDARD
                .decode(o.data)
                .unwrap();
            // ConPTY asks for the cursor position before starting; a real terminal answers.
            if String::from_utf8_lossy(&chunk).contains("\u{1b}[6n") {
                write(t.id, "\u{1b}[1;1R").unwrap();
            }
            seen.extend(chunk);
            if String::from_utf8_lossy(&seen)
                .matches("gitstudio-pty-ok")
                .count()
                >= 2
            {
                break;
            }
        }
        close(t.id).unwrap();
        // Once echoed as typed, once as output.
        assert!(
            String::from_utf8_lossy(&seen)
                .matches("gitstudio-pty-ok")
                .count()
                >= 2
        );
    }
}
