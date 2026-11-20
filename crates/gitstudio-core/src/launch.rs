//! What GitStudio was launched to do from a file manager's context menu:
//! `GitStudio --open <folder>` ("Open with GitStudio").
//! The shell queues the action; the UI takes it once it is ready (`app.takeLaunchActions`).

use std::sync::Mutex;

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Action {
    /// Open this folder (a repository) in a tab.
    Open { path: String },
}

static PENDING: Mutex<Vec<Action>> = Mutex::new(Vec::new());

/// The action in a command line, if any (`--open <folder>`).
pub fn parse(args: &[String]) -> Option<Action> {
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == "--open" {
            let path = clean(it.next()?);
            return Some(Action::Open { path });
        }
    }
    None
}

/// Explorer passes `%V` of a drive root as `C:\"` when quoted; drop stray quotes and slashes.
fn clean(p: &str) -> String {
    let p = p.trim().trim_matches('"');
    let trimmed = p.trim_end_matches(['\\', '/']);
    if trimmed.ends_with(':') {
        format!("{trimmed}\\")
    } else if trimmed.is_empty() {
        p.to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn push(action: Action) {
    PENDING
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .push(action);
}

pub fn take() -> Vec<Action> {
    std::mem::take(&mut *PENDING.lock().unwrap_or_else(|p| p.into_inner()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_actions() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            parse(&a(&["gitstudio.exe", "--open", r"H:\Work\repo\"])),
            Some(Action::Open {
                path: r"H:\Work\repo".into()
            })
        );
        assert_eq!(
            parse(&a(&["gitstudio.exe", "--open", "C:\\\""])),
            Some(Action::Open {
                path: "C:\\".into()
            })
        );
        assert_eq!(parse(&a(&["gitstudio.exe"])), None);
        assert_eq!(parse(&a(&["gitstudio.exe", "--open"])), None);
    }

    #[test]
    fn queue() {
        push(Action::Open { path: "a".into() });
        push(Action::Open { path: "b".into() });
        assert_eq!(take().len(), 2);
        assert!(take().is_empty());
    }
}
