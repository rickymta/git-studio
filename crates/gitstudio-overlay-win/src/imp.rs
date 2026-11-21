use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
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
    SHCNE_ASSOCCHANGED, SHCNE_UPDATEDIR, SHCNF_IDLIST, SHCNF_PATHW, SHChangeNotify,
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
//
// Explorer calls `IsMemberOf` on its UI thread for every icon it draws, so a lookup must never
// touch the disk, sleep, or wait on anything slow. Lookups only read `SNAPSHOT`, an immutable
// picture of the status files swapped in whole; a background thread (started on the first
// lookup, never from DllMain) keeps it current. What a lookup cannot answer yet it notes, and
// once the loader has the data it asks Explorer to redraw just those folders.

/// A status file nobody refreshed for this long is ignored (GitStudio and its agent are gone).
const STALE: Duration = Duration::from_secs(10 * 60);
/// How often the loader re-checks the files' modification times.
const RECHECK: Duration = Duration::from_millis(700);
/// The status file is read again at least this often even when it looks unchanged.
const STATUS_REREAD: Duration = Duration::from_secs(5);
/// Same for the detail files of the repositories Explorer showed.
const DETAIL_REREAD: Duration = Duration::from_secs(30);
/// At most this many folders are asked to redraw after one load.
const MAX_REDRAW: usize = 64;

#[derive(Deserialize)]
struct StatusFile {
    updated: i64,
    repos: HashMap<String, String>,
    /// Repository key → id of its detail files in `overlay/`.
    #[serde(default)]
    details: HashMap<String, String>,
}

/// `overlay/<id>.json`, as written by gitstudio_core::overlay.
#[derive(Deserialize)]
struct DetailFile {
    dirty: HashMap<String, String>,
}

/// What is inside one repository, with paths relative to its root in Explorer's form
/// (lower case, `\`).
#[derive(Default, Clone)]
struct RepoView {
    dirty: HashMap<String, Level>,
    /// Folders above changed / conflicted paths, with the most serious level below them.
    dirty_dirs: HashMap<String, Level>,
    tracked: HashSet<String>,
    tracked_dirs: HashSet<String>,
}

/// What lookups answer from.
#[derive(Default)]
struct Snapshot {
    updated_ms: i64,
    repos: HashMap<String, Level>,
    /// Repository root key → id of its detail files.
    details: HashMap<String, String>,
    /// Detail id → what is inside that repository (only the ones Explorer asked about).
    views: HashMap<String, Arc<RepoView>>,
}

static SNAPSHOT: RwLock<Option<Arc<Snapshot>>> = RwLock::new(None);

/// Asked for by lookups, picked up by the loader: detail ids to load, and the folders Explorer
/// showed without an answer (to redraw once the data is there).
#[derive(Default)]
struct Wanted {
    ids: HashSet<String>,
    dirs: HashSet<String>,
}

static WANTED: Mutex<Option<Wanted>> = Mutex::new(None);

fn worse(a: Level, b: Level) -> Level {
    let rank = |l: Level| match l {
        Level::Clean => 0,
        Level::Changed => 1,
        Level::Danger => 2,
    };
    if rank(b) > rank(a) { b } else { a }
}

/// Every parent folder of `rel` (`a\b\c.txt` → `a`, `a\b`).
fn parents(rel: &str) -> impl Iterator<Item = &str> {
    rel.match_indices('\\').map(move |(i, _)| &rel[..i])
}

fn rel_key(p: &str) -> String {
    p.replace('/', "\\").to_lowercase()
}

/// What tells a file changed: its modification time and size. Two writes can share one
/// timestamp (coarse file-system clocks), so the size is compared as well, and files are read
/// again after a while regardless (see `STATUS_REREAD` / `DETAIL_REREAD`).
type Stamp = (SystemTime, u64);

fn stamp(p: &std::path::Path) -> Option<Stamp> {
    std::fs::metadata(p)
        .ok()
        .and_then(|m| m.modified().ok().map(|t| (t, m.len())))
}

