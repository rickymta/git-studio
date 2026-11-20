//! Turning the file-manager status icons on and off on each platform:
//! - Windows: register the Explorer overlay DLL (needs administrator rights: UAC prompt) and start
//!   `GitStudio --overlay-serve` at sign-in (HKCU Run key).
//! - macOS: enable the Finder Sync extension (pluginkit) and a LaunchAgent for the refresher.
//! - Linux: install the Nautilus / Nemo / Caja python extension and its emblems in the user's
//!   home, and an autostart entry for the refresher. The python bindings themselves come from the
//!   distribution (commands offered in Preferences, run with sudo in a terminal).
//!
//! `resource_dir` is the app's resource folder (bundle `overlay/*`); in debug builds the source
//! folder `src-tauri/overlay` is used when it is missing.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[cfg_attr(target_os = "macos", allow(unused_imports))]
use crate::error::{Error, Result};
use crate::{overlay, settings};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickCommand {
    pub label: String,
    pub command: String,
    /// Runs with sudo (the user types the password in the terminal).
    pub sudo: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    /// `windows`, `macos` or `linux`.
    pub platform: &'static str,
    /// The preference (refresher running / started at sign-in).
    pub enabled: bool,
    /// The file-manager side is in place (DLL registered, extension enabled / installed).
    pub installed: bool,
    /// Repositories in the status file and when it was last refreshed (ms).
    pub repos: usize,
    pub updated: i64,
    pub status_file: String,
    /// Things the user should know (overlay slots taken, missing python bindings, …).
    pub notes: Vec<String>,
    /// Suggested commands to run in a terminal (macOS / Linux).
    pub commands: Vec<QuickCommand>,
    /// Folder the terminal for those commands starts in.
    pub home: String,
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
fn overlay_dir(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let from_bundle = resource_dir
        .map(|d| d.join("overlay"))
        .filter(|d| d.is_dir());
    if from_bundle.is_some() {
        return from_bundle;
    }
    if cfg!(debug_assertions) {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/overlay");
        if src.is_dir() {
            return Some(src);
        }
    }
    None
}

/// The program to start at sign-in: an AppImage's own path, not its temporary mount.
fn exe() -> Result<PathBuf> {
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        return Ok(PathBuf::from(appimage));
    }
    Ok(std::env::current_exe()?)
}

fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

fn output(cmd: &str, args: &[&str]) -> Option<String> {
    let out = hidden(&mut Command::new(cmd)).args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Start the refresher now (it exits by itself when the preference is turned off).
/// (macOS starts it through launchd instead.)
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn spawn_server() -> Result<()> {
    let mut cmd = Command::new(exe()?);
    cmd.arg("--overlay-serve");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
        cmd.creation_flags(0x0000_0008 | 0x0800_0000 | 0x0000_0200);
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    cmd.spawn()?;
    Ok(())
}

fn set_enabled(on: bool) -> Result<()> {
    let mut s = settings::load();
    s.overlay_icons = on;
    settings::save(&s)
}

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(std::env::temp_dir)
}

fn base_info(platform: &'static str) -> Info {
    let status = overlay::read();
    Info {
        platform,
        enabled: settings::load().overlay_icons,
        installed: false,
        repos: status.as_ref().map(|s| s.repos.len()).unwrap_or(0),
        updated: status.as_ref().map(|s| s.updated).unwrap_or(0),
        status_file: overlay::status_file().display().to_string(),
        notes: Vec::new(),
        commands: Vec::new(),
        home: home().display().to_string(),
    }
}

// ---- Windows ------------------------------------------------------------------------------------------

#[cfg(windows)]
mod platform {
    use super::*;

    const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    const RUN_VALUE: &str = "GitStudio Overlay";
    const CLSID_CLEAN: &str = "{6a1f3c20-5b7e-4d2a-9c41-2f8e0b6d7a01}";
    const OVERLAYS: &str =
        r"HKLM\Software\Microsoft\Windows\CurrentVersion\Explorer\ShellIconOverlayIdentifiers";
    const OUR_FIRST: &str = "   GitStudio1Clean";
    /// Explorer only shows the first 15 overlay handlers (alphabetical order of their names).
    const SLOTS: usize = 15;

