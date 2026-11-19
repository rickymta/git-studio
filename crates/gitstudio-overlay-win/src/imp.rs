use std::collections::HashMap;
use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use windows::Win32::Foundation::{
    CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_POINTER, ERROR_SUCCESS, HINSTANCE,
    HMODULE, S_FALSE, S_OK,
};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl};
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows::Win32::System::Registry::{
    HKEY, HKEY_LOCAL_MACHINE, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ, RegCloseKey,
    RegCreateKeyExW, RegDeleteTreeW, RegSetValueExW,
};
use windows::Win32::System::SystemServices::DLL_PROCESS_ATTACH;
use windows::Win32::UI::Shell::{
    ISIOI_ICONFILE, ISIOI_ICONINDEX, IShellIconOverlayIdentifier, IShellIconOverlayIdentifier_Impl,
    SHCNE_ASSOCCHANGED, SHCNF_IDLIST, SHChangeNotify,
};
use windows::core::{BOOL, GUID, HRESULT, HSTRING, Interface, PCWSTR, PWSTR, implement};
use windows_core::{IUnknown, Ref};

/// Status levels, in the order of `HANDLERS`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Clean,
    Changed,
    Danger,
}

impl Level {
    fn parse(s: &str) -> Option<Level> {
        match s {
            "clean" => Some(Level::Clean),
            "changed" => Some(Level::Changed),
            "danger" => Some(Level::Danger),
            _ => None,
        }
    }
}

struct Handler {
    clsid: GUID,
    level: Level,
    /// Name under ShellIconOverlayIdentifiers. Explorer only uses the first ~15 entries in
    /// alphabetical order, so the name starts with spaces (as TortoiseGit's and OneDrive's do).
    name: &'static str,
    icon: &'static str,
}

pub const CLSID_CLEAN: GUID = GUID::from_u128(0x6a1f_3c20_5b7e_4d2a_9c41_2f8e_0b6d_7a01);
pub const CLSID_CHANGED: GUID = GUID::from_u128(0x6a1f_3c20_5b7e_4d2a_9c41_2f8e_0b6d_7a02);
pub const CLSID_DANGER: GUID = GUID::from_u128(0x6a1f_3c20_5b7e_4d2a_9c41_2f8e_0b6d_7a03);

const HANDLERS: [Handler; 3] = [
    Handler {
        clsid: CLSID_CLEAN,
        level: Level::Clean,
        name: "   GitStudio1Clean",
        icon: "overlay-clean.ico",
    },
    Handler {
        clsid: CLSID_CHANGED,
        level: Level::Changed,
        name: "   GitStudio2Changed",
        icon: "overlay-changed.ico",
    },
    Handler {
        clsid: CLSID_DANGER,
        level: Level::Danger,
        name: "   GitStudio3Danger",
        icon: "overlay-danger.ico",
    },
];

// ---- status file -----------------------------------------------------------------------------------

/// A status file nobody refreshed for this long is ignored (GitStudio and its agent are gone).
const STALE: Duration = Duration::from_secs(10 * 60);
/// How often Explorer's lookups may re-check the file's modification time.
const RECHECK: Duration = Duration::from_millis(700);

#[derive(Deserialize)]
struct StatusFile {
    updated: i64,
    repos: HashMap<String, String>,
}

struct Cache {
    checked: Instant,
    modified: Option<SystemTime>,
    updated_ms: i64,
    repos: HashMap<String, Level>,
}

static CACHE: Mutex<Option<Cache>> = Mutex::new(None);

fn status_path() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("GITSTUDIO_OVERLAY_STATUS") {
        return Some(PathBuf::from(p));
    }
    // Same folder as gitstudio_core::settings::dir() (dirs::config_dir() = %APPDATA%).
    std::env::var_os("APPDATA").map(|a| {
        PathBuf::from(a)
            .join("GitStudio")
            .join("overlay-status.json")
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Same normalisation as `gitstudio_core::overlay::key` on Windows.
pub fn key(path: &str) -> String {
    let mut s = path.replace('/', "\\");
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        s = rest.to_string();
    }
    while s.len() > 1 && s.ends_with('\\') && !s.ends_with(":\\") {
        s.pop();
    }
    s.to_lowercase()
}

/// Level of the repository at `path`, if GitStudio knows it.
pub fn level_of(path: &str) -> Option<Level> {
    let mut guard = CACHE.lock().unwrap_or_else(|p| p.into_inner());
    let fresh = guard
        .as_ref()
        .is_some_and(|c| c.checked.elapsed() < RECHECK);
    if !fresh {
        let file = status_path()?;
        let modified = std::fs::metadata(&file).and_then(|m| m.modified()).ok();
        let unchanged = guard.as_ref().is_some_and(|c| c.modified == modified);
        if unchanged {
            if let Some(c) = guard.as_mut() {
                c.checked = Instant::now();
            }
        } else {
            let parsed: Option<StatusFile> = std::fs::read(&file)
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok());
            *guard = Some(match parsed {
                Some(f) => Cache {
                    checked: Instant::now(),
                    modified,
                    updated_ms: f.updated,
                    repos: f
                        .repos
                        .into_iter()
                        .filter_map(|(k, v)| Level::parse(&v).map(|l| (k, l)))
                        .collect(),
                },
                None => Cache {
                    checked: Instant::now(),
                    modified,
                    updated_ms: 0,
                    repos: HashMap::new(),
                },
            });
        }
    }
    let c = guard.as_ref()?;
    if now_ms() - c.updated_ms > STALE.as_millis() as i64 {
        return None;
    }
    c.repos.get(&key(path)).copied()
}

