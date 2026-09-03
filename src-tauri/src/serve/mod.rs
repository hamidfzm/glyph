//! The static file server behind `glyph serve`.
//!
//! It hands out the same files the website export writes, plus one route the
//! export knows nothing about: an event stream the injected reload script
//! listens on. Serving is deliberately dumb — `ServeDir` owns MIME types,
//! index resolution, and keeping requests inside the directory — so the only
//! logic here is routing, the event stream, and the script injection.

pub mod inject;
pub mod watch;

use std::convert::Infallible;
use std::path::PathBuf;

use http_body_util::{BodyExt, Full, StreamBody};
use hyper::body::{Bytes, Frame, Incoming};
use hyper::header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, HOST};
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::sync::broadcast;
use tower::ServiceExt;
use tower_http::services::ServeDir;

use inject::{inject_reload_script, RELOAD_PATH};

/// One body type for every route, so the router can return a file, a rebuilt
/// HTML page, and an open event stream from the same function.
type ServeBody = http_body_util::combinators::UnsyncBoxBody<Bytes, std::io::Error>;

/// Which `Host` headers this server answers to.
///
/// Binding to loopback is not on its own enough to keep a workspace private.
/// A page on any website can re-point its own hostname at 127.0.0.1 and then
/// fetch `http://that-name:4173/`; the browser calls it same-origin, so the
/// attacker's script reads the whole rendered workspace. Checking the name
/// the request arrived under is what closes that (the same reason dev servers
/// grew an allowed-hosts list).
#[derive(Clone)]
pub struct HostGuard {
    /// The address `--host` named, so an explicitly exposed server answers
    /// to itself.
    bound: String,
}

impl HostGuard {
    pub fn new(bound: std::net::IpAddr) -> Self {
        Self {
            bound: bound.to_string(),
        }
    }

    /// Whether a request's `Host` header names this server rather than a
    /// name that merely resolves to it.
    fn allows(&self, header: Option<&str>) -> bool {
        // A request with no Host is HTTP/1.0 or a raw socket, never a browser
        // following a link, so there is no rebinding risk to answer for.
        let Some(header) = header else {
            return true;
        };
        let name = host_name(header);
        name == self.bound
            || name == "localhost"
            || name == "127.0.0.1"
            || name == "::1"
            || name == "[::1]"
            // `--host 0.0.0.0` is an explicit "let the network read this", so
            // it cannot also insist on one name: the machine is reached by
            // whatever address or name the visitor has for it.
            || self.bound == "0.0.0.0"
            || self.bound == "::"
    }
}

/// Strip the port from a `Host` header, leaving the name. Bracketed IPv6
/// literals keep their brackets, which is how they are compared above.
fn host_name(header: &str) -> &str {
    match header.strip_prefix('[') {
        // `[::1]:4173` splits after the bracket, not at the first colon.
        // `end` indexes into `rest`, so the bracket sits one later in
        // `header` and the slice runs to one past it.
        Some(rest) => match rest.find(']') {
            Some(end) => &header[..end + 2],
            None => header,
        },
        None => header.split(':').next().unwrap_or(header),
    }
}

/// How long to wait after a failed accept. A reset connection says nothing
/// about the next one, so one client's failure must not end the server; a
/// persistent error (running out of descriptors, say) would otherwise spin
/// the loop at full speed.
const ACCEPT_BACKOFF: std::time::Duration = std::time::Duration::from_millis(100);

/// Report a failed accept and pause before trying again.
async fn back_off_after(err: &std::io::Error) {
    eprintln!("glyph serve: dropped a connection: {err}");
    tokio::time::sleep(ACCEPT_BACKOFF).await;
}

/// Serve `dir` on an already-bound listener until the process ends.
///
/// The socket is bound and handed to tokio by the caller, so a port conflict
/// and an unusable socket both fail at startup with a nonzero exit rather
/// than becoming a log line under a ready message that already promised a
/// server.
pub async fn run(
    listener: tokio::net::TcpListener,
    dir: PathBuf,
    host: HostGuard,
    reload: broadcast::Sender<()>,
) {
    loop {
        let stream = match listener.accept().await {
            Ok((stream, _)) => stream,
            Err(err) => {
                back_off_after(&err).await;
                continue;
            }
        };
        let dir = dir.clone();
        let host = host.clone();
        let reload = reload.clone();
        tauri::async_runtime::spawn(async move {
            let service = hyper::service::service_fn(move |request| {
                route(request, dir.clone(), host.clone(), reload.clone())
            });
            let _ = hyper::server::conn::http1::Builder::new()
                .serve_connection(TokioIo::new(stream), service)
                .await;
        });
    }
}

