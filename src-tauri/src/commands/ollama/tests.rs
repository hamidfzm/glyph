use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::ipc::InvokeResponseBody;
use tauri::test::{
    get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY,
};
use tauri::webview::InvokeRequest;
use tauri::{WebviewWindow, WebviewWindowBuilder};

use super::*;

const WAIT: Duration = Duration::from_secs(10);

/// A request the test server received.
struct Seen {
    method: String,
    path: String,
    /// Names lowercased.
    headers: Vec<(String, String)>,
    body: String,
}

impl Seen {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, value)| value.as_str())
    }
}

/// One step of a scripted reply. A script that stops before `End` cuts the
/// connection mid-body.
enum Part {
    Head(u16, Option<&'static str>),
    Chunk(&'static str),
    End,
    /// Wait for the client to close the connection, and report it.
    Hold,
}

fn reply(status: u16, chunks: &[&'static str]) -> Vec<Part> {
    let mut parts = vec![Part::Head(status, None)];
    parts.extend(chunks.iter().map(|chunk| Part::Chunk(chunk)));
    parts.push(Part::End);
    parts
}

struct Server {
    base: String,
    requests: mpsc::Receiver<Seen>,
    closed: mpsc::Receiver<()>,
}

fn read_request(reader: &mut impl BufRead) -> Seen {
    let mut line = String::new();
    let _ = reader.read_line(&mut line);
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut headers = Vec::new();
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).unwrap_or(0) <= 2 {
            break;
        }
        if let Some((name, value)) = header.trim_end().split_once(':') {
            headers.push((name.to_ascii_lowercase(), value.trim().to_string()));
        }
    }
    let length = headers
        .iter()
        .find(|(name, _)| name == "content-length")
        .and_then(|(_, value)| value.parse().ok())
        .unwrap_or(0);
    let mut body = vec![0; length];
    let _ = reader.read_exact(&mut body);
    Seen {
        method,
        path,
        headers,
        body: String::from_utf8_lossy(&body).into_owned(),
    }
}

/// A loopback HTTP server playing each route's script (a path with no route
/// gets a 404), reporting every request it read and every held connection
/// the client closed.
fn serve(routes: Vec<(&'static str, Vec<Part>)>) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (seen, requests) = mpsc::channel();
    let (gone, closed) = mpsc::channel();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let request = read_request(&mut BufReader::new(&stream));
            let route = routes.iter().find(|(route, _)| *route == request.path);
            let _ = seen.send(request);
            let mut out = &stream;
            let Some((_, script)) = route else {
                let _ = out.write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
                continue;
            };
            for part in script {
                match part {
                    Part::Head(status, location) => {
                        let location =
                            location.map_or(String::new(), |to| format!("Location: {to}\r\n"));
                        let _ = write!(
                            out,
                            "HTTP/1.1 {status} Reply\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n{location}\r\n"
                        );
                    }
                    Part::Chunk(chunk) => {
                        let _ = write!(out, "{:x}\r\n{chunk}\r\n", chunk.len());
                    }
                    Part::End => {
                        let _ = out.write_all(b"0\r\n\r\n");
                    }
                    Part::Hold => {
                        let mut byte = [0; 1];
                        while matches!(out.read(&mut byte), Ok(n) if n > 0) {}
                        let _ = gone.send(());
                    }
                }
                let _ = out.flush();
            }
        }
    });
    Server {
        base,
        requests,
        closed,
    }
}

/// A loopback URL nothing listens on.
fn closed_port() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    format!("http://{}", listener.local_addr().unwrap())
}

/// Send a request and read its whole body, as the renderer does.
async fn exchange(
    base: &str,
    endpoint: OllamaEndpoint,
    body: Option<Value>,
) -> Result<(u16, String), String> {
    let request = OllamaRequest::new(build_request(base, endpoint, body)?);
    let status = request.send().await?;
    let mut text = Vec::new();
    while let Some(chunk) = request.next_chunk().await? {
        assert!(!chunk.is_empty(), "an empty chunk would read as the end");
        text.extend(chunk);
    }
    Ok((status, String::from_utf8(text).unwrap()))
}

