//! "Open with GitStudio" in the file manager's context menu (like GitKraken's), with the
//! GitStudio icon, on a folder and on the empty space inside a folder.
//!
//! - Windows: a verb under HKCU\Software\Classes (no administrator rights), written at startup
//!   when the preference is on, so it always points at the running GitStudio.
//! - Linux / macOS: the file-manager extensions add the same item (see gitstudio_overlay.py and
//!   FinderSync.swift).

use crate::error::Result;

pub const OPEN_LABEL: &str = "Open with GitStudio";

#[cfg(windows)]
mod platform {
    use super::*;
    use std::process::Command;

    const VERB: &str = "GitStudio.Open";
    /// Entries of earlier versions, removed whenever the menu is (re)written.
    const LEGACY_VERBS: [&str; 1] = ["GitStudio.Clone"];

    /// (registry parent, placeholder for the folder)
    const PARENTS: [(&str, &str); 3] = [
        (r"Directory\shell", "%1"),
        (r"Directory\Background\shell", "%V"),
        (r"Drive\shell", "%1"),
    ];

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

    fn command(exe: &str, placeholder: &str) -> String {
        format!("\"{exe}\" --open \"{placeholder}\"")
    }

    fn current(parent: &str) -> Option<String> {
        let out = reg(&["query", &format!(r"{}\command", key(parent, VERB)), "/ve"])?;
        out.lines()
            .find_map(|l| l.split_once("REG_SZ").map(|(_, v)| v.trim().to_string()))
    }

    fn remove_legacy() {
        for (parent, _) in PARENTS {
            for verb in LEGACY_VERBS {
                if reg(&["query", &key(parent, verb)]).is_some() {
                    reg(&["delete", &key(parent, verb), "/f"]);
                }
            }
        }
    }

    pub fn installed(exe: &str) -> bool {
        PARENTS
            .iter()
            .all(|(p, ph)| current(p).as_deref() == Some(&command(exe, ph)))
    }

    pub fn install(exe: &str) -> Result<()> {
        remove_legacy();
        if installed(exe) {
            return Ok(());
        }
        for (parent, placeholder) in PARENTS {
            let k = key(parent, VERB);
            reg(&[
                "add", &k, "/v", "MUIVerb", "/t", "REG_SZ", "/d", OPEN_LABEL, "/f",
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
                &command(exe, placeholder),
                "/f",
            ]);
        }
        Ok(())
    }

    pub fn remove() -> Result<()> {
        remove_legacy();
        for (parent, _) in PARENTS {
            reg(&["delete", &key(parent, VERB), "/f"]);
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    // The Finder / Nautilus extensions draw this item themselves.
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

/// The program the menu entry starts (an AppImage's own path, not its mount).
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

/// Add or refresh the entry for the running GitStudio (no-op when already in place).
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
    let _ = if crate::settings::load().context_menu {
        install()
    } else {
        remove()
    };
}