/// The whole routing table: the reload stream, or a file from the export.
async fn route(
    request: Request<Incoming>,
    dir: PathBuf,
    host: HostGuard,
    reload: broadcast::Sender<()>,
) -> Result<Response<ServeBody>, Infallible> {
    if !host.allows(request.headers().get(HOST).and_then(|v| v.to_str().ok())) {
        return Ok(error_response(StatusCode::FORBIDDEN));
    }
    if request.uri().path() == RELOAD_PATH {
        return Ok(reload_stream(reload.subscribe()));
    }
    Ok(serve_file(request, dir).await)
}

/// An SSE response that emits one message per rebuild. Nothing is buffered:
/// a client that misses messages while it was away only needs to know that
/// *something* changed, so a lagged receiver reloads like any other.
fn reload_stream(receiver: broadcast::Receiver<()>) -> Response<ServeBody> {
    let stream = futures_util::stream::unfold(receiver, |mut receiver| async move {
        match receiver.recv().await {
            // A stream that fell behind only needs to know that something
            // changed, so a lagged receiver reloads like any other.
            Ok(()) | Err(broadcast::error::RecvError::Lagged(_)) => {
                let frame = Frame::data(Bytes::from_static(b"data: reload\n\n"));
                Some((Ok(frame), receiver))
            }
            Err(broadcast::error::RecvError::Closed) => None,
        }
    });

    Response::builder()
        .header(CONTENT_TYPE, "text/event-stream")
        // Without this a proxy (or the browser itself) may hold the stream
        // and deliver rebuild messages in a batch, long after they mattered.
        .header(CACHE_CONTROL, "no-store")
        .body(BodyExt::boxed_unsync(StreamBody::new(stream)))
        .expect("reload stream response is well-formed")
}

/// Hand back a file from the exported site, injecting the reload script into
/// HTML on the way past. `ServeDir` resolves `index.html`, guesses the
/// content type, and refuses to escape `dir`, including through encoded
/// traversal segments.
async fn serve_file<B: Send + 'static>(request: Request<B>, dir: PathBuf) -> Response<ServeBody> {
    // The export writes no hidden files, so anything hidden under the output
    // directory was already there. That matters when `--out` points at a
    // directory of the user's own, where `.env` or `.git/config` would
    // otherwise be readable over the network under `--host`.
    if request
        .uri()
        .path()
        .split('/')
        .any(|segment| segment.starts_with('.') && segment != "." && segment != "..")
    {
        return error_response(StatusCode::NOT_FOUND);
    }

    let is_get = request.method() == Method::GET;
    // `ServeDir` answers every request, including the ones it refuses: a
    // missing file is a 404 response, not an error, and its error type is
    // `Infallible`.
    let Ok(response) = ServeDir::new(&dir).oneshot(request).await;

    let is_html = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/html"));
    // Only a whole page gets the script. A 206 carries a byte range whose
    // length the injection would contradict, and a HEAD carries no body at
    // all, so appending to one invents a length for a body that is not there.
    if !is_html || !is_get || response.status() != StatusCode::OK {
        return response.map(BodyExt::boxed_unsync);
    }

    let (parts, body) = response.into_parts();
    injected_page(parts, body).await
}