#[test]
fn the_endpoint_path_goes_under_the_base_url() {
    let cases = [
        ("http://localhost:11434", "http://localhost:11434/api/chat"),
        ("http://localhost:11434/", "http://localhost:11434/api/chat"),
        (
            " http://localhost:11434 ",
            "http://localhost:11434/api/chat",
        ),
        ("https://box.lan/ollama/", "https://box.lan/ollama/api/chat"),
        (
            "http://10.0.0.2:8080/a/b",
            "http://10.0.0.2:8080/a/b/api/chat",
        ),
    ];
    for (base, expected) in cases {
        assert_eq!(
            endpoint_url(base, OllamaEndpoint::Chat).unwrap().as_str(),
            expected,
            "{base}"
        );
    }
    assert_eq!(
        endpoint_url("http://localhost:11434", OllamaEndpoint::Tags)
            .unwrap()
            .as_str(),
        "http://localhost:11434/api/tags"
    );
}

#[test]
fn a_base_url_that_could_move_the_path_or_add_a_header_is_refused() {
    let cases = [
        // No scheme: `localhost` parses as one.
        ("localhost:11434", "http:// or https://"),
        ("file:///C:/Windows/win.ini", "http:// or https://"),
        ("ftp://box.lan", "http:// or https://"),
        ("javascript:alert(1)", "http:// or https://"),
        ("http://box.lan/admin?x=", "query or fragment"),
        ("http://box.lan/?", "query or fragment"),
        ("http://box.lan/#", "query or fragment"),
        // reqwest would send these as an `Authorization` header.
        ("http://user:secret@box.lan", "user name or password"),
        ("http://user@box.lan", "user name or password"),
        ("http://:secret@box.lan", "user name or password"),
        ("", "not a valid URL"),
        ("http://", "not a valid URL"),
    ];
    for (base, expected) in cases {
        let err = endpoint_url(base, OllamaEndpoint::Chat).unwrap_err();
        assert!(err.contains(expected), "{base}: {err}");
    }
}

#[test]
fn a_body_that_does_not_fit_the_endpoint_is_refused() {
    let err = build_request("http://localhost:11434", OllamaEndpoint::Chat, None).unwrap_err();
    assert_eq!(err, "a chat request needs a body");
    let err = build_request(
        "http://localhost:11434",
        OllamaEndpoint::Tags,
        Some(json!({})),
    )
    .unwrap_err();
    assert_eq!(err, "a model list request takes no body");
}

#[tokio::test]
async fn a_chat_posts_json_without_an_origin_and_streams_the_reply() {
    let chunks = [
        "{\"message\":{\"content\":\"Hel\"}}\n",
        "{\"message\":{\"content\":\"lo\"},",
        "\"done\":true}\n",
    ];
    let server = serve(vec![("/api/chat", reply(200, &chunks))]);
    let body = json!({ "model": "llama3.2", "stream": true });

    let reply = exchange(&server.base, OllamaEndpoint::Chat, Some(body.clone())).await;
    assert_eq!(reply, Ok((200, chunks.concat())));

    let request = server.requests.recv().unwrap();
    assert_eq!(request.method, "POST");
    assert_eq!(request.path, "/api/chat");
    assert_eq!(request.header("content-type"), Some("application/json"));
    // The point of the backend route: Ollama refuses `http://tauri.localhost`.
    assert_eq!(request.header("origin"), None);
    assert_eq!(serde_json::from_str::<Value>(&request.body).unwrap(), body);
}

#[tokio::test]
async fn the_model_list_is_a_get_below_the_path_prefix() {
    let server = serve(vec![("/proxy/api/tags", reply(200, &["{\"models\":[]}"]))]);

    let reply = exchange(
        &format!("{}/proxy/", server.base),
        OllamaEndpoint::Tags,
        None,
    )
    .await;
    assert_eq!(reply, Ok((200, "{\"models\":[]}".to_string())));

    let request = server.requests.recv().unwrap();
    assert_eq!(
        (request.method.as_str(), request.body.as_str()),
        ("GET", "")
    );
}

#[tokio::test]
async fn an_error_status_comes_back_with_its_body() {
    let refusal = "{\"error\":\"llama3.2 does not support tools\"}";
    let server = serve(vec![("/api/chat", reply(400, &[refusal]))]);

    let reply = exchange(&server.base, OllamaEndpoint::Chat, Some(json!({}))).await;
    assert_eq!(reply, Ok((400, refusal.to_string())));
}

