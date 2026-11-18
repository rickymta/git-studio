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

#[cfg(test)]
mod tests {
    use super::*;

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
