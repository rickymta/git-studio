// GitStudio Finder Sync extension: git status badges in Finder, like TortoiseGit — on repository
// folders and on every tracked file and folder inside them (green: clean, orange: changes or
// commits to push / pull, red: conflicts / unfinished merge or rebase / upstream gone). Ignored
// and untracked files get no badge.
//
// Finder extensions are sandboxed, so this never runs git. It reads overlay-status.json and the
// per-repository files in overlay/, which GitStudio (or its login agent,
// `GitStudio --overlay-serve`) keeps fresh in ~/Library/Application Support/GitStudio/. The
// entitlements grant read access to just that folder.

import Cocoa
import FinderSync

private let rank: [String: Int] = ["clean": 0, "changed": 1, "danger": 2]

private func mtime(_ url: URL) -> Date? {
    (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
}

/// Every parent folder of `rel` ("a/b/c.txt" → "a", "a/b").
private func parents(_ rel: String) -> [String] {
    let parts = rel.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count > 1 else { return [] }
    return (1..<parts.count).map { parts[0..<$0].joined(separator: "/") }
}

/// What is inside one repository (overlay/<id>.json and overlay/<id>.files), lower-cased like
/// Finder's paths.
private final class RepoView {
    let json: URL
    let files: URL
    var jsonMtime: Date?
    var filesMtime: Date?
    var dirty: [String: String] = [:]
    var dirtyDirs: [String: String] = [:]
    var tracked = Set<String>()
    var trackedDirs = Set<String>()

    init(dir: URL, id: String) {
        json = dir.appendingPathComponent("\(id).json")
        files = dir.appendingPathComponent("\(id).files")
    }

    /// Re-read what changed; true when anything did.
    func reload() -> Bool {
        var changed = false
        let jm = mtime(json)
        if jm != jsonMtime, let data = try? Data(contentsOf: json),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        {
            jsonMtime = jm
            dirty = [:]
            dirtyDirs = [:]
            for (path, value) in (obj["dirty"] as? [String: Any]) ?? [:] {
                guard let level = value as? String, let r = rank[level] else { continue }
                let p = path.lowercased()
                dirty[p] = level
                for d in parents(p) where r > (dirtyDirs[d].flatMap { rank[$0] } ?? -1) {
                    dirtyDirs[d] = level
                }
            }
            changed = true
        }
        let fm = mtime(files)
        if fm != filesMtime, let text = try? String(contentsOf: files, encoding: .utf8) {
            filesMtime = fm
            let lines = text.lowercased().split(separator: "\n").map(String.init)
            tracked = Set(lines)
            trackedDirs = Set(lines.flatMap(parents))
            changed = true
        }
        return changed
    }

    /// Changed / conflicted first, then tracked = clean; untracked or ignored = nil.
    func level(_ rel: String) -> String? {
        if let l = dirty[rel] ?? dirtyDirs[rel] { return l }
        return tracked.contains(rel) || trackedDirs.contains(rel) ? "clean" : nil
    }
}

final class FinderSync: FIFinderSync {
    private let badges: [(id: String, label: String)] = [
        ("clean", "Git: clean"),
        ("changed", "Git: changes"),
        ("danger", "Git: needs attention"),
    ]
    /// Ignore a file nobody refreshed for this long (GitStudio and its agent are not running).
    private let staleMs: Double = 10 * 60 * 1000
    private var levels: [String: String] = [:]
    /// Repository key → id of its detail files.
    private var details: [String: String] = [:]
    private var views: [String: RepoView] = [:]
    /// Items Finder asked about inside repositories, to re-badge them when their status changes.
    private var seen: [String: URL] = [:]
    private var updated: Double = 0
    private var modified: Date?
    private var timer: Timer?

    /// The real home folder (inside the sandbox, NSHomeDirectory() is the container).
    private var supportDir: URL {
        let home: String
        if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
            home = String(cString: dir)
        } else {
            home = NSHomeDirectory()
        }
        return URL(fileURLWithPath: home).appendingPathComponent("Library/Application Support/GitStudio")
    }

    private var statusURL: URL { supportDir.appendingPathComponent("overlay-status.json") }

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
        // Everything: badges inside repositories and the context menu work in any folder.
        controller.directoryURLs = [URL(fileURLWithPath: "/")]
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
        var touched = Set<String>()
        let mt = mtime(statusURL)
        if mt != modified, let data = try? Data(contentsOf: statusURL),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        {
            modified = mt
            updated = (json["updated"] as? NSNumber)?.doubleValue ?? 0
            var next: [String: String] = [:]
            for (path, level) in (json["repos"] as? [String: Any]) ?? [:] {
                if let l = level as? String { next[path] = l }
            }
            var ids: [String: String] = [:]
            for (path, id) in (json["details"] as? [String: Any]) ?? [:] {
                if let i = id as? String { ids[path] = i }
            }
            for path in Set(levels.keys).union(next.keys) where levels[path] != next[path] {
                touched.insert(path)
            }
            levels = next
            details = ids
        }
        let dir = supportDir.appendingPathComponent("overlay")
        for (root, id) in details {
            let view = views[id] ?? RepoView(dir: dir, id: id)
            views[id] = view
            if view.reload() { touched.insert(root) }
        }
        guard !touched.isEmpty else { return }
        let controller = FIFinderSyncController.default()
        for root in touched {
            controller.setBadgeIdentifier(currentLevel(root) ?? "", for: URL(fileURLWithPath: root))
        }
        for (k, url) in seen where touched.contains(where: { k.hasPrefix($0 + "/") }) {
            controller.setBadgeIdentifier(currentLevel(k) ?? "", for: url)
        }
    }

    private func currentLevel(_ key: String) -> String? {
        let now = Date().timeIntervalSince1970 * 1000
        if now - updated > staleMs { return nil }
        if let l = levels[key] { return l }
        // Inside a repository: the deepest one containing the path.
        guard
            let root = details.keys.filter({ key.hasPrefix($0 + "/") }).max(by: { $0.count < $1.count }),
            let id = details[root], let view = views[id]
        else { return nil }
        let rel = String(key.dropFirst(root.count + 1))
        if rel == ".git" || rel.hasPrefix(".git/") { return nil }
        return view.level(rel)
    }

    // ---- context menu -------------------------------------------------------------------

    private var appIcon: NSImage? {
        Bundle.main.url(forResource: "gitstudio", withExtension: "png").flatMap(NSImage.init(contentsOf:))
    }

    override func menu(for menuKind: FIMenuKind) -> NSMenu? {
        guard menuKind == .contextualMenuForItems || menuKind == .contextualMenuForContainer else {
            return nil
        }
        let menu = NSMenu(title: "")
        let item = NSMenuItem(
            title: "Open with GitStudio", action: #selector(openWithGitStudio(_:)), keyEquivalent: "")
        item.image = appIcon
        menu.addItem(item)
        return menu
    }

    /// The folder right-clicked, or the folder whose empty space was right-clicked.
    private func targetFolder() -> URL? {
        let controller = FIFinderSyncController.default()
        if let selected = controller.selectedItemURLs(), selected.count == 1,
            (try? selected[0].resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        {
            return selected[0]
        }
        return controller.targetedURL()
    }

    private func launch(_ flag: String) {
        guard let folder = targetFolder(),
            let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "dev.gitstudio.desktop")
        else { return }
        let config = NSWorkspace.OpenConfiguration()
        config.arguments = [flag, folder.path]
        NSWorkspace.shared.openApplication(at: app, configuration: config, completionHandler: nil)
    }

    @objc func openWithGitStudio(_ sender: AnyObject?) { launch("--open") }

    override func requestBadgeIdentifier(for url: URL) {
        let k = key(url)
        if details.keys.contains(where: { k.hasPrefix($0 + "/") }) { seen[k] = url }
        if let level = currentLevel(k) {
            FIFinderSyncController.default().setBadgeIdentifier(level, for: url)
        }
    }
}
