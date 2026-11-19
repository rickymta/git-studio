// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Started at sign-in to keep the file-manager status icons fresh: no window, no UI.
    if std::env::args().any(|a| a == "--overlay-serve") {
        gitstudio_core::overlay::serve();
        return;
    }
    // "Open with GitStudio" / "Git Clone…" from the file manager's context menu.
    let args: Vec<String> = std::env::args().collect();
    if let Some(action) = gitstudio_core::launch::parse(&args) {
        gitstudio_core::launch::push(action);
    }
    gitstudio_lib::run();
}
