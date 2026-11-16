use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;

use serde_json::{json, Value};
use tauri::ipc::InvokeResponseBody;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{WebviewWindow, WebviewWindowBuilder};

use super::*;

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

/// What a route answers: a status, and a body sent one chunk per entry.
struct Reply {
    status: u16,
    location: Option<&'static str>,
    chunks: Vec<&'static str>,
}

fn reply(status: u16, chunks: Vec<&'static str>) -> Reply {
    Reply {
        status,
        location: None,
        chunks,
    }
}

/// A loopback HTTP server answering each request from its path (a path with
/// no route gets a 404), and reporting every request it read.
fn serve(routes: Vec<(&'static str, Reply)>) -> (String, mpsc::Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (seen, received) = mpsc::channel();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut reader = BufReader::new(&stream);
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
            let route = routes.iter().find(|(route, _)| *route == path);
            let _ = seen.send(Seen {
                method,
                path,
                headers,
                body: String::from_utf8_lossy(&body).into_owned(),
            });
            let mut out = &stream;
            let Some((_, reply)) = route else {
                let _ = out.write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
                continue;
            };
            let location = reply
                .location
                .map_or(String::new(), |to| format!("Location: {to}\r\n"));
            let _ = write!(
                out,
                "HTTP/1.1 {} Reply\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n{location}\r\n",
                reply.status
            );
            for chunk in &reply.chunks {
                let _ = write!(out, "{:x}\r\n{chunk}\r\n", chunk.len());
                let _ = out.flush();
            }
            let _ = out.write_all(b"0\r\n\r\n");
        }
    });
    (base, received)
}

/// A loopback URL nothing listens on.
fn closed_port() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    format!("http://{}", listener.local_addr().unwrap())
}

async fn read_to_end(response: reqwest::Response) -> String {
    let reply = OllamaReply(Mutex::new(response));
    let mut body = Vec::new();
    while let Some(chunk) = next_chunk(&reply).await.unwrap() {
        assert!(!chunk.is_empty(), "an empty chunk would read as the end");
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).unwrap()
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
fn a_base_url_that_could_move_the_path_is_refused() {
    let cases = [
        // No scheme: `localhost` parses as one.
        ("localhost:11434", "http:// or https://"),
        ("file:///C:/Windows/win.ini", "http:// or https://"),
        ("ftp://box.lan", "http:// or https://"),
        ("javascript:alert(1)", "http:// or https://"),
        ("http://box.lan/admin?x=", "query or fragment"),
        ("http://box.lan/?", "query or fragment"),
        ("http://box.lan/#", "query or fragment"),
        ("", "not a valid URL"),
        ("http://", "not a valid URL"),
    ];
    for (base, expected) in cases {
        let err = endpoint_url(base, OllamaEndpoint::Chat).unwrap_err();
        assert!(err.contains(expected), "{base}: {err}");
    }
}

#[tokio::test]
async fn a_chat_posts_json_without_an_origin_and_streams_the_reply() {
    let chunks = vec![
        "{\"message\":{\"content\":\"Hel\"}}\n",
        "{\"message\":{\"content\":\"lo\"},",
        "\"done\":true}\n",
    ];
    let (base, seen) = serve(vec![("/api/chat", reply(200, chunks.clone()))]);
    let body = json!({ "model": "llama3.2", "stream": true });

    let response = send(&base, OllamaEndpoint::Chat, Some(body.clone()))
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(read_to_end(response).await, chunks.concat());

    let request = seen.recv().unwrap();
    assert_eq!(request.method, "POST");
    assert_eq!(request.path, "/api/chat");
    assert_eq!(request.header("content-type"), Some("application/json"));
    // The point of the backend route: Ollama refuses `http://tauri.localhost`.
    assert_eq!(request.header("origin"), None);
    assert_eq!(serde_json::from_str::<Value>(&request.body).unwrap(), body);
}

#[tokio::test]
async fn the_model_list_is_a_get_below_the_path_prefix() {
    let (base, seen) = serve(vec![(
        "/proxy/api/tags",
        reply(200, vec!["{\"models\":[]}"]),
    )]);

    let response = send(&format!("{base}/proxy/"), OllamaEndpoint::Tags, None)
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(read_to_end(response).await, "{\"models\":[]}");

    let request = seen.recv().unwrap();
    assert_eq!(
        (request.method.as_str(), request.body.as_str()),
        ("GET", "")
    );
}

#[tokio::test]
async fn an_error_status_comes_back_with_its_body() {
    let (base, _seen) = serve(vec![(
        "/api/chat",
        reply(400, vec!["{\"error\":\"llama3.2 does not support tools\"}"]),
    )]);

    let response = send(&base, OllamaEndpoint::Chat, Some(json!({})))
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 400);
    assert!(read_to_end(response)
        .await
        .contains("does not support tools"));
}