#[tokio::test]
async fn a_redirect_is_handed_back_not_followed() {
    let server = serve(vec![
        (
            "/api/tags",
            vec![Part::Head(302, Some("/elsewhere")), Part::End],
        ),
        ("/elsewhere", reply(200, &["secret"])),
    ]);

    let reply = exchange(&server.base, OllamaEndpoint::Tags, None).await;
    assert_eq!(reply, Ok((302, String::new())));
    assert_eq!(server.requests.recv().unwrap().path, "/api/tags");
    assert!(
        server.requests.try_recv().is_err(),
        "the redirect was followed"
    );
}

#[tokio::test]
async fn a_request_is_read_only_after_its_status_and_sent_only_once() {
    let server = serve(vec![("/api/tags", reply(200, &["{}"]))]);
    let request =
        OllamaRequest::new(build_request(&server.base, OllamaEndpoint::Tags, None).unwrap());

    let no_reply = Err("the request has no reply to read".to_string());
    assert_eq!(request.next_chunk().await, no_reply);
    assert_eq!(request.send().await, Ok(200));
    assert_eq!(
        request.send().await,
        Err("the request was already sent".to_string())
    );
    assert_eq!(request.next_chunk().await, no_reply);
    assert_eq!(server.requests.recv().unwrap().path, "/api/tags");
    assert!(server.requests.try_recv().is_err(), "it was sent twice");
}

#[tokio::test]
async fn a_server_that_is_not_running_names_the_cause() {
    let err = exchange(&closed_port(), OllamaEndpoint::Tags, None)
        .await
        .unwrap_err();
    // The innermost cause (the OS's "connection refused"), not reqwest's
    // "error sending request for url (...)".
    assert!(!err.is_empty());
    assert!(!err.contains("error sending request"), "{err}");
}

fn invoke(
    webview: &WebviewWindow<MockRuntime>,
    cmd: &str,
    args: Value,
) -> Result<InvokeResponseBody, Value> {
    #[cfg(any(windows, target_os = "android"))]
    let url = "http://tauri.localhost";
    #[cfg(not(any(windows, target_os = "android")))]
    let url = "tauri://localhost";
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: url.parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
}

fn json_of(response: InvokeResponseBody) -> Value {
    response.deserialize().unwrap()
}

fn read(webview: &WebviewWindow<MockRuntime>, rid: &Value) -> Result<Vec<u8>, Value> {
    match invoke(webview, "ollama_read", json!({ "rid": rid }))? {
        InvokeResponseBody::Raw(bytes) => Ok(bytes),
        InvokeResponseBody::Json(json) => panic!("expected raw bytes, got {json}"),
    }
}

/// A mock app with the Ollama commands and two windows.
fn windows() -> (
    tauri::App<MockRuntime>,
    WebviewWindow<MockRuntime>,
    WebviewWindow<MockRuntime>,
) {
    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![
            super::ollama_open,
            super::ollama_send,
            super::ollama_read,
            super::ollama_cancel
        ])
        .build(mock_context(noop_assets()))
        .expect("mock app builds");
    let main = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("webview builds");
    let other = WebviewWindowBuilder::new(&app, "w2", Default::default())
        .build()
        .expect("webview builds");
    (app, main, other)
}

fn open(webview: &WebviewWindow<MockRuntime>, base: &str, endpoint: &str, body: Value) -> Value {
    json_of(
        invoke(
            webview,
            "ollama_open",
            json!({ "baseUrl": base, "endpoint": endpoint, "body": body }),
        )
        .expect("open succeeds"),
    )
}

fn send(webview: &WebviewWindow<MockRuntime>, rid: &Value) -> Result<Value, Value> {
    invoke(webview, "ollama_send", json!({ "rid": rid })).map(json_of)
}

