//! File-manager context menu entries, like GitKraken's and TortoiseGit's:
//! "Open with GitStudio" and "Git Clone…" (from the git URL on the clipboard), both with the
//! GitStudio icon, on a folder and on the empty space inside a folder.
//!
//! - Windows: verbs under HKCU\Software\Classes (no administrator rights), written at startup
//!   when the preference is on, so they always point at the running GitStudio.
//! - Linux / macOS: the file-manager extensions add the same items (see gitstudio_overlay.py and
//!   FinderSync.swift); they start the program recorded in overlay-status.json.

use crate::error::Result;

pub const OPEN_LABEL: &str = "Open with GitStudio";
pub const CLONE_LABEL: &str = "Git Clone… (GitStudio)";

#[cfg(windows)]
mod platform {
    use super::*;
    use std::process::Command;

    /// (registry parent, verb key, label, argument, placeholder)
    fn entries() -> Vec<(
        String,
        &'static str,
        &'static str,
        &'static str,
        &'static str,
    )> {
        let mut v = Vec::new();
        for (parent, placeholder) in [
            (r"Directory\shell", "%1"),
            (r"Directory\Background\shell", "%V"),
            (r"Drive\shell", "%1"),
        ] {
            v.push((
                parent.to_string(),
                "GitStudio.Open",
                OPEN_LABEL,
                "--open",
                placeholder,
            ));
            v.push((
                parent.to_string(),
                "GitStudio.Clone",
                CLONE_LABEL,
                "--clone",
                placeholder,
            ));
        }
        v
    }

    fn reg(args: &[&str]) -> Option<String> {
        use std::os::windows::process::CommandExt;
        let out = Command::new("reg")
            .args(args)
            .creation_flags(0x0800_0000)
            .output()
            .ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn key(parent: &str, verb: &str) -> String {
        format!(r"HKCU\Software\Classes\{parent}\{verb}")
    }

    fn command(exe: &str, arg: &str, placeholder: &str) -> String {
        format!("\"{exe}\" {arg} \"{placeholder}\"")
    }

    /// The command currently registered for one entry.
    fn current(parent: &str, verb: &str) -> Option<String> {
        let out = reg(&["query", &format!(r"{}\command", key(parent, verb)), "/ve"])?;
        out.lines()
            .find_map(|l| l.split_once("REG_SZ").map(|(_, v)| v.trim().to_string()))
    }

    pub fn installed(exe: &str) -> bool {
        entries().iter().all(|(p, verb, _, arg, ph)| {
            current(p, verb).as_deref() == Some(&command(exe, arg, ph))
        })
    }

    pub fn install(exe: &str) -> Result<()> {
        if installed(exe) {
            return Ok(());
        }
        for (parent, verb, label, arg, placeholder) in entries() {
            let k = key(&parent, verb);
            reg(&[
                "add", &k, "/v", "MUIVerb", "/t", "REG_SZ", "/d", label, "/f",
            ]);
            // The app's own icon (first icon resource of the exe).
            reg(&[
                "add",
                &k,
                "/v",
                "Icon",
                "/t",
                "REG_SZ",
                "/d",
                &format!("\"{exe}\",0"),
                "/f",
            ]);
            reg(&[
                "add",
                &format!(r"{k}\command"),
                "/ve",
                "/t",
                "REG_SZ",
                "/d",
                &command(exe, arg, placeholder),
                "/f",
            ]);
        }
        Ok(())
    }

    pub fn remove() -> Result<()> {
        for (parent, verb, ..) in entries() {
            reg(&["delete", &key(&parent, verb), "/f"]);
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    // The Finder / Nautilus extensions draw these items themselves.
    pub fn installed(_exe: &str) -> bool {
        true
    }
    pub fn install(_exe: &str) -> Result<()> {
        Ok(())
    }
    pub fn remove() -> Result<()> {
        Ok(())
    }
}

/// The program the menu entries start (an AppImage's own path, not its mount).
pub fn exe() -> Option<String> {
    if let Some(a) = std::env::var_os("APPIMAGE") {
        return Some(a.to_string_lossy().into_owned());
    }
    std::env::current_exe()
        .ok()
        .map(|p| p.display().to_string())
}

pub fn installed() -> bool {
    exe().is_some_and(|e| platform::installed(&e))
}

/// Add or refresh the entries for the running GitStudio (no-op when already in place).
pub fn install() -> Result<()> {
    match exe() {
        Some(e) => platform::install(&e),
        None => Ok(()),
    }
}

pub fn remove() -> Result<()> {
    platform::remove()
}

/// At startup: follow the preference.
pub fn sync_with_settings() {
    if crate::settings::load().context_menu {
        let _ = install();
    }
}
