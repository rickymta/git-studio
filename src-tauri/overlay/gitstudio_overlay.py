"""GitStudio for Nautilus, Nemo and Caja (python extensions).

Installed by GitStudio (Preferences -> File manager icons) into
~/.local/share/{nautilus,nemo,caja}-python/extensions/. It never runs git: it reads
overlay-status.json (and the per-repository files in overlay/), which GitStudio keeps fresh, and
- puts the gitstudio-clean / gitstudio-changed / gitstudio-danger emblem on repository folders and
  on every tracked file and folder inside them, like TortoiseGit (ignored and untracked files get
  no emblem);
- adds "Open with GitStudio" to the menu of a folder and of the empty space inside a folder.
"""

import json
import os
import subprocess
from urllib.parse import unquote

import gi

FM = None
for _name, _versions in (("Nautilus", ("4.0", "3.0")), ("Nemo", ("3.0",)), ("Caja", ("2.0",))):
    for _v in _versions:
        try:
            gi.require_version(_name, _v)
            FM = getattr(__import__("gi.repository", fromlist=[_name]), _name)
            break
        except (ValueError, ImportError, AttributeError):
            continue
    if FM is not None:
        break

from gi.repository import GLib, GObject  # noqa: E402

CONFIG = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
STATUS = os.path.join(CONFIG, "GitStudio", "overlay-status.json")
DETAILS = os.path.join(CONFIG, "GitStudio", "overlay")
# Ignore a file nobody refreshed for this long (GitStudio and its agent are not running).
STALE_MS = 10 * 60 * 1000
POLL_SECONDS = 3
RANK = {"clean": 0, "changed": 1, "danger": 2}


def _now_ms():
    return int(GLib.get_real_time() / 1000)


def _mtime(path):
    try:
        return os.stat(path).st_mtime
    except OSError:
        return None


def _path(item):
    """Local path of a file-manager item, or None."""
    if item is None or item.get_uri_scheme() != "file":
        return None
    return unquote(item.get_uri()[len("file://") :]).rstrip("/") or "/"


def _parents(rel):
    """Every parent folder of `rel` ("a/b/c.txt" -> "a", "a/b")."""
    parts = rel.split("/")
    return ["/".join(parts[:i]) for i in range(1, len(parts))]


class _RepoView:
    """What is inside one repository (overlay/<id>.json and overlay/<id>.files)."""

    def __init__(self, ident):
        self.json = os.path.join(DETAILS, ident + ".json")
        self.files = os.path.join(DETAILS, ident + ".files")
        self.json_mtime = self.files_mtime = None
        self.dirty, self.dirty_dirs = {}, {}
        self.tracked, self.tracked_dirs = set(), set()

    def reload(self):
        """Re-read what changed; True when anything did."""
        changed = False
        jm = _mtime(self.json)
        if jm != self.json_mtime:
            try:
                with open(self.json, encoding="utf-8") as f:
                    data = json.load(f)
                self.json_mtime = jm
                self.dirty, self.dirty_dirs = {}, {}
                for path, level in data.get("dirty", {}).items():
                    if level not in RANK:
                        continue
                    self.dirty[path] = level
                    for d in _parents(path):
                        if RANK[level] > RANK.get(self.dirty_dirs.get(d), -1):
                            self.dirty_dirs[d] = level
                changed = True
            except (OSError, ValueError):
                pass
        fm = _mtime(self.files)
        if fm != self.files_mtime:
            try:
                with open(self.files, encoding="utf-8", errors="replace") as f:
                    lines = [line for line in f.read().split("\n") if line]
                self.files_mtime = fm
                self.tracked = set(lines)
                self.tracked_dirs = {d for line in lines for d in _parents(line)}
                changed = True
            except OSError:
                pass
        return changed

    def level(self, rel):
        """Changed / conflicted first, then tracked = clean; untracked or ignored = None."""
        level = self.dirty.get(rel) or self.dirty_dirs.get(rel)
        if level:
            return level
        if rel in self.tracked or rel in self.tracked_dirs:
            return "clean"
        return None


