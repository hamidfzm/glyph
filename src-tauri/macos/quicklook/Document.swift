import Foundation

/// Larger files get a notice instead of a render, so Quick Look never waits on one.
let maxPreviewBytes = 2 * 1024 * 1024

/// The message the preview page renders for the file at `url`
/// (src/preview/hostMessage.ts). `baseUrl` is where the page finds images
/// relative to the file. Mirrors the Windows handler's document.rs.
func hostMessage(for url: URL, baseUrl: String, cap: Int = maxPreviewBytes) -> [String: Any] {
    guard let data = readCapped(url, cap: cap) else { return ["kind": "unreadable"] }
    if data.count > cap {
        // The read decides, so a file that grew since the stat is still caught;
        // the stat only supplies the size for the notice.
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        return ["kind": "tooLarge", "bytes": max(size, data.count)]
    }
    // UTF-8 only, like the app's own reader: a file the app cannot open
    // previews as unreadable rather than as mojibake.
    guard var text = String(data: data, encoding: .utf8) else { return ["kind": "unreadable"] }
    if text.unicodeScalars.first == "\u{FEFF}" { text.unicodeScalars.removeFirst() }
    return ["kind": "document", "content": text, "baseUrl": baseUrl]
}

/// Up to `cap + 1` bytes of the file (one past the cap marks it too large), or
/// nil when it cannot be read. A stream, because FileHandle raises an
/// Objective-C exception on a read error, which Swift cannot catch.
private func readCapped(_ url: URL, cap: Int) -> Data? {
    guard let stream = InputStream(url: url) else { return nil }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    while data.count <= cap {
        let read = stream.read(&buffer, maxLength: min(buffer.count, cap + 1 - data.count))
        if read < 0 { return nil }
        if read == 0 { break }
        data.append(buffer, count: read)
    }
    return data
}
