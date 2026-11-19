//! Explorer icon overlays for GitStudio, the way TortoiseGit draws them: a badge on the corner of
//! every repository folder — green (clean), orange (changes / commits to push or pull), red
//! (conflicts, unfinished merge or rebase, upstream gone).
//!
//! Explorer loads this DLL in-process, so it never runs git: it reads `overlay-status.json`,
//! which GitStudio keeps fresh (see `gitstudio_core::overlay`). Registered with
//! `regsvr32 gitstudio_overlay.dll` (needs administrator rights: overlay handlers live under
//! HKLM), which GitStudio runs from Preferences → Integrations.
//!
//! Only Windows has anything here; on other platforms the crate is empty.

#[cfg(windows)]
mod imp;

#[cfg(windows)]
pub use imp::*;