class _Status:
    def __init__(self):
        self.mtime = None
        self.updated = 0
        self.repos = {}
        self.details = {}
        self.views = {}
        self.exe = None

    def reload(self):
        """Re-read what changed; return the paths (or repository roots) to refresh."""
        touched = set()
        mtime = _mtime(STATUS)
        if mtime != self.mtime:
            old = self.repos
            try:
                with open(STATUS, encoding="utf-8") as f:
                    data = json.load(f)
                self.mtime = mtime
                self.updated = int(data.get("updated", 0))
                self.repos = {
                    k: v for k, v in data.get("repos", {}).items() if isinstance(v, str)
                }
                self.details = {
                    k: v for k, v in data.get("details", {}).items() if isinstance(v, str)
                }
                self.exe = data.get("exe") or self.exe
                touched |= {p for p in set(old) | set(self.repos) if old.get(p) != self.repos.get(p)}
            except (OSError, ValueError):
                # Keep what was known; GitStudio rewrites the file every few seconds.
                pass
        for root, ident in self.details.items():
            view = self.views.setdefault(ident, _RepoView(ident))
            if view.reload():
                touched.add(root)
        return touched

    def level(self, path):
        if _now_ms() - self.updated > STALE_MS:
            return None
        if path in self.repos:
            return self.repos[path]
        # Inside a repository: the deepest one containing the path.
        best = None
        for root in self.details:
            if path.startswith(root + "/") and (best is None or len(root) > len(best)):
                best = root
        if best is None:
            return None
        rel = path[len(best) + 1 :]
        if rel == ".git" or rel.startswith(".git/"):
            return None
        view = self.views.get(self.details[best])
        return view.level(rel) if view else None


def _menu_item(name, label, tip):
    """A menu item with GitStudio's icon (Nautilus 43+ dropped icons on menu items)."""
    try:
        return FM.MenuItem(name=name, label=label, tip=tip, icon="gitstudio")
    except TypeError:
        return FM.MenuItem(name=name, label=label, tip=tip)


if FM is not None:

    class GitStudioOverlay(GObject.GObject, FM.InfoProvider, FM.MenuProvider):
        def __init__(self):
            super().__init__()
            self.status = _Status()
            self.status.reload()
            # Items the file manager asked about, so they can be refreshed when levels change.
            self.seen = {}
            GLib.timeout_add_seconds(POLL_SECONDS, self._poll)

        def _poll(self):
            touched = self.status.reload()
            if touched:
                for path, item in list(self.seen.items()):
                    if any(path == t or path.startswith(t + "/") for t in touched):
                        item.invalidate_extension_info()
            return True

        # ---- emblems ---------------------------------------------------------------------

        def update_file_info(self, item):
            path = _path(item)
            if path is None:
                return
            level = self.status.level(path)
            if level in RANK:
                self.seen[path] = item
                item.add_emblem("gitstudio-" + level)
            elif path in self.status.repos or any(path.startswith(r + "/") for r in self.status.details):
                # Remember it: it may become tracked or changed later.
                self.seen[path] = item

        # ---- context menu ----------------------------------------------------------------

        def _launch(self, args):
            self.status.reload()
            exe = self.status.exe
            if not exe:
                return
            try:
                subprocess.Popen([exe, *args], start_new_session=True)
            except OSError:
                pass

        def _items(self, path):
            if not self.status.exe:
                return []
            open_item = _menu_item(
                "GitStudio::open", "Open with GitStudio", "Open this folder in GitStudio"
            )
            open_item.connect("activate", lambda *_: self._launch(["--open", path]))
            return [open_item]

        # Nautilus 4: (files); Nautilus 3 / Nemo / Caja: (window, files).
        def get_file_items(self, *args):
            files = args[-1]
            if len(files) != 1 or not files[0].is_directory():
                return []
            path = _path(files[0])
            return self._items(path) if path else []

        def get_background_items(self, *args):
            path = _path(args[-1])
            return self._items(path) if path else []
