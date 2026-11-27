//! Tauri shell: one `call` command that forwards to `gitstudio_core::dispatch`.

use serde_json::Value;
use tauri::{Manager, PhysicalPosition, PhysicalSize};

/// Share of the screen the main window covers when the app starts.
const START_FRACTION: f64 = 0.85;

#[tauri::command]
async fn call(cmd: String, args: Value) -> Result<Value, gitstudio_core::Error> {
    gitstudio_core::dispatch(&cmd, args).await
}

/// Size the main window to 85% of the monitor's work area, centred, then show it
/// (it starts hidden so it never flashes at the configured size).
fn fit_to_screen(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
        let area = monitor.work_area();
        let w = (area.size.width as f64 * START_FRACTION).round() as u32;
        let h = (area.size.height as f64 * START_FRACTION).round() as u32;
        window.set_size(PhysicalSize::new(w, h))?;
        window.set_position(PhysicalPosition::new(
            area.position.x + ((area.size.width - w) / 2) as i32,
            area.position.y + ((area.size.height - h) / 2) as i32,
        ))?;
    }
    window.show()?;
    window.set_focus()?;
    Ok(())
}

/// Bring the already-running main window to the front (a second launch lands here
/// instead of opening another window).
#[cfg(all(desktop, not(debug_assertions)))]
fn focus_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Release builds only: a dev build (same identifier) would otherwise hand off to an
    // installed GitStudio that is running and quit at once.
    // Must be the first plugin: a second launch hands its arguments to the running
    // instance and exits before anything else starts.
    #[cfg(all(desktop, not(debug_assertions)))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        // A context-menu launch while GitStudio is open: hand the action to this window.
        if let Some(action) = gitstudio_core::launch::parse(&args) {
            gitstudio_core::launch::push(action);
            let _ = tauri::Emitter::emit(app, "launch-action", ());
        }
        focus_main(app)
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // The context menu entry follows the preference and points at this program.
            std::thread::spawn(gitstudio_core::shell_menu::sync_with_settings);
            // After an update: Explorer's status icons move to this version's DLL by themselves.
            let resources = app.path().resource_dir().ok();
            std::thread::spawn(move || {
                let _ = gitstudio_core::overlay_install::upgrade(resources.as_deref());
            });
            // Keep overlay-status.json fresh while the app is open (when the icons are on).
            std::thread::spawn(|| {
                loop {
                    gitstudio_core::overlay::tick();
                    std::thread::sleep(gitstudio_core::overlay::INTERVAL);
                }
            });
            if let Some(window) = app.get_webview_window("main") {
                if fit_to_screen(&window).is_err() {
                    let _ = window.show();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![call])
        .run(tauri::generate_context!())
        .expect("error while running GitStudio");
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    /// The opener plugin refuses every URL / path its permission has no scope for, so a bare
    /// `opener:allow-open-url` made "Create a token" (GitHub, GitLab) and sign-in links fail,
    /// and a bare `opener:allow-open-path` broke "Show in folder".
    #[test]
    fn opener_permissions_have_scopes() {
        let caps: Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let perms = caps["permissions"].as_array().unwrap();
        let named = |id: &str| perms.iter().any(|p| p.as_str() == Some(id));
        let scoped = |id: &str| {
            perms.iter().any(|p| {
                p["identifier"].as_str() == Some(id)
                    && p["allow"].as_array().is_some_and(|a| !a.is_empty())
            })
        };
        assert!(named("opener:allow-open-url") || scoped("opener:allow-open-url"));
        assert!(
            named("opener:allow-default-urls") || scoped("opener:allow-open-url"),
            "http(s) links need a URL scope"
        );
        assert!(
            scoped("opener:allow-open-path"),
            "opening paths needs a path scope"
        );
        assert!(
            !named("opener:allow-open-path"),
            "a bare allow-open-path allows nothing"
        );
    }
}
