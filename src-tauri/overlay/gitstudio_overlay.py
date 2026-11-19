"""GitStudio status emblems for Nautilus, Nemo and Caja (python extensions).

Installed by GitStudio (Preferences -> Integrations -> File manager icons) into
~/.local/share/{nautilus,nemo,caja}-python/extensions/. It never runs git: it reads
overlay-status.json, which GitStudio keeps fresh, and puts the gitstudio-clean /
gitstudio-changed / gitstudio-danger emblem on repository folders.
"""

import json
import os
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


class _Status:
    def __init__(self):
        self.mtime = None
        self.updated = 0
        self.repos = {}

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
        except (OSError, ValueError):
            self.updated, self.repos = 0, {}
        return {p for p in set(old) | set(self.repos) if old.get(p) != self.repos.get(p)}

    def level(self, path):
        if _now_ms() - self.updated > STALE_MS:
            return None
        return self.repos.get(path)


if FM is not None:

    class GitStudioOverlay(GObject.GObject, FM.InfoProvider):
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

        def update_file_info(self, item):
            if item.get_uri_scheme() != "file" or not item.is_directory():
                return
            path = unquote(item.get_uri()[len("file://") :]).rstrip("/") or "/"
            self.seen[path] = item
            level = self.status.level(path)
            if level in ("clean", "changed", "danger"):
                item.add_emblem("gitstudio-" + level)
