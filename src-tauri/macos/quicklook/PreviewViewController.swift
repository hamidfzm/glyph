import Cocoa
import Quartz
import WebKit

// Everything but the page's own scheme is blocked in WebKit itself, so no
// document can reach the network whatever the page's CSP says. The sandbox
// grants network.client only because WebKit cannot start without it.
private let blockRules = """
[{"trigger":{"url-filter":".*"},"action":{"type":"block"}},
 {"trigger":{"url-filter":"^glyph-preview:"},"action":{"type":"ignore-previous-rules"}},
 {"trigger":{"url-filter":"^data:"},"action":{"type":"ignore-previous-rules"}},
 {"trigger":{"url-filter":"^blob:"},"action":{"type":"ignore-previous-rules"}}]
"""

// Holds what the host posts until the page's script takes over (previewHost.ts):
// the page's module script can still be starting when the load finishes.
private let hostStub = "window.glyphHost = { messages: [], post(message) { this.messages.push(message) } };"

final class PreviewViewController: NSViewController, QLPreviewingController, WKNavigationDelegate {
    private let schemeHandler = SchemeHandler(pageRoot: Bundle.main.resourceURL!.appendingPathComponent("web"))
    private var webView: WKWebView!
    private enum Page { case loading, loaded, failed(Error) }
    private var page = Page.loading
    private var pending: (message: [String: Any], done: (Error?) -> Void)?
    /// Posted again if WebKit's content process dies, so the preview never goes blank.
    private var shown: [String: Any]?

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: previewScheme)
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addUserScript(
            WKUserScript(source: hostStub, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // No uiDelegate, so a link that asks for a new window opens nothing.
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.allowsLinkPreview = false
        view = webView
        preferredContentSize = NSSize(width: 800, height: 600)

        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "block-network", encodedContentRuleList: blockRules
        ) { [weak self] rules, error in
            guard let self else { return }
            guard let rules else {
                // Fail closed: without the block list the page never loads.
                self.fail(error ?? CocoaError(.featureUnsupported))
                return
            }
            self.webView.configuration.userContentController.add(rules)
            self.loadPage()
        }
    }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        schemeHandler.documentRoot = url.deletingLastPathComponent()
        // A superseded file is done: its preview is gone, and its message
        // must never land after the newer one (INV-3).
        pending?.done(nil)
        pending = (hostMessage(for: url, baseUrl: documentBaseURL), handler)
        switch page {
        case .loading: break
        case .loaded: post()
        case let .failed(error): fail(error)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard case .loading = page else { return }
        page = .loaded
        post()
    }

    // Only the page's own load counts: a link cancelled by the policy below
    // also reports a failed navigation, and must not take the page down.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if case .loading = page { fail(error) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if case .loading = page { fail(error) }
    }

    // WebKit can kill its content process (memory pressure): reload, and show
    // the same file again unless a newer one is already waiting.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if pending == nil, let shown { pending = (shown, { _ in }) }
        loadPage()
    }

    // Only the preview page and its in-page anchors load; every link is inert.
    func webView(
        _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        decisionHandler(isPreviewURL(action.request.url?.absoluteString ?? "") ? .allow : .cancel)
    }

    private func loadPage() {
        page = .loading
        webView.load(URLRequest(url: URL(string: entryURL)!))
    }

    private func post() {
        guard let (message, done) = pending else { return }
        pending = nil
        shown = message
        // JSON is a JavaScript literal, so the text arrives as data, never as code.
        guard let json = try? JSONSerialization.data(withJSONObject: message),
              let literal = String(data: json, encoding: .utf8) else {
            done(CocoaError(.coderInvalidValue))
            return
        }
        // `, true`: evaluateJavaScript reports an undefined result as an error.
        webView.evaluateJavaScript("glyphHost.post(\(literal)), true") { _, error in done(error) }
    }

    private func fail(_ error: Error) {
        page = .failed(error)
        pending?.done(error)
        pending = nil
    }
}
