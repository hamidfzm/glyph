import Foundation
import WebKit

// The page and the previewed file's folder are served on a custom scheme, the
// counterpart of the Windows handler's WebView2 virtual hosts (hosts.rs).
// `src/preview/index.html`'s CSP names the document host.
let previewScheme = "glyph-preview"
let entryURL = "glyph-preview://page/index.html"
let documentBaseURL = "glyph-preview://document/"

/// Only the preview page (and its in-page anchors) may load in the view. A
/// relative link in the document resolves onto the page host too, so the host
/// alone is not enough.
func isPreviewURL(_ url: String) -> Bool {
    guard url.hasPrefix(entryURL) else { return false }
    let rest = url.dropFirst(entryURL.count)
    return rest.isEmpty || rest.hasPrefix("#")
}

/// The file under `root` that a request's (decoded) path names, or nil for any
/// path that would leave it: `..`, or a symlink pointing outside.
func containedFile(_ path: String, under root: URL) -> URL? {
    let parts = path.split(separator: "/", omittingEmptySubsequences: false).dropFirst()
    guard path.hasPrefix("/"), !parts.isEmpty, !parts.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) else {
        return nil
    }
    let base = root.resolvingSymlinksInPath().standardizedFileURL
    let file = parts.reduce(base) { $0.appendingPathComponent(String($1)) }
        .resolvingSymlinksInPath().standardizedFileURL
    return file.path.hasPrefix(base.path + "/") ? file : nil
}

// The page's own assets. The document folder serves images only: that is all
// the page loads from it (previewImages.ts).
private let pageTypes = [
    "html": "text/html", "js": "text/javascript", "css": "text/css", "json": "application/json",
    "woff2": "font/woff2", "woff": "font/woff", "ttf": "font/ttf", "svg": "image/svg+xml",
    "png": "image/png",
]
private let imageTypes = [
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
    "webp": "image/webp", "avif": "image/avif", "svg": "image/svg+xml", "bmp": "image/bmp",
    "ico": "image/x-icon",
]

final class SchemeHandler: NSObject, WKURLSchemeHandler {
    private let pageRoot: URL
    var documentRoot: URL?

    init(pageRoot: URL) {
        self.pageRoot = pageRoot
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url,
              let (file, type) = servedFile(for: url, pageRoot: pageRoot, documentRoot: documentRoot),
              let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let response = HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": type, "Content-Length": String(data.count)])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

func servedFile(for url: URL, pageRoot: URL, documentRoot: URL?) -> (URL, String)? {
    let root: URL?
    let types: [String: String]
    switch url.host {
    case "page": (root, types) = (pageRoot, pageTypes)
    case "document": (root, types) = (documentRoot, imageTypes)
    default: return nil
    }
    // `url.path` is decoded, so an encoded `..` is caught here too.
    guard let root, let file = containedFile(url.path, under: root),
          let type = types[file.pathExtension.lowercased()] else { return nil }
    return (file, type)
}