// ---- COM objects --------------------------------------------------------------------------------------

static MODULE: AtomicIsize = AtomicIsize::new(0);

fn module_path() -> Option<PathBuf> {
    let mut buf = [0u16; 1024];
    let h = MODULE.load(Ordering::Relaxed);
    // SAFETY: `buf` is a valid writable buffer; the handle is this DLL's (or null = the exe).
    let n = unsafe { GetModuleFileNameW(Some(HMODULE(h as *mut c_void)), &mut buf) } as usize;
    (n > 0).then(|| PathBuf::from(String::from_utf16_lossy(&buf[..n])))
}

#[implement(IShellIconOverlayIdentifier)]
struct Overlay {
    level: Level,
    icon: &'static str,
}

impl IShellIconOverlayIdentifier_Impl for Overlay_Impl {
    fn IsMemberOf(&self, pwszpath: &PCWSTR, dwattrib: u32) -> windows::core::Result<()> {
        const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
        // Only folders get a badge; files are answered without touching anything.
        if dwattrib != 0 && dwattrib & FILE_ATTRIBUTE_DIRECTORY == 0 {
            return Err(S_FALSE.into());
        }
        if pwszpath.is_null() {
            return Err(S_FALSE.into());
        }
        // SAFETY: Explorer passes a valid NUL-terminated wide string.
        let path =
            unsafe { pwszpath.to_string() }.map_err(|_| windows::core::Error::from(S_FALSE))?;
        if level_of(&path) == Some(self.level) {
            Ok(())
        } else {
            Err(S_FALSE.into())
        }
    }

    fn GetOverlayInfo(
        &self,
        pwsziconfile: PWSTR,
        cchmax: i32,
        pindex: *mut i32,
        pdwflags: *mut u32,
    ) -> windows::core::Result<()> {
        if pwsziconfile.is_null() || pindex.is_null() || pdwflags.is_null() {
            return Err(E_POINTER.into());
        }
        let dir = module_path()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .ok_or_else(|| windows::core::Error::from(E_FAIL))?;
        let icon: Vec<u16> = dir
            .join(self.icon)
            .as_os_str()
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        if icon.len() > cchmax.max(0) as usize {
            return Err(E_FAIL.into());
        }
        // SAFETY: the buffer holds `cchmax` u16 (checked above); out-pointers are non-null.
        unsafe {
            std::ptr::copy_nonoverlapping(icon.as_ptr(), pwsziconfile.0, icon.len());
            *pindex = 0;
            *pdwflags = ISIOI_ICONFILE | ISIOI_ICONINDEX;
        }
        Ok(())
    }

    fn GetPriority(&self) -> windows::core::Result<i32> {
        Ok(0)
    }
}

#[implement(IClassFactory)]
struct Factory {
    handler: usize,
}

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(
        &self,
        punkouter: Ref<IUnknown>,
        riid: *const GUID,
        ppvobject: *mut *mut c_void,
    ) -> windows::core::Result<()> {
        if ppvobject.is_null() || riid.is_null() {
            return Err(E_POINTER.into());
        }
        // SAFETY: checked non-null above.
        unsafe { *ppvobject = std::ptr::null_mut() };
        if !punkouter.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let h = &HANDLERS[self.handler];
        let obj: IShellIconOverlayIdentifier = Overlay {
            level: h.level,
            icon: h.icon,
        }
        .into();
        // SAFETY: riid / ppvobject are valid per the COM contract.
        unsafe { obj.query(riid, ppvobject).ok() }
    }

    fn LockServer(&self, _flock: BOOL) -> windows::core::Result<()> {
        Ok(())
    }
}

