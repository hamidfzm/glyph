import Foundation

// The extension's platform-independent logic, checked without Quick Look:
//
//   node scripts/build-quicklook.mjs --check
//
// A failed check exits non-zero with the line that failed.
@main
enum SelfCheck {
    static func main() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("glyph-quicklook-check-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        try checkDocument(in: dir)
        try checkContainment(in: dir)
        try checkServedFiles(in: dir)
        checkPreviewURLs()
        print("quicklook self-check passed")
    }

    static func message(_ bytes: [UInt8], in dir: URL, cap: Int = 100) throws -> [String: Any] {
        let file = dir.appendingPathComponent("note.md")
        try Data(bytes).write(to: file)
        return hostMessage(for: file, baseUrl: "glyph-preview://document/", cap: cap)
    }

    static func checkDocument(in dir: URL) throws {
        let text = try message(Array("# Hi ✓".utf8), in: dir)
        expect(text["kind"] as? String == "document")
        expect(text["content"] as? String == "# Hi ✓")
        expect(text["baseUrl"] as? String == "glyph-preview://document/")

        expect(try message([0xEF, 0xBB, 0xBF] + Array("# Hi".utf8), in: dir)["content"] as? String == "# Hi")
        expect(try message([], in: dir)["content"] as? String == "")
        expect(try message([0x23, 0xFF, 0xFE], in: dir)["kind"] as? String == "unreadable")

        let atCap = try message(Array(repeating: 0x61, count: 100), in: dir)
        expect((atCap["content"] as? String)?.count == 100)
        expect(try message(Array(repeating: 0x61, count: 101), in: dir)["kind"] as? String == "tooLarge")
        let overCap = try message(Array(repeating: 0x61, count: 250), in: dir)
        expect(overCap["kind"] as? String == "tooLarge")
        expect(overCap["bytes"] as? Int == 250)

        let missing = hostMessage(for: dir.appendingPathComponent("gone.md"), baseUrl: "")
        expect(missing["kind"] as? String == "unreadable")
        expect(hostMessage(for: dir, baseUrl: "")["kind"] as? String == "unreadable")
    }

    static func checkContainment(in dir: URL) throws {
        let root = dir.appendingPathComponent("docs")
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("images"), withIntermediateDirectories: true)
        try Data().write(to: root.appendingPathComponent("images/shot.png"))
        try Data().write(to: dir.appendingPathComponent("secret.png"))
        try FileManager.default.createSymbolicLink(
            at: root.appendingPathComponent("link.png"),
            withDestinationURL: dir.appendingPathComponent("secret.png"))

        expect(containedFile("/images/shot.png", under: root)?.lastPathComponent == "shot.png")
        for path in ["/../secret.png", "/images/../../secret.png", "/./images/shot.png",
                     "//images/shot.png", "/", "", "images/shot.png", "/link.png"] {
            expect(containedFile(path, under: root) == nil, path)
        }
    }

    static func checkServedFiles(in dir: URL) throws {
        let page = dir.appendingPathComponent("web")
        let document = dir.appendingPathComponent("notes")
        let manager = FileManager.default
        try manager.createDirectory(at: page, withIntermediateDirectories: true)
        try manager.createDirectory(at: document, withIntermediateDirectories: true)
        for name in ["web/index.html", "notes/shot.PNG", "notes/note.md", "notes/noext", "outside.png"] {
            try Data().write(to: dir.appendingPathComponent(name))
        }
        try manager.createSymbolicLink(at: document.appendingPathComponent("up"), withDestinationURL: dir)
        func served(_ url: String, documentRoot: URL? = document) -> String? {
            servedFile(for: URL(string: url)!, pageRoot: page, documentRoot: documentRoot)?.1
        }

        expect(served("glyph-preview://page/index.html") == "text/html")
        expect(served("glyph-preview://document/shot.PNG") == "image/png")
        expect(served("glyph-preview://document/shot.PNG", documentRoot: nil) == nil)
        for url in ["glyph-preview://document/note.md", "glyph-preview://document/noext",
                    "glyph-preview://other/index.html", "glyph-preview://document/%2E%2E/outside.png",
                    "glyph-preview://document/a%2F..%2F..%2Foutside.png", "glyph-preview://document/up/outside.png",
                    "glyph-preview://page/../notes/shot.PNG"] {
            expect(served(url) == nil, url)
        }
    }

    static func checkPreviewURLs() {
        expect(isPreviewURL(entryURL))
        expect(isPreviewURL(entryURL + "#install"))
        for url in ["glyph-preview://page/index.html?x", "glyph-preview://page/index.htmlx",
                    "glyph-preview://page/other.md", "glyph-preview://document/index.html",
                    "https://example.com/", "file:///Users/me/notes.md", "about:blank"] {
            expect(!isPreviewURL(url), url)
        }
    }

    static func expect(_ condition: Bool, _ detail: String = "", line: UInt = #line) {
        guard !condition else { return }
        FileHandle.standardError.write("SelfCheck.swift:\(line) failed \(detail)\n".data(using: .utf8)!)
        exit(1)
    }
}
