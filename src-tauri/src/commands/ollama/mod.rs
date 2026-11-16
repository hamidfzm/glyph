//! The assistant's requests to an Ollama server, made here rather than from the
//! webview: a page request carries the page's origin, and Ollama's default
//! allowed origins refuse `http://tauri.localhost` (Windows, Android).
//!
//! The renderer names the server and one of two endpoints; the method, path
//! and headers are fixed here and a redirect is not followed. A reply is pulled
//! one chunk at a time from the calling webview's resource table, so one
//! window cannot read or cancel another's.

use serde::{Deserialize, Serialize};
use tauri::async_runtime::Mutex;
use tauri::ipc::Response;
use tauri::{Manager, ResourceId, Runtime, Webview};
use tauri_plugin_http::reqwest::{self, header::CONTENT_TYPE, Url};

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaHead {
    rid: ResourceId,
    status: u16,
}

struct OllamaReply(Mutex<reqwest::Response>);

impl tauri::Resource for OllamaReply {}

/// A base URL may carry a path prefix (a reverse proxy), but not a query or
/// fragment: the fixed path would land inside it.
fn endpoint_url(base: &str, endpoint: OllamaEndpoint) -> Result<Url, String> {
    let mut url = Url::parse(base.trim()).map_err(|e| format!("not a valid URL: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("the URL must start with http:// or https://".into());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("the URL must not have a query or fragment".into());
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

async fn send(
    base: &str,
    endpoint: OllamaEndpoint,
    body: Option<serde_json::Value>,
) -> Result<reqwest::Response, String> {
    let url = endpoint_url(base, endpoint)?;
    // A system proxy would take localhost requests the page itself sent direct.
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("cannot build the HTTP client: {e}"))?;
    let request = match (endpoint, body) {
        (OllamaEndpoint::Chat, Some(body)) => client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string()),
        (OllamaEndpoint::Tags, None) => client.get(url),
        (OllamaEndpoint::Chat, None) => return Err("a chat request needs a body".into()),
        (OllamaEndpoint::Tags, Some(_)) => return Err("a model list request takes no body".into()),
    };
    request.send().await.map_err(|e| root_cause(&e))
}

/// Never an empty chunk: the renderer reads one as the end of the body.
async fn next_chunk(reply: &OllamaReply) -> Result<Option<Vec<u8>>, String> {
    let mut response = reply.0.lock().await;
    loop {
        match response.chunk().await.map_err(|e| root_cause(&e))? {
            Some(chunk) if chunk.is_empty() => continue,
            chunk => return Ok(chunk.map(|bytes| bytes.to_vec())),
        }
    }
}

/// An error means no reply: the URL is refused or the connection failed.
#[tauri::command]
pub async fn ollama_send<R: Runtime>(
    webview: Webview<R>,
    base_url: String,
    endpoint: OllamaEndpoint,
    body: Option<serde_json::Value>,
) -> Result<OllamaHead, String> {
    let response = send(&base_url, endpoint, body).await?;
    let status = response.status().as_u16();
    let rid = webview
        .resources_table()
        .add(OllamaReply(Mutex::new(response)));
    Ok(OllamaHead { rid, status })
}

/// The next chunk of a reply's body as raw bytes; an empty buffer is its end.
/// The end, or a failed read, closes the reply.
#[tauri::command]
pub async fn ollama_read<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<Response, String> {
    let reply = webview
        .resources_table()
        .get::<OllamaReply>(rid)
        .map_err(|e| e.to_string())?;
    let chunk = next_chunk(&reply).await;
    if !matches!(chunk, Ok(Some(_))) {
        let _ = webview.resources_table().close(rid);
    }
    Ok(Response::new(chunk?.unwrap_or_default()))
}

/// Dropping the reply closes its connection, which stops Ollama generating.
#[tauri::command]
pub fn ollama_cancel<R: Runtime>(webview: Webview<R>, rid: ResourceId) -> Result<(), String> {
    let _ = webview.resources_table().close(rid);
    Ok(())
}

#[cfg(test)]
mod tests;