// An async command's IPC marshalling runs only for a real IPC message, and the
// resource table belongs to the webview, so the lifecycle runs through two
// mock windows.
#[test]
fn a_request_is_used_only_through_the_webview_that_opened_it() {
    let server = serve(vec![
        ("/api/tags", reply(200, &["{\"models\":", "[]}"])),
        (
            "/api/chat",
            vec![Part::Head(200, None), Part::Chunk("{}\n")],
        ),
    ]);
    let (_app, main, other) = windows();

    let rid = open(&main, &server.base, "tags", Value::Null);
    assert!(send(&other, &rid).is_err(), "another window sends it");
    assert_eq!(send(&main, &rid), Ok(json!(200)));
    // Another window neither reads nor cancels it.
    assert!(read(&other, &rid).is_err());
    invoke(&other, "ollama_cancel", json!({ "rid": rid })).unwrap();
    let mut body = Vec::new();
    loop {
        let chunk = read(&main, &rid).unwrap();
        if chunk.is_empty() {
            break;
        }
        body.extend(chunk);
    }
    assert_eq!(body, b"{\"models\":[]}");
    assert!(read(&main, &rid).is_err(), "the end closes it");

    // A body cut off mid-way fails the read, which closes it too.
    let rid = open(&main, &server.base, "chat", json!({ "model": "m" }));
    assert_eq!(send(&main, &rid), Ok(json!(200)));
    assert_eq!(read(&main, &rid).unwrap(), b"{}\n");
    assert!(read(&main, &rid).is_err());
    assert!(read(&main, &rid).is_err());

    let rid = open(&main, &server.base, "tags", Value::Null);
    invoke(&main, "ollama_cancel", json!({ "rid": rid })).unwrap();
    assert!(send(&main, &rid).is_err(), "a cancelled request is gone");
    invoke(&main, "ollama_cancel", json!({ "rid": rid })).expect("cancelling twice is fine");

    // A send that reaches nothing closes the request.
    let rid = open(&main, &closed_port(), "tags", Value::Null);
    assert!(send(&main, &rid).is_err());
    assert!(read(&main, &rid).is_err());
}

#[test]
fn a_url_or_endpoint_outside_the_contract_is_refused_on_open() {
    let (_app, main, _other) = windows();
    let open = |base: &str, endpoint: &str, body: Value| {
        invoke(
            &main,
            "ollama_open",
            json!({ "baseUrl": base, "endpoint": endpoint, "body": body }),
        )
    };
    assert!(open("http://user:pw@localhost:11434", "tags", Value::Null).is_err());
    assert!(open("http://localhost:11434", "../admin", Value::Null).is_err());
    assert!(open("http://localhost:11434", "tags", json!({})).is_err());
}

#[test]
fn cancelling_while_the_status_is_pending_closes_the_connection() {
    let server = serve(vec![("/api/chat", vec![Part::Hold])]);
    let (_app, main, _other) = windows();
    let rid = open(&main, &server.base, "chat", json!({ "model": "m" }));

    let sending = std::thread::spawn({
        let (main, rid) = (main.clone(), rid.clone());
        move || send(&main, &rid)
    });
    server
        .requests
        .recv_timeout(WAIT)
        .expect("the request arrives");
    invoke(&main, "ollama_cancel", json!({ "rid": rid })).unwrap();

    // Checked before joining: a send the cancel missed would never return.
    server
        .closed
        .recv_timeout(WAIT)
        .expect("the server sees the connection close");
    assert_eq!(sending.join().unwrap(), Err(json!("cancelled")));
}

#[test]
fn cancelling_while_a_read_is_pending_closes_the_connection() {
    let server = serve(vec![(
        "/api/chat",
        vec![Part::Head(200, None), Part::Chunk("{}\n"), Part::Hold],
    )]);
    let (_app, main, _other) = windows();
    let rid = open(&main, &server.base, "chat", json!({ "model": "m" }));
    assert_eq!(send(&main, &rid), Ok(json!(200)));
    assert_eq!(read(&main, &rid).unwrap(), b"{}\n");

    let reading = std::thread::spawn({
        let (main, rid) = (main.clone(), rid.clone());
        move || read(&main, &rid)
    });
    // Give the read time to wait on a server that sends nothing more. Should
    // the cancel still land first, the read fails and the connection closes
    // all the same.
    std::thread::sleep(Duration::from_millis(100));
    invoke(&main, "ollama_cancel", json!({ "rid": rid })).unwrap();

    server
        .closed
        .recv_timeout(WAIT)
        .expect("the server sees the connection close");
    assert!(reading.join().unwrap().is_err());
}