impl RepoView {
    fn set_dirty(&mut self, d: DetailFile) {
        self.dirty.clear();
        self.dirty_dirs.clear();
        for (path, level) in d.dirty {
            let Some(level) = Level::parse(&level) else {
                continue;
            };
            let k = rel_key(&path);
            for dir in parents(&k) {
                let e = self.dirty_dirs.entry(dir.to_string()).or_insert(level);
                *e = worse(*e, level);
            }
            self.dirty.insert(k, level);
        }
    }

    fn set_tracked(&mut self, text: &str) {
        self.tracked.clear();
        self.tracked_dirs.clear();
        for line in text.lines().filter(|l| !l.is_empty()) {
            let k = rel_key(line);
            for dir in parents(&k) {
                if !self.tracked_dirs.contains(dir) {
                    self.tracked_dirs.insert(dir.to_string());
                }
            }
            self.tracked.insert(k);
        }
    }

    /// Changed / conflicted first, then tracked = clean; ignored or untracked = no badge.
    fn level(&self, rel: &str) -> Option<Level> {
        if let Some(l) = self.dirty.get(rel).or_else(|| self.dirty_dirs.get(rel)) {
            return Some(*l);
        }
        (self.tracked.contains(rel) || self.tracked_dirs.contains(rel)).then_some(Level::Clean)
    }
}

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

/// Troubleshooting: with `overlay-debug.flag` next to the DLL when Explorer loads it, every
/// call is appended to `overlay-debug.log` there. Checked once, not on every icon.
fn debug_log(msg: &str) {
    static LOG: OnceLock<Option<PathBuf>> = OnceLock::new();
    let log = LOG.get_or_init(|| {
        let dir = module_path()?.parent()?.to_path_buf();
        dir.join("overlay-debug.flag")
            .exists()
            .then(|| dir.join("overlay-debug.log"))
    });
    let Some(log) = log else {
        return;
    };
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
    {
        let _ = writeln!(f, "{} pid={} {msg}", now_ms(), std::process::id());
    }
}

// ---- loader (background thread) ---------------------------------------------------------------------

/// The loader's own bookkeeping: what each file looked like when it was read, so unchanged
/// files are not read again (until their re-read interval).
#[derive(Default)]
struct LoaderState {
    status: Option<Stamp>,
    status_read: Option<Instant>,
    /// Detail id → (json stamp, files stamp, when they were read).
    seen: HashMap<String, (Option<Stamp>, Option<Stamp>, Instant)>,
}

static LOADER: Mutex<Option<LoaderState>> = Mutex::new(None);

/// Start the loader thread once (on the first lookup: DllMain must not create threads).
fn ensure_loader() {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        let spawned = std::thread::Builder::new()
            .name("gitstudio-overlay".into())
            .spawn(|| {
                loop {
                    load_now();
                    std::thread::sleep(RECHECK);
                }
            });
        if let Err(e) = spawned {
            debug_log(&format!("loader thread failed: {e}"));
        }
    });
}

/// One loader pass: re-read what changed, publish a new snapshot, redraw folders that waited.
/// A panic is contained here, so the thread keeps running and Explorer is never affected.
pub fn load_now() {
    let result = std::panic::catch_unwind(|| {
        let mut guard = LOADER.lock().unwrap_or_else(|p| p.into_inner());
        load_pass(guard.get_or_insert_with(LoaderState::default))
    });
    match result {
        Ok(redraw) => redraw_folders(redraw),
        Err(_) => debug_log("loader pass panicked"),
    }
}