/// Create the overlay object for `clsid` (used by DllGetClassObject and the tests).
pub fn overlay_for(clsid: &GUID) -> Option<IShellIconOverlayIdentifier> {
    let h = HANDLERS.iter().find(|h| h.clsid == *clsid)?;
    Some(
        Overlay {
            level: h.level,
            icon: h.icon,
        }
        .into(),
    )
}

// ---- DLL exports --------------------------------------------------------------------------------------

/// # Safety
/// Called by the loader.
#[unsafe(no_mangle)]
pub unsafe extern "system" fn DllMain(
    hinst: HINSTANCE,
    reason: u32,
    _reserved: *mut c_void,
) -> BOOL {
    if reason == DLL_PROCESS_ATTACH {
        MODULE.store(hinst.0 as isize, Ordering::Relaxed);
    }
    BOOL(1)
}

/// # Safety
/// COM contract: valid pointers from the caller.
#[unsafe(no_mangle)]
pub unsafe extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut c_void,
) -> HRESULT {
    if rclsid.is_null() || riid.is_null() || ppv.is_null() {
        return E_POINTER;
    }
    // SAFETY: checked non-null above.
    unsafe {
        *ppv = std::ptr::null_mut();
        let Some(i) = HANDLERS.iter().position(|h| h.clsid == *rclsid) else {
            return CLASS_E_CLASSNOTAVAILABLE;
        };
        let factory: IClassFactory = Factory { handler: i }.into();
        factory.query(riid, ppv)
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    // Explorer keeps shell extensions loaded anyway; staying loaded is always safe.
    S_FALSE
}

fn set_value(root: HKEY, path: &str, name: Option<&str>, value: &str) -> bool {
    let mut key = HKEY::default();
    let data: Vec<u8> = value
        .encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(|c| c.to_le_bytes())
        .collect();
    // SAFETY: valid key handles and NUL-terminated strings (HSTRING) are passed; the key is closed.
    unsafe {
        if RegCreateKeyExW(
            root,
            &HSTRING::from(path),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &mut key,
            None,
        ) != ERROR_SUCCESS
        {
            return false;
        }
        let name = name.map(HSTRING::from);
        let ok = RegSetValueExW(
            key,
            name.as_ref()
                .map(|n| PCWSTR(n.as_ptr()))
                .unwrap_or(PCWSTR::null()),
            None,
            REG_SZ,
            Some(&data),
        ) == ERROR_SUCCESS;
        let _ = RegCloseKey(key);
        ok
    }
}

fn delete_tree(root: HKEY, path: &str) {
    // SAFETY: valid root key and NUL-terminated path.
    unsafe {
        let _ = RegDeleteTreeW(root, &HSTRING::from(path));
    }
}

fn notify_shell() {
    // SAFETY: SHCNE_ASSOCCHANGED takes no items.
    unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
}

const OVERLAYS_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\ShellIconOverlayIdentifiers";
const APPROVED_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved";

fn clsid_string(g: &GUID) -> String {
    format!("{{{g:?}}}")
}

/// `regsvr32 gitstudio_overlay.dll` (as administrator).
#[unsafe(no_mangle)]
pub extern "system" fn DllRegisterServer() -> HRESULT {
    let Some(dll) = module_path() else {
        return E_FAIL;
    };
    let dll = dll.display().to_string();
    for h in &HANDLERS {
        let id = clsid_string(&h.clsid);
        let class = format!(r"Software\Classes\CLSID\{id}");
        let desc = format!("GitStudio overlay ({:?})", h.level);
        let ok = set_value(HKEY_LOCAL_MACHINE, &class, None, &desc)
            && set_value(
                HKEY_LOCAL_MACHINE,
                &format!(r"{class}\InprocServer32"),
                None,
                &dll,
            )
            && set_value(
                HKEY_LOCAL_MACHINE,
                &format!(r"{class}\InprocServer32"),
                Some("ThreadingModel"),
                "Apartment",
            )
            && set_value(
                HKEY_LOCAL_MACHINE,
                &format!(r"{OVERLAYS_KEY}\{}", h.name),
                None,
                &id,
            )
            && set_value(HKEY_LOCAL_MACHINE, APPROVED_KEY, Some(&id), &desc);
        if !ok {
            return E_FAIL;
        }
    }
    notify_shell();
    S_OK
}

/// `regsvr32 /u gitstudio_overlay.dll` (as administrator).
#[unsafe(no_mangle)]
pub extern "system" fn DllUnregisterServer() -> HRESULT {
    for h in &HANDLERS {
        let id = clsid_string(&h.clsid);
        delete_tree(HKEY_LOCAL_MACHINE, &format!(r"{OVERLAYS_KEY}\{}", h.name));
        delete_tree(HKEY_LOCAL_MACHINE, &format!(r"Software\Classes\CLSID\{id}"));
    }
    notify_shell();
    S_OK
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_status(dir: &std::path::Path, repos: &[(&str, &str)], updated: i64) -> PathBuf {
        let file = dir.join("overlay-status.json");
        let map: serde_json::Map<String, serde_json::Value> = repos
            .iter()
            .map(|(k, v)| (key(k), serde_json::Value::from(*v)))
            .collect();
        let body = serde_json::json!({ "version": 1, "updated": updated, "pid": 1, "repos": map });
        std::fs::write(&file, serde_json::to_vec(&body).unwrap()).unwrap();
        file
    }

    fn member(o: &IShellIconOverlayIdentifier, path: &str, attrib: u32) -> HRESULT {
        let w = HSTRING::from(path);
        // The raw vtable call: the generated wrapper would turn S_FALSE (a success code) into Ok.
        // SAFETY: valid interface pointer and NUL-terminated string for the duration of the call.
        unsafe {
            (Interface::vtable(o).IsMemberOf)(Interface::as_raw(o), PCWSTR(w.as_ptr()), attrib)
        }
    }

    #[test]
    fn overlays_answer_from_the_status_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = write_status(
            dir.path(),
            &[
                (r"H:\Work\Clean", "clean"),
                (r"H:\Work\Dirty", "changed"),
                (r"H:\Work\Bad", "danger"),
            ],
            now_ms(),
        );
        // SAFETY: tests run single-threaded for this env var (only this test sets it).
        unsafe { std::env::set_var("GITSTUDIO_OVERLAY_STATUS", &file) };

        let clean = overlay_for(&CLSID_CLEAN).unwrap();
        let changed = overlay_for(&CLSID_CHANGED).unwrap();
        let danger = overlay_for(&CLSID_DANGER).unwrap();
        const DIR: u32 = 0x10;
        assert_eq!(member(&clean, r"h:\work\clean", DIR), S_OK);
        assert_eq!(member(&clean, r"H:\Work\Clean\", DIR), S_OK);
        assert_eq!(member(&changed, r"H:\Work\Clean", DIR), S_FALSE);
        assert_eq!(member(&changed, r"H:\Work\Dirty", DIR), S_OK);
        assert_eq!(member(&danger, r"H:\Work\Bad", DIR), S_OK);
        assert_eq!(member(&clean, r"H:\Work\Other", DIR), S_FALSE);
        // Files never get a badge.
        assert_eq!(member(&clean, r"H:\Work\Clean", 0x20), S_FALSE);

        // The icon path and flags.
        let mut buf = [0u16; 512];
        let mut index = -1;
        let mut flags = 0u32;
        // SAFETY: valid buffers.
        unsafe { danger.GetOverlayInfo(&mut buf, &mut index, &mut flags) }.unwrap();
        let s = String::from_utf16_lossy(&buf[..buf.iter().position(|&c| c == 0).unwrap()]);
        assert!(s.ends_with("overlay-danger.ico"), "{s}");
        assert_eq!(index, 0);
        assert_eq!(flags, ISIOI_ICONFILE | ISIOI_ICONINDEX);

        // A stale file (no GitStudio refreshing it) shows nothing.
        std::thread::sleep(RECHECK + Duration::from_millis(50));
        write_status(
            dir.path(),
            &[(r"H:\Work\Clean", "clean")],
            now_ms() - 3_600_000,
        );
        std::thread::sleep(RECHECK + Duration::from_millis(50));
        assert_eq!(member(&clean, r"H:\Work\Clean", DIR), S_FALSE);
    }

    #[test]
    fn class_factory_hands_out_overlays() {
        let mut ppv: *mut c_void = std::ptr::null_mut();
        // SAFETY: valid pointers.
        let hr = unsafe { DllGetClassObject(&CLSID_CHANGED, &IClassFactory::IID, &mut ppv) };
        assert_eq!(hr, S_OK);
        // SAFETY: DllGetClassObject returned an owned IClassFactory pointer.
        let factory = unsafe { IClassFactory::from_raw(ppv) };
        // SAFETY: COM call with no aggregation.
        let o: IShellIconOverlayIdentifier = unsafe { factory.CreateInstance(None) }.unwrap();
        // SAFETY: COM call.
        assert_eq!(unsafe { o.GetPriority() }.unwrap(), 0);
        let mut ppv: *mut c_void = std::ptr::null_mut();
        let bogus = GUID::from_u128(1);
        // SAFETY: valid pointers.
        let hr = unsafe { DllGetClassObject(&bogus, &IClassFactory::IID, &mut ppv) };
        assert_eq!(hr, CLASS_E_CLASSNOTAVAILABLE);
    }
}
