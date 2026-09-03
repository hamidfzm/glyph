//! The live-reload script and where it goes in a served page.
//!
//! Injection happens on the way out of the server, never in the export, so a
//! site written with `--out` stays a plain static site with nothing
//! development-only baked into it.

/// Path the served pages open their event stream on. Namespaced under
/// `__glyph/` so it cannot collide with an exported page: the export derives
/// every route from a file name, and no markdown file produces this one.
pub const RELOAD_PATH: &str = "/__glyph/reload";

/// The script appended to every served HTML page. `EventSource` reconnects on
/// its own after a dropped connection, so a browser left open across a
/// restart of the server picks the stream back up without help.
pub const RELOAD_SCRIPT: &str = concat!(
    "<script data-glyph-reload>",
    "(function(){",
    "var s=new EventSource(\"/__glyph/reload\");",
    "s.onmessage=function(){location.reload()};",
    "})();",
    "</script>"
);

/// Put the reload script into an HTML document, just before `</body>` so it
/// runs after the page content has parsed. A fragment without a closing body
/// tag (an export is well-formed, but a hand-written file under the workspace
/// need not be) gets it appended instead of being left without live reload.
pub fn inject_reload_script(html: &str) -> String {
    match html.rfind("</body>") {
        Some(index) => format!("{}{}{}", &html[..index], RELOAD_SCRIPT, &html[index..]),
        None => format!("{html}{RELOAD_SCRIPT}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injects_before_the_closing_body_tag() {
        let out = inject_reload_script("<html><body><h1>Hi</h1></body></html>");
        assert!(out.contains(RELOAD_SCRIPT), "script missing from {out}");
        let script_at = out.find("data-glyph-reload").unwrap();
        let body_at = out.find("</body>").unwrap();
        assert!(script_at < body_at, "script must precede </body>: {out}");
        assert!(out.ends_with("</body></html>"), "tail rewritten: {out}");
    }

    #[test]
    fn appends_when_there_is_no_closing_body_tag() {
        let out = inject_reload_script("<h1>fragment</h1>");
        assert!(out.starts_with("<h1>fragment</h1>"));
        assert!(out.ends_with(RELOAD_SCRIPT), "script not appended: {out}");
    }

    #[test]
    fn uses_the_last_closing_body_tag() {
        // A page that merely writes about </body> must not have the script
        // spliced into the middle of its prose.
        let out = inject_reload_script("<body><code>&lt;/body&gt;</code></body>");
        let script_at = out.find("data-glyph-reload").unwrap();
        assert!(script_at > out.find("<code>").unwrap());
    }

    #[test]
    fn the_script_points_at_the_reload_path() {
        assert!(
            RELOAD_SCRIPT.contains(RELOAD_PATH),
            "script and route disagree"
        );
    }
}