    /// Where the DLL is registered from: a per-version copy, so Explorer (which keeps the DLL
    /// loaded) never blocks an update of the app.
    fn install_dir() -> PathBuf {
        dirs::data_local_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("GitStudio")
            .join("overlay")
            .join(env!("CARGO_PKG_VERSION"))
    }

    fn registered_dll() -> Option<String> {
        let out = output(
            "reg",
            &[
                "query",
                &format!(r"HKLM\Software\Classes\CLSID\{CLSID_CLEAN}\InprocServer32"),
                "/ve",
            ],
        )?;
        out.lines()
            .find_map(|l| l.split_once("REG_SZ").map(|(_, v)| v.trim().to_string()))
    }

    fn overlay_names() -> Vec<String> {
        let Some(out) = output("reg", &["query", OVERLAYS]) else {
            return Vec::new();
        };
        let mut names: Vec<String> = out
            .lines()
            .filter_map(|l| {
                l.strip_prefix(&format!(
                    r"{}\",
                    OVERLAYS.replace("HKLM", "HKEY_LOCAL_MACHINE")
                ))
            })
            .map(str::to_string)
            .collect();
        names.sort();
        names
    }

    /// `regsvr32` as administrator (UAC prompt).
    fn regsvr32(dll: &Path, unregister: bool) -> Result<()> {
        let flag = if unregister { "'/u'," } else { "" };
        let script = format!(
            "$p = Start-Process -FilePath regsvr32.exe -ArgumentList {flag}'/s','\"{}\"' -Verb RunAs -Wait -PassThru; exit $p.ExitCode",
            dll.display()
        );
        let st = hidden(&mut Command::new("powershell"))
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .status()?;
        if st.success() {
            Ok(())
        } else {
            Err(Error::Invalid(
                "Administrator permission is needed to change Explorer's overlay icons (the request was declined or failed).".into(),
            ))
        }
    }

    pub fn info(_resource_dir: Option<&Path>) -> Info {
        let mut i = base_info("windows");
        let ours = install_dir().join("gitstudio_overlay.dll");
        let registered = registered_dll();
        i.installed = registered.is_some();
        if let Some(r) = &registered {
            if !Path::new(r).exists() {
                i.installed = false;
            } else if !super::same(Path::new(r), &ours) {
                i.notes.push("An older GitStudio version is registered; turn the icons off and on again to update them.".into());
            }
        }
        let names = overlay_names();
        // Where GitStudio's handlers sit (or would sit) among the overlay handlers.
        let pos = names
            .iter()
            .filter(|n| n.as_str() != OUR_FIRST && n.as_str() < OUR_FIRST)
            .count();
        if pos + 3 > SLOTS {
            i.notes.push(format!(
                "Explorer shows only {SLOTS} overlay handlers and {pos} come before GitStudio's ({}). Some GitStudio badges may not appear; remove unused ones (e.g. TortoiseGit, OneDrive) to free slots.",
                names[..pos].iter().map(|n| n.trim()).collect::<Vec<_>>().join(", ")
            ));
        }
        if names.iter().any(|n| n.contains("Tortoise")) {
            i.notes.push("TortoiseGit / TortoiseSVN overlays are also installed: both may badge the same folders.".into());
        }
        i
    }

    pub fn enable(resource_dir: Option<&Path>) -> Result<()> {
        let src = overlay_dir(resource_dir)
            .filter(|d| d.join("gitstudio_overlay.dll").exists())
            .ok_or_else(|| {
                Error::Invalid(
                    "The overlay DLL is not part of this build (run scripts/build-overlay.mjs)."
                        .into(),
                )
            })?;
        let dst = install_dir();
        std::fs::create_dir_all(&dst)?;
        for f in [
            "gitstudio_overlay.dll",
            "overlay-clean.ico",
            "overlay-changed.ico",
            "overlay-danger.ico",
        ] {
            let to = dst.join(f);
            // A DLL Explorer has loaded cannot be replaced; the per-version folder makes that rare.
            if let Err(e) = std::fs::copy(src.join(f), &to)
                && !to.exists()
            {
                return Err(e.into());
            }
        }
        set_enabled(true)?;
        let exe = exe()?;
        output(
            "reg",
            &[
                "add",
                RUN_KEY,
                "/v",
                RUN_VALUE,
                "/t",
                "REG_SZ",
                "/d",
                &format!("\"{}\" --overlay-serve", exe.display()),
                "/f",
            ],
        );
        overlay::refresh()?;
        spawn_server()?;
        regsvr32(&dst.join("gitstudio_overlay.dll"), false)
    }

