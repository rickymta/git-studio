// GitStudio Finder Sync extension: git status badges on repository folders in Finder
// (green: clean, orange: changes or commits to push / pull, red: conflicts / unfinished
// merge or rebase / upstream gone).
//
// Finder extensions are sandboxed, so this never runs git. It reads overlay-status.json,
// which GitStudio (or its login agent, `GitStudio --overlay-serve`) keeps fresh in
// ~/Library/Application Support/GitStudio/. The entitlements grant read access to just that
// folder.

import Cocoa
import FinderSync

final class FinderSync: FIFinderSync {
    private let badges: [(id: String, label: String)] = [
        ("clean", "Git: clean"),
        ("changed", "Git: changes"),
        ("danger", "Git: needs attention"),
    ]
    /// Ignore a file nobody refreshed for this long (GitStudio and its agent are not running).
    private let staleMs: Double = 10 * 60 * 1000
    private var levels: [String: String] = [:]
    private var updated: Double = 0
    private var modified: Date?
    private var timer: Timer?

    /// The real home folder (inside the sandbox, NSHomeDirectory() is the container).
    private var statusURL: URL {
        let home: String
        if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
            home = String(cString: dir)
        } else {
            home = NSHomeDirectory()
        }
        return URL(fileURLWithPath: home)
            .appendingPathComponent("Library/Application Support/GitStudio/overlay-status.json")
    }

    override init() {
        super.init()
        let controller = FIFinderSyncController.default()
        for badge in badges {
            if let url = Bundle.main.url(forResource: "overlay-\(badge.id)", withExtension: "png"),
                let image = NSImage(contentsOf: url)
            {
                controller.setBadgeImage(image, label: badge.label, forBadgeIdentifier: badge.id)
            }
        }
        reload()
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            self?.reload()
        }
    }

    /// Finder compares paths case-insensitively; so does overlay-status.json on macOS.
    private func key(_ url: URL) -> String {
        var p = url.standardizedFileURL.path.lowercased()
        while p.count > 1 && p.hasSuffix("/") { p.removeLast() }
        return p
    }

    private func reload() {
        let attrs = try? FileManager.default.attributesOfItem(atPath: statusURL.path)
        let mtime = attrs?[.modificationDate] as? Date
        if mtime == modified { return }
        modified = mtime
        var next: [String: String] = [:]
        var stamp: Double = 0
        if let data = try? Data(contentsOf: statusURL),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        {
            stamp = (json["updated"] as? NSNumber)?.doubleValue ?? 0
            for (path, level) in (json["repos"] as? [String: Any]) ?? [:] {
                if let l = level as? String { next[path] = l }
            }
        }
        let old = levels
        levels = next
        updated = stamp

        let controller = FIFinderSyncController.default()
        // Finder only asks about folders inside directoryURLs: watch each repository's parent.
        var dirs = Set<URL>()
        for path in next.keys {
            let url = URL(fileURLWithPath: path, isDirectory: true)
            dirs.insert(url.deletingLastPathComponent())
            dirs.insert(url)
        }
        controller.directoryURLs = dirs
        for path in Set(old.keys).union(next.keys) where old[path] != next[path] {
            controller.setBadgeIdentifier(currentLevel(path) ?? "", for: URL(fileURLWithPath: path))
        }
    }

    private func currentLevel(_ key: String) -> String? {
        let now = Date().timeIntervalSince1970 * 1000
        if now - updated > staleMs { return nil }
        return levels[key]
    }

    override func requestBadgeIdentifier(for url: URL) {
        if let level = currentLevel(key(url)) {
            FIFinderSyncController.default().setBadgeIdentifier(level, for: url)
        }
    }
}
