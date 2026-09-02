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
use hyper::header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE};
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::sync::broadcast;
use tower::ServiceExt;
use tower_http::services::ServeDir;

use inject::{inject_reload_script, RELOAD_PATH};

/// One body type for every route, so the router can return a file, a rebuilt
/// HTML page, and an open event stream from the same function.
type ServeBody = http_body_util::combinators::UnsyncBoxBody<Bytes, std::io::Error>;

/// Serve `dir` on an already-bound listener until the process ends. The
/// listener is bound by the caller so a port conflict fails before the app
/// starts, and so `--port 0` can report the port the OS picked.
pub async fn run(listener: std::net::TcpListener, dir: PathBuf, reload: broadcast::Sender<()>) {
    listener
        .set_nonblocking(true)
        .expect("listener cannot be made nonblocking");
    let Ok(listener) = tokio::net::TcpListener::from_std(listener) else {
        return;
    };

    loop {
        // A refused or reset connection says nothing about the next one, so
        // an accept error drops that client rather than the whole server.
        let Ok((stream, _)) = listener.accept().await else {
            continue;
        };
        let dir = dir.clone();
        let reload = reload.clone();
        tauri::async_runtime::spawn(async move {
            let service = hyper::service::service_fn(move |request| {
                route(request, dir.clone(), reload.clone())
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
    reload: broadcast::Sender<()>,
) -> Result<Response<ServeBody>, Infallible> {
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
    // `ServeDir` answers every request, including the ones it refuses: a
    // missing file is a 404 response, not an error, and its error type is
    // `Infallible`.
    let Ok(response) = ServeDir::new(&dir).oneshot(request).await;

    let is_html = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/html"));
    if !is_html {
        return response.map(BodyExt::boxed_unsync);
    }

    let (mut parts, body) = response.into_parts();
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