fn load_pass(state: &mut LoaderState) -> Vec<String> {
    let Some(file) = status_path() else {
        return Vec::new();
    };
    let old = current();
    let (ids_wanted, dirs_waiting) = {
        let mut w = WANTED.lock().unwrap_or_else(|p| p.into_inner());
        let w = w.get_or_insert_with(Wanted::default);
        (std::mem::take(&mut w.ids), std::mem::take(&mut w.dirs))
    };
    let mut changed = false;

    // The status file: on a read or parse error keep what was known and retry next pass,
    // since caching "nothing" would drop every badge.
    let mut next = Snapshot {
        updated_ms: old.as_ref().map(|s| s.updated_ms).unwrap_or(0),
        repos: old.as_ref().map(|s| s.repos.clone()).unwrap_or_default(),
        details: old.as_ref().map(|s| s.details.clone()).unwrap_or_default(),
        views: old.as_ref().map(|s| s.views.clone()).unwrap_or_default(),
    };
    let m = stamp(&file);
    let due = state
        .status_read
        .is_none_or(|t| t.elapsed() >= STATUS_REREAD);
    if old.is_none() || m != state.status || due {
        match std::fs::read(&file)
            .ok()
            .and_then(|b| serde_json::from_slice::<StatusFile>(&b).ok())
        {
            Some(f) => {
                state.status = m;
                state.status_read = Some(Instant::now());
                next.updated_ms = f.updated;
                next.repos = f
                    .repos
                    .into_iter()
                    .filter_map(|(k, v)| Level::parse(&v).map(|l| (k, l)))
                    .collect();
                next.details = f.details;
                changed = true;
            }
            None => debug_log(&format!("cannot read {}", file.display())),
        }
    }

    // Detail files: the ones already loaded (kept fresh) and the ones lookups asked for.
    let dir = file.parent().map(|p| p.join("overlay"));
    let known: HashSet<&String> = next.details.values().collect();
    next.views.retain(|id, _| known.contains(id));
    state.seen.retain(|id, _| known.contains(id));
    let ids: Vec<String> = next
        .views
        .keys()
        .cloned()
        .chain(ids_wanted.into_iter().filter(|id| known.contains(id)))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if let Some(dir) = dir {
        for id in ids {
            let json = dir.join(format!("{id}.json"));
            let files = dir.join(format!("{id}.files"));
            let (jm, fm) = (stamp(&json), stamp(&files));
            let (sj, sf, read) = match state.seen.get(&id) {
                Some(&(j, f, t)) => (j, f, Some(t)),
                None => (None, None, None),
            };
            let due = read.is_none_or(|t| t.elapsed() >= DETAIL_REREAD);
            let fresh = next.views.contains_key(&id) && !due;
            if fresh && jm == sj && fm == sf {
                continue;
            }
            let mut view = next
                .views
                .get(&id)
                .map(|v| (**v).clone())
                .unwrap_or_default();
            let mut seen = (sj, sf);
            if !fresh || jm != sj {
                if let Some(d) = std::fs::read(&json)
                    .ok()
                    .and_then(|b| serde_json::from_slice::<DetailFile>(&b).ok())
                {
                    view.set_dirty(d);
                    seen.0 = jm;
                }
            }
            if !fresh || fm != sf {
                if let Ok(text) = std::fs::read_to_string(&files) {
                    view.set_tracked(&text);
                    seen.1 = fm;
                }
            }
            state
                .seen
                .insert(id.clone(), (seen.0, seen.1, Instant::now()));
            next.views.insert(id, Arc::new(view));
            changed = true;
        }
    }

    if changed {
        *SNAPSHOT.write().unwrap_or_else(|p| p.into_inner()) = Some(Arc::new(next));
    }
    // Folders Explorer drew without an answer: redraw them now the data is in.
    dirs_waiting.into_iter().take(MAX_REDRAW).collect()
}

/// Ask Explorer to redraw these folders (it then asks for their badges again).
fn redraw_folders(dirs: Vec<String>) {
    for d in dirs {
        let w: Vec<u16> = d.encode_utf16().chain(std::iter::once(0)).collect();
        // SAFETY: SHCNF_PATHW takes a NUL-terminated wide path, alive for the call.
        unsafe {
            SHChangeNotify(
                SHCNE_UPDATEDIR,
                SHCNF_PATHW,
                Some(w.as_ptr() as *const c_void),
                None,
            )
        };
    }
}

// ---- lookups (Explorer's threads) ---------------------------------------------------------------------

fn current() -> Option<Arc<Snapshot>> {
    SNAPSHOT.read().unwrap_or_else(|p| p.into_inner()).clone()
}

/// Note what a lookup could not answer yet: the folder to redraw, and the detail id to load.
fn want(path_key: &str, id: Option<&str>) {
    let mut w = WANTED.lock().unwrap_or_else(|p| p.into_inner());
    let w = w.get_or_insert_with(Wanted::default);
    if let Some((dir, _)) = path_key.rsplit_once('\\') {
        if w.dirs.len() < MAX_REDRAW * 4 {
            w.dirs.insert(dir.to_string());
        }
    }
    if let Some(id) = id {
        w.ids.insert(id.to_string());
    }
}