#[tokio::test]
async fn a_redirect_is_handed_back_not_followed() {
    let redirect = Reply {
        status: 302,
        location: Some("/elsewhere"),
        chunks: Vec::new(),
    };
    let (base, seen) = serve(vec![
        ("/api/tags", redirect),
        ("/elsewhere", reply(200, vec!["secret"])),
    ]);

    let response = send(&base, OllamaEndpoint::Tags, None).await.unwrap();
    assert_eq!(response.status().as_u16(), 302);
    assert_eq!(read_to_end(response).await, "");
    assert_eq!(seen.recv().unwrap().path, "/api/tags");
    assert!(seen.try_recv().is_err(), "the redirect was followed");
}

#[tokio::test]
async fn a_server_that_is_not_running_names_the_cause() {
    let err = send(&closed_port(), OllamaEndpoint::Tags, None)
        .await
        .unwrap_err();
    // The innermost cause (the OS's "connection refused"), not reqwest's
    // "error sending request for url (...)".
    assert!(!err.is_empty());
    assert!(!err.contains("error sending request"), "{err}");
}

#[tokio::test]
async fn a_body_that_does_not_fit_the_endpoint_is_refused_unsent() {
    let (base, seen) = serve(Vec::new());
    let err = send(&base, OllamaEndpoint::Chat, None).await.unwrap_err();
    assert_eq!(err, "a chat request needs a body");
    let err = send(&base, OllamaEndpoint::Tags, Some(json!({})))
        .await
        .unwrap_err();
    assert_eq!(err, "a model list request takes no body");
    assert!(seen.try_recv().is_err());
}

fn invoke(
    webview: &WebviewWindow<tauri::test::MockRuntime>,
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

fn bytes(response: InvokeResponseBody) -> Vec<u8> {
    match response {
        InvokeResponseBody::Raw(bytes) => bytes,
        InvokeResponseBody::Json(json) => panic!("expected raw bytes, got {json}"),
    }
}

// An async command's IPC marshalling runs only for a real IPC message, and the
// resource table belongs to the webview, so the reply's lifecycle is driven
// through two mock windows.
#[test]
fn a_reply_is_read_and_cancelled_only_through_the_webview_that_sent_it() {
    let (base, _seen) = serve(vec![
        ("/api/tags", reply(200, vec!["{\"models\":", "[]}"])),
        ("/api/chat", reply(200, vec!["{}\n", "{}\n"])),
    ]);
    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![
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
    let send_to = |webview, endpoint: &str, body: Value| {
        let head: Value = invoke(
            webview,
            "ollama_send",
            json!({ "baseUrl": base, "endpoint": endpoint, "body": body }),
        )
        .expect("send succeeds")
        .deserialize()
        .unwrap();
        assert_eq!(head["status"], 200);
        head["rid"].clone()
    };

    let rid = send_to(&main, "tags", Value::Null);
    // Another window neither reads nor cancels it.
    assert!(invoke(&other, "ollama_read", json!({ "rid": rid })).is_err());
    invoke(&other, "ollama_cancel", json!({ "rid": rid })).unwrap();
    let mut body = Vec::new();
    loop {
        let chunk = bytes(invoke(&main, "ollama_read", json!({ "rid": rid })).unwrap());
        if chunk.is_empty() {
            break;
        }
        body.extend(chunk);
    }
    assert_eq!(body, b"{\"models\":[]}");
    // The end closed it.
    assert!(invoke(&main, "ollama_read", json!({ "rid": rid })).is_err());

    let rid = send_to(&main, "chat", json!({ "model": "m" }));
    invoke(&main, "ollama_cancel", json!({ "rid": rid })).unwrap();
    assert!(invoke(&main, "ollama_read", json!({ "rid": rid })).is_err());
    // Cancelling twice is not an error.
    invoke(&main, "ollama_cancel", json!({ "rid": rid })).unwrap();

    let refused = invoke(
        &main,
        "ollama_send",
        json!({ "baseUrl": closed_port(), "endpoint": "tags", "body": null }),
    );
    assert!(refused.is_err());
    let refused = invoke(
        &main,
        "ollama_send",
        json!({ "baseUrl": base, "endpoint": "../admin", "body": null }),
    );
    assert!(refused.is_err(), "an endpoint outside the enum");
}
