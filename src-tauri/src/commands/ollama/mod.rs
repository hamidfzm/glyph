//! The assistant's requests to an Ollama server, made here rather than from the
//! webview: a page request carries the page's origin, and Ollama's default
//! allowed origins refuse `http://tauri.localhost` (Windows, Android).
//!
//! The renderer names the server and one of two endpoints; the method, path
//! and headers are fixed here and a redirect is not followed. A request lives
//! in the calling webview's resource table from `ollama_open` until its body
//! ends or `ollama_cancel` drops it, so one window cannot touch another's.

use std::future::{poll_fn, Future};
use std::pin::pin;
use std::task::Poll;

use serde::Deserialize;
use tauri::async_runtime::Mutex;
use tauri::ipc::Response;
use tauri::{Manager, ResourceId, Runtime, Webview};
use tauri_plugin_http::reqwest::{self, header::CONTENT_TYPE, RequestBuilder, Url};
use tokio::sync::Notify;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OllamaEndpoint {
    Chat,
    Tags,
}

impl OllamaEndpoint {
    fn path(self) -> &'static str {
        match self {
            Self::Chat => "/api/chat",
            Self::Tags => "/api/tags",
        }
    }
}

enum Phase {
    Unsent(RequestBuilder),
    Open(reqwest::Response),
    Spent,
}

struct OllamaRequest {
    phase: Mutex<Phase>,
    cancelled: Notify,
}

impl tauri::Resource for OllamaRequest {}

/// A base URL may carry a path prefix (a reverse proxy), but not a query or
/// fragment, where the fixed path would land, nor credentials, which reqwest
/// would turn into an `Authorization` header.
fn endpoint_url(base: &str, endpoint: OllamaEndpoint) -> Result<Url, String> {
    let mut url = Url::parse(base.trim()).map_err(|e| format!("not a valid URL: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("the URL must start with http:// or https://".into());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("the URL must not have a query or fragment".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("the URL must not carry a user name or password".into());
    }
    let path = format!("{}{}", url.path().trim_end_matches('/'), endpoint.path());
    url.set_path(&path);
    Ok(url)
}

/// The innermost cause ("connection refused"); reqwest's own message only names the request.
fn root_cause(err: &(dyn std::error::Error + 'static)) -> String {
    let mut cause = err;
    while let Some(source) = cause.source() {
        cause = source;
    }
    cause.to_string()
}

fn build_request(
    base: &str,
    endpoint: OllamaEndpoint,
    body: Option<serde_json::Value>,
) -> Result<RequestBuilder, String> {
    let url = endpoint_url(base, endpoint)?;
    // The page reached a local server directly; reqwest would send every host
    // through a system proxy.
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("cannot build the HTTP client: {e}"))?;
    match (endpoint, body) {
        (OllamaEndpoint::Chat, Some(body)) => Ok(client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string())),
        (OllamaEndpoint::Tags, None) => Ok(client.get(url)),
        (OllamaEndpoint::Chat, None) => Err("a chat request needs a body".into()),
        (OllamaEndpoint::Tags, Some(_)) => Err("a model list request takes no body".into()),
    }
}

impl OllamaRequest {
    fn new(request: RequestBuilder) -> Self {
        Self {
            phase: Mutex::new(Phase::Unsent(request)),
            cancelled: Notify::new(),
        }
    }

    /// `work`, unless the request is cancelled first. Dropping `work` drops
    /// the connection it holds, which is what stops Ollama generating.
    async fn unless_cancelled<T>(
        &self,
        work: impl Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        let mut work = pin!(work);
        let mut cancelled = pin!(self.cancelled.notified());
        poll_fn(|cx| {
            if cancelled.as_mut().poll(cx).is_ready() {
                return Poll::Ready(Err("cancelled".to_string()));
            }
            work.as_mut().poll(cx)
        })
        .await
    }

    async fn send(&self) -> Result<u16, String> {
        let mut phase = self.phase.lock().await;
        let Phase::Unsent(request) = std::mem::replace(&mut *phase, Phase::Spent) else {
            return Err("the request was already sent".into());
        };
        let response = self
            .unless_cancelled(async { request.send().await.map_err(|e| root_cause(&e)) })
            .await?;
        let status = response.status().as_u16();
        *phase = Phase::Open(response);
        Ok(status)
    }

    /// Never an empty chunk: the renderer reads one as the end of the body.
    async fn next_chunk(&self) -> Result<Option<Vec<u8>>, String> {
        let mut phase = self.phase.lock().await;
        let Phase::Open(response) = &mut *phase else {
            return Err("the request has no reply to read".into());
        };
        self.unless_cancelled(async {
            loop {
                match response.chunk().await.map_err(|e| root_cause(&e))? {
                    Some(chunk) if chunk.is_empty() => continue,
                    chunk => return Ok(chunk.map(|bytes| bytes.to_vec())),
                }
            }
        })
        .await
    }
}

fn request<R: Runtime>(
    webview: &Webview<R>,
    rid: ResourceId,
) -> Result<std::sync::Arc<OllamaRequest>, String> {
    webview
        .resources_table()
        .get::<OllamaRequest>(rid)
        .map_err(|e| e.to_string())
}

fn forget<R: Runtime>(webview: &Webview<R>, rid: ResourceId) {
    let _ = webview.resources_table().take::<OllamaRequest>(rid);
}

/// Checks the request and holds it unsent. An error means the URL is refused.
#[tauri::command]
pub fn ollama_open<R: Runtime>(
    webview: Webview<R>,
    base_url: String,
    endpoint: OllamaEndpoint,
    body: Option<serde_json::Value>,
) -> Result<ResourceId, String> {
    let request = build_request(&base_url, endpoint, body)?;
    Ok(webview.resources_table().add(OllamaRequest::new(request)))
}

/// Sends the request and waits for its status. An error means no reply came.
#[tauri::command]
pub async fn ollama_send<R: Runtime>(webview: Webview<R>, rid: ResourceId) -> Result<u16, String> {
    let status = request(&webview, rid)?.send().await;
    if status.is_err() {
        forget(&webview, rid);
    }
    status
}

/// The next chunk of the body as raw bytes; an empty buffer is its end. The
/// end, or a failed read, closes the request.
#[tauri::command]
pub async fn ollama_read<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<Response, String> {
    let chunk = request(&webview, rid)?.next_chunk().await;
    if !matches!(chunk, Ok(Some(_))) {
        forget(&webview, rid);
    }
    Ok(Response::new(chunk?.unwrap_or_default()))
}

/// Ends a pending send or read at once. A request already gone is not an error.
#[tauri::command]
pub fn ollama_cancel<R: Runtime>(webview: Webview<R>, rid: ResourceId) -> Result<(), String> {
    if let Ok(request) = webview.resources_table().take::<OllamaRequest>(rid) {
        request.cancelled.notify_one();
    }
    Ok(())
}

#[cfg(test)]
mod tests;
