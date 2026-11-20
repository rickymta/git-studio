"""GitStudio for Nautilus, Nemo and Caja (python extensions).

Installed by GitStudio (Preferences -> File manager icons) into
~/.local/share/{nautilus,nemo,caja}-python/extensions/. It never runs git: it reads
overlay-status.json, which GitStudio keeps fresh, and
- puts the gitstudio-clean / gitstudio-changed / gitstudio-danger emblem on repository folders;
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
# Ignore a file nobody refreshed for this long (GitStudio and its agent are not running).
STALE_MS = 10 * 60 * 1000
POLL_SECONDS = 3


def _now_ms():
    return int(GLib.get_real_time() / 1000)


def _path(item):
    """Local path of a file-manager item, or None."""
    if item is None or item.get_uri_scheme() != "file":
        return None
    return unquote(item.get_uri()[len("file://") :]).rstrip("/") or "/"


class _Status:
    def __init__(self):
        self.mtime = None
        self.updated = 0
        self.repos = {}
        self.exe = None

    def reload(self):
        """Re-read the file if it changed; return the paths whose level changed."""
        try:
            mtime = os.stat(STATUS).st_mtime
        except OSError:
            mtime = None
        if mtime == self.mtime:
            return set()
        self.mtime = mtime
        old = self.repos
        try:
            with open(STATUS, encoding="utf-8") as f:
                data = json.load(f)
            self.updated = int(data.get("updated", 0))
            self.repos = {k: v for k, v in data.get("repos", {}).items() if isinstance(v, str)}
            self.exe = data.get("exe") or self.exe
        except (OSError, ValueError):
            # Keep what was known; GitStudio rewrites the file every few seconds.
            return set()
        return {p for p in set(old) | set(self.repos) if old.get(p) != self.repos.get(p)}

    def level(self, path):
        if _now_ms() - self.updated > STALE_MS:
            return None
        return self.repos.get(path)


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
            # Folders the file manager asked about, so they can be refreshed when levels change.
            self.seen = {}
            GLib.timeout_add_seconds(POLL_SECONDS, self._poll)

        def _poll(self):
            for path in self.status.reload():
                item = self.seen.get(path)
                if item is not None:
                    item.invalidate_extension_info()
            return True

        # ---- emblems ---------------------------------------------------------------------

        def update_file_info(self, item):
            path = _path(item)
            if path is None or not item.is_directory():
                return
            self.seen[path] = item
            level = self.status.level(path)
            if level in ("clean", "changed", "danger"):
                item.add_emblem("gitstudio-" + level)

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