/// Rebuild an HTML response with the reload script in it. Split from the
/// routing so the read-failure and non-text arms can be driven directly: by
/// the time a real `ServeDir` body fails, the file is already open.
async fn injected_page<B>(mut parts: hyper::http::response::Parts, body: B) -> Response<ServeBody>
where
    B: hyper::body::Body<Data = Bytes, Error = std::io::Error>,
{
    let Ok(collected) = body.collect().await else {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR);
    };
    let bytes = collected.to_bytes();
    let Ok(html) = std::str::from_utf8(&bytes) else {
        // Not text after all: hand back exactly what was on disk.
        return Response::from_parts(parts, byte_body(bytes));
    };

    let injected = inject_reload_script(html);
    // The body grew, so the length `ServeDir` measured from the file no
    // longer describes it. Leaving it stale truncates the page.
    parts.headers.remove(CONTENT_LENGTH);
    Response::from_parts(parts, byte_body(Bytes::from(injected)))
}

/// Wrap already-collected bytes as a response body.
fn byte_body(bytes: Bytes) -> ServeBody {
    BodyExt::boxed_unsync(Full::new(bytes).map_err(|never| match never {}))
}

/// A bodyless response for the paths that cannot produce content.
fn error_response(status: StatusCode) -> Response<ServeBody> {
    let mut response = Response::new(byte_body(Bytes::new()));
    *response.status_mut() = status;
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// An export-shaped directory: a page, a nested page, and a non-HTML asset.
    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("temp dir");
        let mut index = std::fs::File::create(dir.path().join("index.html")).unwrap();
        index.write_all(b"<html><body>home</body></html>").unwrap();
        std::fs::create_dir(dir.path().join("notes")).unwrap();
        std::fs::write(
            dir.path().join("notes/deep.html"),
            b"<html><body>deep</body></html>",
        )
        .unwrap();
        std::fs::write(dir.path().join("style.css"), b"body{color:red}").unwrap();
        dir
    }

    /// Drive `serve_file` the way a connection would, without a socket.
    /// `Incoming` cannot be built outside hyper, which is why the function is
    /// generic over the request body rather than tied to it.
    async fn get(dir: &std::path::Path, path: &str) -> Response<ServeBody> {
        let request = Request::builder()
            .uri(path)
            .method(Method::GET)
            .body(Full::new(Bytes::new()))
            .expect("request is well-formed");
        serve_file(request, dir.to_path_buf()).await
    }

    async fn body_string(response: Response<ServeBody>) -> String {
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    #[tokio::test]
    async fn serves_the_index_page_at_the_root() {
        let dir = fixture();
        let response = get(dir.path(), "/").await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(body_string(response).await.contains("home"));
    }

    #[tokio::test]
    async fn serves_nested_pages_at_their_site_relative_paths() {
        let dir = fixture();
        let response = get(dir.path(), "/notes/deep.html").await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(body_string(response).await.contains("deep"));
    }

    #[tokio::test]
    async fn unknown_paths_are_not_found() {
        let dir = fixture();
        assert_eq!(
            get(dir.path(), "/nope.html").await.status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn html_responses_carry_the_reload_script() {
        let dir = fixture();
        let response = get(dir.path(), "/").await;
        // The stale file length would truncate the page it just grew.
        assert!(response.headers().get(CONTENT_LENGTH).is_none());
        assert!(body_string(response).await.contains("data-glyph-reload"));
    }

    #[tokio::test]
    async fn html_that_is_not_valid_utf8_is_served_as_it_is_on_disk() {
        // The content type says HTML but the bytes are not text, so there is
        // nothing to inject into; the file still has to arrive intact.
        let dir = fixture();
        std::fs::write(dir.path().join("broken.html"), [0xff, 0xfe, 0x00, 0x9f]).unwrap();

        let response = get(dir.path(), "/broken.html").await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(body.as_ref(), &[0xff, 0xfe, 0x00, 0x9f]);
    }

    #[tokio::test]
    async fn non_html_responses_are_untouched() {
        let dir = fixture();
        let body = body_string(get(dir.path(), "/style.css").await).await;
        assert_eq!(body, "body{color:red}");
    }

    #[tokio::test]
    async fn traversal_never_escapes_the_served_directory() {
        let dir = fixture();
        let secret = dir.path().parent().unwrap().join("glyph-serve-secret.txt");
        std::fs::write(&secret, b"do not serve me").unwrap();

        for attempt in [
            "/../glyph-serve-secret.txt",
            "/../../glyph-serve-secret.txt",
            "/%2e%2e/glyph-serve-secret.txt",
            "/%2e%2e%2fglyph-serve-secret.txt",
            "/..%5cglyph-serve-secret.txt",
            "/notes/../../glyph-serve-secret.txt",
        ] {
            let response = get(dir.path(), attempt).await;
            let status = response.status();
            let body = body_string(response).await;
            assert!(
                !body.contains("do not serve me"),
                "{attempt} escaped the directory"
            );
            assert!(
                status.is_client_error() || status.is_redirection(),
                "{attempt} answered {status}"
            );
        }
        let _ = std::fs::remove_file(&secret);
    }

    /// Drive the router, which is what a real connection reaches.
    async fn request(
        dir: &std::path::Path,
        path: &str,
        host: &str,
        guard: &HostGuard,
    ) -> Response<ServeBody> {
        let (sender, _) = broadcast::channel(4);
        let mut builder = Request::builder().uri(path).method(Method::GET);
        if !host.is_empty() {
            builder = builder.header(HOST, host);
        }
        // `Incoming` cannot be built outside hyper, so the router is reached
        // through the same generic path a connection takes.
        let request = builder.body(Full::new(Bytes::new())).expect("well-formed");
        if !guard.allows(request.headers().get(HOST).and_then(|v| v.to_str().ok())) {
            return error_response(StatusCode::FORBIDDEN);
        }
        if request.uri().path() == RELOAD_PATH {
            return reload_stream(sender.subscribe());
        }
        serve_file(request, dir.to_path_buf()).await
    }

    /// Speak HTTP/1.1 down a real socket and read the whole reply. Keeps the
    /// end-to-end tests dependency-free: nothing in the tree is an HTTP
    /// client, and the exchange under test is one request long.
    fn http_get(port: u16, path: &str, host: &str) -> String {
        use std::io::{Read, Write};
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");
        stream
            .write_all(
                format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n")
                    .as_bytes(),
            )
            .expect("writes");
        let mut reply = String::new();
        stream.read_to_string(&mut reply).expect("reads");
        reply
    }

    /// Bind an ephemeral port and start the server on it, as `start_serve`
    /// does, returning the port the OS chose.
    fn start(dir: &std::path::Path, host: &str) -> (u16, broadcast::Sender<()>) {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("binds");
        let port = listener.local_addr().expect("has an address").port();
        listener.set_nonblocking(true).expect("goes nonblocking");
        let listener = tokio::net::TcpListener::from_std(listener).expect("registers");
        let (reload, _) = broadcast::channel(4);
        let guard = HostGuard::new(host.parse().expect("an address"));
        tauri::async_runtime::spawn(run(listener, dir.to_path_buf(), guard, reload.clone()));
        (port, reload)
    }

    #[tokio::test]
    async fn a_page_that_cannot_be_read_is_a_server_error() {
        // `ServeDir` has already opened the file by the time its body is
        // streamed, so a read that fails part way through arrives here as a
        // body error rather than a 404.
        let failing = StreamBody::new(futures_util::stream::once(async {
            Err(std::io::Error::other("the disk went away"))
        }));
        let parts = Response::new(()).into_parts().0;

        let response = injected_page(parts, failing).await;
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    /// A "listener" that is really a connected socket, so `accept` fails on
    /// it the way one that has gone bad in service would. Nothing portable
    /// can break a real listener, and this is the failure the accept loop
    /// exists to survive.
    fn broken_listener() -> std::net::TcpListener {
        let real = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("binds");
        let connected = std::net::TcpStream::connect(real.local_addr().expect("has an address"))
            .expect("connects");
        #[cfg(unix)]
        {
            std::net::TcpListener::from(std::os::fd::OwnedFd::from(connected))
        }
        #[cfg(windows)]
        {
            std::net::TcpListener::from(std::os::windows::io::OwnedSocket::from(connected))
        }
    }

    #[tokio::test]
    async fn a_failing_accept_does_not_end_the_server() {
        // One client's failure, or a socket that goes bad, must not take the
        // server down: it reports, pauses, and keeps accepting.
        let dir = fixture();
        let broken = broken_listener();
        broken.set_nonblocking(true).expect("goes nonblocking");
        let listener = tokio::net::TcpListener::from_std(broken).expect("registers");
        let (reload, _) = broadcast::channel(4);
        let guard = HostGuard::new("127.0.0.1".parse().unwrap());

        let still_running = tokio::time::timeout(
            ACCEPT_BACKOFF * 4,
            run(listener, dir.path().to_path_buf(), guard, reload),
        )
        .await;

        assert!(
            still_running.is_err(),
            "the loop returned instead of carrying on after failed accepts"
        );
    }

    #[tokio::test]
    async fn a_failed_accept_backs_off_before_trying_again() {
        // Without the pause, a persistent error (no file descriptors left)
        // spins the accept loop at full speed.
        let started = std::time::Instant::now();
        back_off_after(&std::io::Error::other("connection reset")).await;
        assert!(started.elapsed() >= ACCEPT_BACKOFF, "returned immediately");
    }

    #[tokio::test]
    async fn serves_over_a_real_socket() {
        // The accept loop and the connection handling only run for real over
        // a socket; every other test here calls past them.
        let dir = fixture();
        let (port, _reload) = start(dir.path(), "127.0.0.1");

        let reply = tokio::task::spawn_blocking(move || http_get(port, "/", "localhost"))
            .await
            .expect("the request thread finishes");

        assert!(reply.starts_with("HTTP/1.1 200"), "got: {reply}");
        assert!(reply.contains("home"), "page body missing: {reply}");
        assert!(reply.contains("data-glyph-reload"), "script missing");
    }

    #[tokio::test]
    async fn refuses_a_rebinding_host_over_a_real_socket() {
        let dir = fixture();
        let (port, _reload) = start(dir.path(), "127.0.0.1");

        let reply = tokio::task::spawn_blocking(move || http_get(port, "/", "evil.com"))
            .await
            .expect("the request thread finishes");

        assert!(reply.starts_with("HTTP/1.1 403"), "got: {reply}");
        assert!(!reply.contains("home"), "the page leaked: {reply}");
    }

    #[tokio::test]
    async fn a_rebuild_reaches_a_browser_on_a_real_socket() {
        // The whole point of the server: an open stream is told to reload.
        let dir = fixture();
        let (port, reload) = start(dir.path(), "127.0.0.1");

        let stream = tokio::task::spawn_blocking(move || {
            use std::io::{Read, Write};
            let mut socket = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");
            socket
                .write_all(
                    format!("GET {RELOAD_PATH} HTTP/1.1\r\nHost: localhost\r\n\r\n").as_bytes(),
                )
                .expect("writes");
            let mut buffer = [0u8; 512];
            let read = socket.read(&mut buffer).expect("reads the headers");
            String::from_utf8_lossy(&buffer[..read]).into_owned()
        });

        // Give the subscription time to reach the broadcast channel, then
        // announce a rebuild the way `serve_ready` does.
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let _ = reload.send(());

        let headers = stream.await.expect("the request thread finishes");
        assert!(headers.contains("text/event-stream"), "got: {headers}");
    }

    #[tokio::test]
    async fn a_foreign_host_header_is_refused() {
        // DNS rebinding: a page on evil.com re-points its own name at
        // 127.0.0.1 and fetches the site, which the browser then treats as
        // same-origin. Binding to loopback does not stop it; this does.
        let dir = fixture();
        let guard = HostGuard::new("127.0.0.1".parse().unwrap());
        let response = request(dir.path(), "/", "evil.com", &guard).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(!body_string(response).await.contains("home"));
    }

    #[tokio::test]
    async fn the_names_this_server_answers_to_are_allowed() {
        let dir = fixture();
        let guard = HostGuard::new("127.0.0.1".parse().unwrap());
        for host in [
            "127.0.0.1:4173",
            "localhost:4173",
            "localhost",
            "[::1]:4173",
        ] {
            let response = request(dir.path(), "/", host, &guard).await;
            assert_eq!(response.status(), StatusCode::OK, "{host} should be served");
        }
        // No Host at all is not a browser, so there is no rebinding to stop.
        assert_eq!(
            request(dir.path(), "/", "", &guard).await.status(),
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn an_explicitly_exposed_server_answers_to_any_name() {
        // `--host 0.0.0.0` is the user saying the network may read this, so
        // it cannot also insist on the name the visitor used to get here.
        let dir = fixture();
        let guard = HostGuard::new("0.0.0.0".parse().unwrap());
        let response = request(dir.path(), "/", "my-laptop.local:4173", &guard).await;
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[test]
    fn host_name_drops_the_port_and_keeps_ipv6_brackets() {
        assert_eq!(host_name("localhost:4173"), "localhost");
        assert_eq!(host_name("localhost"), "localhost");
        assert_eq!(host_name("[::1]:4173"), "[::1]");
        assert_eq!(host_name("[::1]"), "[::1]");
        // Malformed rather than rejected: an unterminated bracket is compared
        // whole, and matches nothing this server answers to.
        assert_eq!(host_name("[::1"), "[::1");
    }

    #[tokio::test]
    async fn hidden_files_under_the_output_directory_are_not_served() {
        // The export writes none, so anything hidden there is the user's, and
        // `--out` pointed at a working directory would otherwise publish it.
        let dir = fixture();
        std::fs::write(dir.path().join(".env"), b"SECRET=1").unwrap();
        std::fs::create_dir(dir.path().join(".git")).unwrap();
        std::fs::write(dir.path().join(".git/config"), b"[core]").unwrap();

        for path in ["/.env", "/.git/config"] {
            let response = get(dir.path(), path).await;
            assert_eq!(
                response.status(),
                StatusCode::NOT_FOUND,
                "{path} was served"
            );
            assert!(!body_string(response).await.contains("SECRET"));
        }
    }

    #[tokio::test]
    async fn a_head_request_is_not_given_a_body() {
        // Appending the script to an empty body invents a content length for
        // a body that is not there.
        let dir = fixture();
        let request = Request::builder()
            .uri("/")
            .method(Method::HEAD)
            .body(Full::new(Bytes::new()))
            .expect("well-formed");
        let response = serve_file(request, dir.path().to_path_buf()).await;
        assert!(
            !body_string(response).await.contains("data-glyph-reload"),
            "a HEAD response must stay bodyless"
        );
    }

    #[tokio::test]
    async fn a_range_request_is_not_rewritten() {
        // A 206 carries a Content-Range the injected script would contradict.
        let dir = fixture();
        let request = Request::builder()
            .uri("/")
            .method(Method::GET)
            .header(hyper::header::RANGE, "bytes=0-9")
            .body(Full::new(Bytes::new()))
            .expect("well-formed");
        let response = serve_file(request, dir.path().to_path_buf()).await;
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert!(!body_string(response).await.contains("data-glyph-reload"));
    }

    #[tokio::test]
    async fn the_reload_route_is_reachable_through_the_router() {
        let dir = fixture();
        let guard = HostGuard::new("127.0.0.1".parse().unwrap());
        let response = request(dir.path(), RELOAD_PATH, "localhost:4173", &guard).await;
        assert_eq!(
            response.headers().get(CONTENT_TYPE).unwrap(),
            "text/event-stream"
        );
    }

    #[tokio::test]
    async fn the_reload_route_opens_an_event_stream() {
        let (sender, _) = broadcast::channel(4);
        let response = reload_stream(sender.subscribe());
        assert_eq!(
            response.headers().get(CONTENT_TYPE).unwrap(),
            "text/event-stream"
        );
    }

    #[tokio::test]
    async fn a_rebuild_pushes_one_message_per_subscriber() {
        let (sender, _) = broadcast::channel(4);
        let response = reload_stream(sender.subscribe());
        sender.send(()).expect("a subscriber is listening");

        let mut body = Box::pin(response.into_body());
        let frame = body
            .frame()
            .await
            .expect("a frame arrives")
            .expect("the frame is not an error");
        assert_eq!(frame.into_data().unwrap(), Bytes::from("data: reload\n\n"));
    }

    #[tokio::test]
    async fn the_stream_ends_when_the_server_stops_broadcasting() {
        let (sender, _) = broadcast::channel(4);
        let response = reload_stream(sender.subscribe());
        drop(sender);

        let mut body = Box::pin(response.into_body());
        assert!(
            body.frame().await.is_none(),
            "stream should end once nothing can broadcast again"
        );
    }
}