/// Level of the repository at `path`, if GitStudio knows it.
pub fn level_of(path: &str) -> Option<Level> {
    let level = level_of_inner(path);
    debug_log(&format!("lookup {path:?} key={:?} -> {level:?}", key(path)));
    level
}

fn level_of_inner(path: &str) -> Option<Level> {
    ensure_loader();
    let k = key(path);
    let Some(c) = current() else {
        // Nothing loaded yet (Explorer just started): answer later.
        want(&k, None);
        return None;
    };
    if now_ms() - c.updated_ms > STALE.as_millis() as i64 {
        return None;
    }
    if let Some(level) = c.repos.get(&k) {
        return Some(*level);
    }
    // Inside a repository: the deepest one containing the path (nested repositories win).
    let (root, id) = c
        .details
        .iter()
        .filter(|(root, _)| {
            k.len() > root.len()
                && k.starts_with(root.as_str())
                && (root.ends_with('\\') || k.as_bytes()[root.len()] == b'\\')
        })
        .max_by_key(|(root, _)| root.len())?;
    let rel = k[root.len()..].trim_start_matches('\\');
    if rel == ".git" || rel.starts_with(".git\\") {
        return None;
    }
    match c.views.get(id) {
        Some(view) => view.level(rel),
        None => {
            want(&k, Some(id));
            None
        }
    }
}

/// Run `f`, turning a panic into `fallback`: a panic unwinding into Explorer would end the
/// whole process (taskbar, desktop and every window with it).
fn shielded<T>(fallback: T, f: impl FnOnce() -> T) -> T {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or_else(|_| {
        debug_log("panic contained");
        fallback
    })
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
        // `dwattrib` holds SFGAO_* flags (IShellFolder::GetAttributesOf), and Explorer often passes
        // only some of them, so it is not a reliable folder test: files simply never match a
        // repository path in the map, which is a cheap lookup.
        if pwszpath.is_null() {
            return Err(S_FALSE.into());
        }
        // SAFETY: Explorer passes a valid NUL-terminated wide string.
        let path =
            unsafe { pwszpath.to_string() }.map_err(|_| windows::core::Error::from(S_FALSE))?;
        shielded(Err(S_FALSE.into()), || {
            debug_log(&format!(
                "IsMemberOf {:?} attrib={dwattrib:#x} {path:?}",
                self.level
            ));
            if level_of(&path) == Some(self.level) {
                Ok(())
            } else {
                Err(S_FALSE.into())
            }
        })
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
        shielded(Err(E_FAIL.into()), || {
            self.overlay_info(pwsziconfile, cchmax, pindex, pdwflags)
        })
    }

    fn GetPriority(&self) -> windows::core::Result<i32> {
        Ok(0)
    }
}

