// Shared fixtures for the plugins test modules: temp roots, on-disk plugin
// folders, and in-memory zip packages.

use std::fs;
use std::path::{Path, PathBuf};

pub(crate) const PACKAGED_MANIFEST: &str = r#"{"id":"com.x.pkg","name":"Pkg","version":"1.0.0","apiVersion":"0.16.0","files":["main.js","assets/data.txt"]}"#;

pub(crate) fn temp_root(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("glyph_plugins_{tag}_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

pub(crate) fn write_plugin(dir: &Path, id: &str, main: &str) {
    fs::create_dir_all(dir).unwrap();
    fs::write(
        dir.join("manifest.json"),
        format!(r#"{{"id":"{id}","name":"Test","version":"1.0.0","apiVersion":"^1.0.0"}}"#),
    )
    .unwrap();
    fs::write(dir.join("main.js"), main).unwrap();
}

/// Build an in-memory zip from (name, bytes) entries for package tests.
pub(crate) fn zip_with(method: zip::CompressionMethod, entries: &[(&str, &[u8])]) -> Vec<u8> {
    use std::io::Write;
    let mut cursor = std::io::Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(&mut cursor);
    let options = zip::write::SimpleFileOptions::default().compression_method(method);
    for (name, bytes) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap();
    cursor.into_inner()
}

pub(crate) fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    zip_with(zip::CompressionMethod::Stored, entries)
}

/// What a route of a `LocalServer` answers.
pub(crate) struct Response {
    pub(crate) status: u16,
    pub(crate) location: Option<String>,
    pub(crate) body: Vec<u8>,
}

pub(crate) fn ok(body: Vec<u8>) -> Response {
    Response {
        status: 200,
        location: None,
        body,
    }
}

pub(crate) fn redirect(to: &str) -> Response {
    Response {
        status: 302,
        location: Some(to.to_string()),
        body: Vec::new(),
    }
}

/// A one-request-per-connection HTTP server on a loopback port, for the
/// download tests. Bound first so the routes can name its URL, then served.
pub(crate) struct LocalServer {
    listener: std::net::TcpListener,
    url: String,
}

impl LocalServer {
    pub(crate) fn bind() -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        Self { listener, url }
    }

    pub(crate) fn url(&self) -> &str {
        &self.url
    }

    /// Answer each request from its path until the process ends; a path with
    /// no route gets a 404.
    pub(crate) fn serve(self, routes: Vec<(&'static str, Response)>) {
        use std::io::{BufRead, BufReader, Write};
        let not_found = Response {
            status: 404,
            location: None,
            body: Vec::new(),
        };
        std::thread::spawn(move || {
            for stream in self.listener.incoming().flatten() {
                let mut reader = BufReader::new(&stream);
                let mut line = String::new();
                let _ = reader.read_line(&mut line);
                let path = line.split_whitespace().nth(1).unwrap_or("");
                // The headers end at an empty line; nothing in them matters.
                let mut header = String::new();
                while reader.read_line(&mut header).unwrap_or(0) > 2 {
                    header.clear();
                }
                let response = routes
                    .iter()
                    .find(|(route, _)| *route == path)
                    .map_or(&not_found, |(_, response)| response);
                let reason = match response.status {
                    200 => "OK",
                    302 => "Found",
                    _ => "Not Found",
                };
                let location = response
                    .location
                    .as_ref()
                    .map_or(String::new(), |to| format!("Location: {to}\r\n"));
                let head = format!(
                    "HTTP/1.1 {} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n{location}\r\n",
                    response.status,
                    response.body.len()
                );
                let mut stream = &stream;
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(&response.body);
                let _ = stream.flush();
            }
        });
    }
}