    pub fn disable(_resource_dir: Option<&Path>) -> Result<()> {
        set_enabled(false)?;
        output("reg", &["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]);
        match registered_dll() {
            Some(dll) if Path::new(&dll).exists() => regsvr32(Path::new(&dll), true),
            _ => Ok(()),
        }
    }

    /// Restart Explorer so it picks up (or drops) the overlay handlers.
    pub fn restart_file_manager() -> Result<()> {
        let _ = hidden(&mut Command::new("taskkill"))
            .args(["/f", "/im", "explorer.exe"])
            .status();
        hidden(&mut Command::new("cmd"))
            .args(["/c", "start", "", "explorer.exe"])
            .spawn()?;
        Ok(())
    }
}

// ---- macOS -------------------------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod platform {
    use super::*;

    const EXTENSION: &str = "dev.gitstudio.desktop.FinderSync";
    const AGENT: &str = "dev.gitstudio.overlay";

    fn agent_plist() -> PathBuf {
        home()
            .join("Library/LaunchAgents")
            .join(format!("{AGENT}.plist"))
    }

    fn uid() -> String {
        output("id", &["-u"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    }

    fn app_bundle() -> Option<PathBuf> {
        let exe = std::env::current_exe().ok()?;
        exe.ancestors()
            .find(|p| p.extension().is_some_and(|e| e == "app"))
            .map(Path::to_path_buf)
    }

    pub fn info(_resource_dir: Option<&Path>) -> Info {
        let mut i = base_info("macos");
        let state = output("pluginkit", &["-m", "-i", EXTENSION]).unwrap_or_default();
        i.installed = state.trim_start().starts_with('+');
        if state.trim().is_empty() {
            i.notes.push("The Finder extension is not registered yet: open GitStudio from /Applications once, then turn the icons on.".into());
        }
        i.commands.push(QuickCommand {
            label: "Enable the Finder extension".into(),
            command: format!("pluginkit -e use -i {EXTENSION}"),
            sudo: false,
        });
        i.commands.push(QuickCommand {
            label: "Restart Finder".into(),
            command: "killall Finder".into(),
            sudo: false,
        });
        i.commands.push(QuickCommand {
            label: "Open Login Items & Extensions settings".into(),
            command: "open \"x-apple.systempreferences:com.apple.ExtensionsPreferences\"".into(),
            sudo: false,
        });
        if let Some(app) = app_bundle() {
            i.commands.push(QuickCommand {
                label: "Allow the unsigned app and its extension (remove quarantine)".into(),
                command: format!("sudo xattr -dr com.apple.quarantine \"{}\"", app.display()),
                sudo: true,
            });
            i.commands.push(QuickCommand {
                label: "Register the extension with the system".into(),
                command: format!(
                    "pluginkit -a \"{}/Contents/PlugIns/GitStudioFinder.appex\"",
                    app.display()
                ),
                sudo: false,
            });
        }
        i
    }

    pub fn enable(_resource_dir: Option<&Path>) -> Result<()> {
        set_enabled(true)?;
        let exe = exe()?;
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{AGENT}</string>
  <key>ProgramArguments</key>
  <array><string>{}</string><string>--overlay-serve</string></array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
"#,
            exe.display()
        );
        let path = agent_plist();
        if let Some(d) = path.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(&path, plist)?;
        let domain = format!("gui/{}", uid());
        let _ = output("launchctl", &["bootout", &format!("{domain}/{AGENT}")]);
        let _ = output(
            "launchctl",
            &["bootstrap", &domain, &path.display().to_string()],
        );
        overlay::refresh()?;
        if let Some(app) = app_bundle() {
            let appex = app.join("Contents/PlugIns/GitStudioFinder.appex");
            let _ = output("pluginkit", &["-a", &appex.display().to_string()]);
        }
        let _ = output("pluginkit", &["-e", "use", "-i", EXTENSION]);
        Ok(())
    }

    pub fn disable(_resource_dir: Option<&Path>) -> Result<()> {
        set_enabled(false)?;
        let _ = output("pluginkit", &["-e", "ignore", "-i", EXTENSION]);
        let _ = output("launchctl", &["bootout", &format!("gui/{}/{AGENT}", uid())]);
        let _ = std::fs::remove_file(agent_plist());
        Ok(())
    }

    pub fn restart_file_manager() -> Result<()> {
        let _ = output("killall", &["Finder"]);
        Ok(())
    }
}

// ---- Linux --------------------------------------------------------------------------------------------

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::*;

    /// (file manager binary, python extension folder, install command per distro family)
    type Manager = (
        &'static str,
        &'static str,
        [(&'static str, &'static str); 4],
    );

    const MANAGERS: [Manager; 3] = [
        (
            "nautilus",
            "nautilus-python",
            [
                ("debian", "sudo apt install -y python3-nautilus"),
                ("fedora", "sudo dnf install -y nautilus-python"),
                ("arch", "sudo pacman -S --needed python-nautilus"),
                ("suse", "sudo zypper install -y python3-nautilus"),
            ],
        ),
        (
            "nemo",
            "nemo-python",
            [
                ("debian", "sudo apt install -y nemo-python"),
                ("fedora", "sudo dnf install -y nemo-python"),
                ("arch", "sudo pacman -S --needed nemo-python"),
                ("suse", "sudo zypper install -y python3-nemo"),
            ],
        ),
        (
            "caja",
            "caja-python",
            [
                ("debian", "sudo apt install -y python3-caja"),
                ("fedora", "sudo dnf install -y python3-caja"),
                ("arch", "sudo pacman -S --needed python-caja"),
                ("suse", "sudo zypper install -y python3-caja"),
            ],
        ),
    ];

    fn data_home() -> PathBuf {
        dirs::data_dir().unwrap_or_else(|| home().join(".local/share"))
    }

    fn autostart() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| home().join(".config"))
            .join("autostart/gitstudio-overlay.desktop")
    }

    fn installed_managers() -> Vec<&'static Manager> {
        MANAGERS
            .iter()
            .filter(|(bin, _, _)| output("sh", &["-c", &format!("command -v {bin}")]).is_some())
            .collect()
    }

    /// `debian`, `fedora`, `arch` or `suse` from /etc/os-release.
    fn distro_family() -> Option<&'static str> {
        let text = std::fs::read_to_string("/etc/os-release")
            .ok()?
            .to_lowercase();
        let ids: String = text
            .lines()
            .filter(|l| l.starts_with("id=") || l.starts_with("id_like="))
            .collect::<Vec<_>>()
            .join(" ");
        [
            ("debian", ["debian", "ubuntu", "mint"]),
            ("fedora", ["fedora", "rhel", "centos"]),
            ("arch", ["arch", "manjaro", "endeavouros"]),
            ("suse", ["suse", "opensuse", "sles"]),
        ]
        .into_iter()
        .find(|(_, names)| names.iter().any(|n| ids.contains(n)))
        .map(|(f, _)| f)
    }

    /// Whether the file manager's python bindings are installed (it has a python loader module).
    fn has_bindings(bin: &str) -> bool {
        let lib = format!("lib{bin}-python.so");
        [
            "/usr/lib",
            "/usr/lib64",
            "/usr/lib/x86_64-linux-gnu",
            "/usr/lib/aarch64-linux-gnu",
        ]
        .iter()
        .any(|base| {
            std::fs::read_dir(base).ok().is_some_and(|rd| {
                rd.flatten().any(|e| {
                    let d = e.path();
                    d.file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with(bin))
                        && std::fs::read_dir(&d).ok().is_some_and(|inner| {
                            inner.flatten().any(|f| {
                                f.path().join(&lib).exists()
                                    || f.file_name().to_string_lossy() == lib
                            })
                        })
                })
            })
        })
    }

    pub fn info(_resource_dir: Option<&Path>) -> Info {
        let mut i = base_info("linux");
        let managers = installed_managers();
        i.installed = managers.iter().any(|(_, dir, _)| {
            data_home()
                .join(dir)
                .join("extensions/gitstudio_overlay.py")
                .exists()
        });
        let family = distro_family();
        if managers.is_empty() {
            i.notes.push("No supported file manager found (Nautilus, Nemo or Caja). Dolphin users: install dolphin-plugins, which has its own git badges.".into());
        }
        for (bin, _, packages) in &managers {
            if !has_bindings(bin) {
                i.notes.push(format!(
                    "{bin}: its python bindings are not installed, so it cannot load the extension."
                ));
                if let Some(cmd) = family
                    .and_then(|f| packages.iter().find(|(d, _)| *d == f))
                    .map(|(_, c)| c)
                {
                    i.commands.push(QuickCommand {
                        label: format!("Install {bin} python bindings"),
                        command: (*cmd).to_string(),
                        sudo: true,
                    });
                }
            }
            i.commands.push(QuickCommand {
                label: format!("Restart {bin}"),
                command: format!("{bin} -q"),
                sudo: false,
            });
        }
        i
    }

    pub fn enable(resource_dir: Option<&Path>) -> Result<()> {
        let src = overlay_dir(resource_dir)
            .filter(|d| d.join("gitstudio_overlay.py").exists())
            .ok_or_else(|| {
                Error::Invalid("The overlay extension is not part of this build.".into())
            })?;
        for (_, dir, _) in &MANAGERS {
            let to = data_home().join(dir).join("extensions");
            std::fs::create_dir_all(&to)?;
            std::fs::copy(
                src.join("gitstudio_overlay.py"),
                to.join("gitstudio_overlay.py"),
            )?;
        }
        let emblems = data_home().join("icons/hicolor/128x128/emblems");
        std::fs::create_dir_all(&emblems)?;
        for level in ["clean", "changed", "danger"] {
            std::fs::copy(
                src.join(format!("overlay-{level}.png")),
                emblems.join(format!("gitstudio-{level}.png")),
            )?;
        }
        // GitStudio's icon for the "Open with GitStudio" menu item.
        let apps = data_home().join("icons/hicolor/128x128/apps");
        std::fs::create_dir_all(&apps)?;
        if src.join("gitstudio.png").exists() {
            std::fs::copy(src.join("gitstudio.png"), apps.join("gitstudio.png"))?;
        }
        let _ = output(
            "gtk-update-icon-cache",
            &[
                "-q",
                "-t",
                &data_home().join("icons/hicolor").display().to_string(),
            ],
        );
        let entry = autostart();
        if let Some(d) = entry.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(
            &entry,
            format!(
                "[Desktop Entry]\nType=Application\nName=GitStudio status icons\nExec=\"{}\" --overlay-serve\nNoDisplay=true\nX-GNOME-Autostart-enabled=true\n",
                exe()?.display()
            ),
        )?;
        set_enabled(true)?;
        overlay::refresh()?;
        spawn_server()
    }

    pub fn disable(_resource_dir: Option<&Path>) -> Result<()> {
        set_enabled(false)?;
        for (_, dir, _) in &MANAGERS {
            let _ = std::fs::remove_file(
                data_home()
                    .join(dir)
                    .join("extensions/gitstudio_overlay.py"),
            );
        }
        let _ = std::fs::remove_file(autostart());
        Ok(())
    }

    pub fn restart_file_manager() -> Result<()> {
        for (bin, _, _) in installed_managers() {
            let _ = output(bin, &["-q"]);
        }
        Ok(())
    }
}

#[allow(dead_code)]
fn same(a: &Path, b: &Path) -> bool {
    overlay::key(a) == overlay::key(b)
}

pub fn info(resource_dir: Option<&Path>) -> Info {
    platform::info(resource_dir)
}

pub fn enable(resource_dir: Option<&Path>) -> Result<Info> {
    platform::enable(resource_dir)?;
    Ok(info(resource_dir))
}

pub fn disable(resource_dir: Option<&Path>) -> Result<Info> {
    platform::disable(resource_dir)?;
    Ok(info(resource_dir))
}

pub fn restart_file_manager() -> Result<()> {
    platform::restart_file_manager()
}