impl Overlay {
    fn overlay_info(
        &self,
        pwsziconfile: PWSTR,
        cchmax: i32,
        pindex: *mut i32,
        pdwflags: *mut u32,
    ) -> windows::core::Result<()> {
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
        debug_log(&format!(
            "GetOverlayInfo {:?} -> {}",
            self.level,
            String::from_utf16_lossy(&icon[..icon.len() - 1])
        ));
        Ok(())
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
        shielded(Err(E_FAIL.into()), || {
            let h = &HANDLERS[self.handler];
            let obj: IShellIconOverlayIdentifier = Overlay {
                level: h.level,
                icon: h.icon,
            }
            .into();
            // SAFETY: riid / ppvobject are valid per the COM contract.
            unsafe { obj.query(riid, ppvobject).ok() }
        })
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
        // Nothing else here: DllMain runs under the loader lock, where file access or
        // starting threads can deadlock the host process.
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
    unsafe { *ppv = std::ptr::null_mut() };
    shielded(E_FAIL, || {
        // SAFETY: checked non-null above.
        unsafe {
            let Some(i) = HANDLERS.iter().position(|h| h.clsid == *rclsid) else {
                return CLASS_E_CLASSNOTAVAILABLE;
            };
            let factory: IClassFactory = Factory { handler: i }.into();
            let hr = factory.query(riid, ppv);
            debug_log(&format!(
                "DllGetClassObject {:?} riid={:?} -> {hr:?}",
                HANDLERS[i].level, *riid
            ));
            hr
        }
    })
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
        load_now();

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
        // Anything inside a repository (files, sub-folders) gets no badge.
        assert_eq!(member(&clean, r"H:\Work\Clean\src", 0x2000_0000), S_FALSE);
        assert_eq!(member(&clean, r"H:\Work\Clean\README.md", 0), S_FALSE);

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

        // Inside a repository: tracked files and folders, changed and conflicted ones.
        let id = "0123456789abcdef";
        let details = dir.path().join("overlay");
        std::fs::create_dir_all(&details).unwrap();
        std::fs::write(
            details.join(format!("{id}.files")),
            "README.md\nsrc/main.rs\nsrc/ui/App.tsx\ndocs/guide.md\n",
        )
        .unwrap();
        std::fs::write(
            details.join(format!("{id}.json")),
            r#"{"root":"x","dirty":{"src/ui/App.tsx":"changed","docs/guide.md":"danger"},"indexMtime":1}"#,
        )
        .unwrap();
        let mut repos = serde_json::Map::new();
        repos.insert(key(r"H:\Work\Dirty"), "changed".into());
        let mut ids = serde_json::Map::new();
        ids.insert(key(r"H:\Work\Dirty"), id.into());
        let body = serde_json::json!({
            "version": 1, "updated": now_ms(), "pid": 1, "repos": repos, "details": ids
        });
        // Rewritten within the same file-system clock tick as before (CI machines have coarse
        // timestamps): the size still tells it changed.
        let before = std::fs::metadata(&file).unwrap().modified().unwrap();
        std::fs::write(&file, serde_json::to_vec(&body).unwrap()).unwrap();
        std::fs::File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(before)
            .unwrap();
        load_now();
        let r = r"H:\Work\Dirty";
        // The first lookup inside the repository has no answer yet: it asks the loader for the
        // repository's file list (and never reads it on Explorer's thread).
        assert_eq!(member(&clean, &format!(r"{r}\README.md"), 0), S_FALSE);
        load_now();
        assert_eq!(member(&clean, &format!(r"{r}\README.md"), 0), S_OK);
        assert_eq!(member(&clean, &format!(r"{r}\src\main.rs"), 0), S_OK);
        assert_eq!(member(&changed, &format!(r"{r}\src\ui\App.tsx"), 0), S_OK);
        assert_eq!(member(&changed, &format!(r"{r}\SRC\UI"), DIR), S_OK);
        assert_eq!(member(&changed, &format!(r"{r}\src"), DIR), S_OK);
        assert_eq!(member(&clean, &format!(r"{r}\src"), DIR), S_FALSE);
        assert_eq!(member(&danger, &format!(r"{r}\docs"), DIR), S_OK);
        assert_eq!(member(&danger, &format!(r"{r}\docs\guide.md"), 0), S_OK);
        // Untracked / ignored files and the .git folder get no badge at all.
        for p in [r"\node_modules", r"\notes.txt", r"\.git", r"\src\new.rs"] {
            for o in [&clean, &changed, &danger] {
                assert_eq!(member(o, &format!("{r}{p}"), 0), S_FALSE, "{p}");
            }
        }

        // A stale file (no GitStudio refreshing it) shows nothing.
        std::thread::sleep(Duration::from_millis(20));
        write_status(
            dir.path(),
            &[(r"H:\Work\Clean", "clean")],
            now_ms() - 3_600_000,
        );
        load_now();
        assert_eq!(member(&clean, r"H:\Work\Clean", DIR), S_FALSE);

        // A file that cannot be parsed keeps the last good picture instead of dropping badges.
        std::thread::sleep(Duration::from_millis(20));
        write_status(dir.path(), &[(r"H:\Work\Clean", "clean")], now_ms());
        load_now();
        std::thread::sleep(Duration::from_millis(20));
        std::fs::write(&file, b"{ half written").unwrap();
        load_now();
        assert_eq!(member(&clean, r"H:\Work\Clean", DIR), S_OK);
    }

    #[test]
    fn panics_never_reach_explorer() {
        assert_eq!(shielded(7, || panic!("boom")), 7);
        assert_eq!(shielded(7, || 8), 8);
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
