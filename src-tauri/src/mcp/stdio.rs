//! The MCP stdio transport: newline-delimited JSON-RPC 2.0 on stdin and
//! stdout. This is the only code on the `glyph mcp` path that writes to
//! stdout; diagnostics go to stderr, because one stray line corrupts the
//! stream.

use std::io::{self, BufRead, Read, Write};

use serde_json::{json, Value};

use super::registry::{self, ToolError};

/// Newest first. A client asking for one of these gets it back; any other
/// request gets the newest, and the client decides whether it speaks that.
const PROTOCOL_VERSIONS: [&str; 2] = ["2025-11-25", "2025-06-18"];

/// Far beyond any tool call; bounds what a client can make this process hold.
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;

const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;

const INSTRUCTIONS: &str = "Glyph's index of markdown vaults: wikilinks resolved the way the app resolves them, backlinks, tags, headings, the link graph and canvas boards. A note reference (`ref`) is a wikilink target such as `Note`, `Folder/Note` or `Note#Heading`, a path relative to the vault, or an absolute path. Call vault_context first to see which vaults are open.";

/// Answer requests from `input` until it ends. `call` runs one tool; this loop
/// owns everything else about the protocol.
pub(super) fn serve(
    mut input: impl BufRead,
    mut output: impl Write,
    mut call: impl FnMut(&str, Value) -> Result<Value, ToolError>,
) -> io::Result<()> {
    let mut line = Vec::new();
    loop {
        line.clear();
        let read = (&mut input)
            .take(MAX_MESSAGE_BYTES as u64 + 1)
            .read_until(b'\n', &mut line)?;
        if read == 0 {
            return Ok(());
        }
        if line.len() > MAX_MESSAGE_BYTES && line.last() != Some(&b'\n') {
            skip_line(&mut input)?;
            let reply = error(Value::Null, INVALID_REQUEST, "message is larger than 1 MiB");
            send(&mut output, &reply)?;
            continue;
        }
        let text = String::from_utf8_lossy(&line);
        if text.trim().is_empty() {
            continue;
        }
        if let Some(reply) = respond(text.trim(), &mut call) {
            send(&mut output, &reply)?;
        }
    }
}

/// Drop the rest of an oversized line without holding it.
fn skip_line(input: &mut impl BufRead) -> io::Result<()> {
    loop {
        let buffer = input.fill_buf()?;
        if buffer.is_empty() {
            return Ok(());
        }
        if let Some(end) = buffer.iter().position(|&byte| byte == b'\n') {
            input.consume(end + 1);
            return Ok(());
        }
        let length = buffer.len();
        input.consume(length);
    }
}

fn send(output: &mut impl Write, message: &Value) -> io::Result<()> {
    // Compact JSON escapes every newline inside a string, so one message is
    // one line.
    serde_json::to_writer(&mut *output, message)?;
    output.write_all(b"\n")?;
    output.flush()
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// The reply to one message, or `None` for a notification or a response,
/// which never get one.
fn respond(
    text: &str,
    call: &mut impl FnMut(&str, Value) -> Result<Value, ToolError>,
) -> Option<Value> {
    let Ok(message) = serde_json::from_str::<Value>(text) else {
        return Some(error(Value::Null, PARSE_ERROR, "Parse error"));
    };
    let Some(object) = message.as_object() else {
        let reason = if message.is_array() {
            "batches are not supported"
        } else {
            "a request is a JSON object"
        };
        return Some(error(Value::Null, INVALID_REQUEST, reason));
    };
    let id = object.get("id")?.clone();
    if object.contains_key("result") || object.contains_key("error") {
        return None;
    }
    let usable_id = id.is_string() || id.is_number();
    if !usable_id {
        return Some(error(
            Value::Null,
            INVALID_REQUEST,
            "id must be a string or a number",
        ));
    }
    if object.get("jsonrpc") != Some(&json!("2.0")) {
        return Some(error(id, INVALID_REQUEST, "jsonrpc must be \"2.0\""));
    }
    let Some(method) = object.get("method").and_then(Value::as_str) else {
        return Some(error(id, INVALID_REQUEST, "method must be a string"));
    };
    let params = object.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => Ok(initialize(&params)),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({
            "tools": registry::list().map(|tool| tool.describe()).collect::<Vec<_>>()
        })),
        "tools/call" => call_tool(&params, call),
        _ => Err((METHOD_NOT_FOUND, format!("Method not found: {method}"))),
    };
    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => error(id, code, &message),
    })
}

fn initialize(params: &Value) -> Value {
    let requested = params.get("protocolVersion").and_then(Value::as_str);
    let version = PROTOCOL_VERSIONS
        .into_iter()
        .find(|version| Some(*version) == requested)
        .unwrap_or(PROTOCOL_VERSIONS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": "glyph", "title": "Glyph", "version": env!("CARGO_PKG_VERSION") },
        "instructions": INSTRUCTIONS,
    })
}

/// A tool that refuses is a result the model reads, marked `isError`, so it
/// can correct the call. Only a tool that does not exist is a protocol error.
fn call_tool(
    params: &Value,
    call: &mut impl FnMut(&str, Value) -> Result<Value, ToolError>,
) -> Result<Value, (i64, String)> {
    let Some(name) = params.get("name").and_then(Value::as_str) else {
        return Err((INVALID_PARAMS, "tools/call needs a tool name".to_string()));
    };
    let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
    match call(name, arguments) {
        Ok(value) => Ok(json!({ "content": [{ "type": "text", "text": value.to_string() }] })),
        Err(ToolError::Unknown(name)) => Err((INVALID_PARAMS, format!("Unknown tool: {name}"))),
        Err(ToolError::Failed(message)) => Ok(json!({
            "content": [{ "type": "text", "text": message }],
            "isError": true,
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feed `input` through the loop with a tool that echoes its arguments
    /// for `echo`, fails for `fail`, and does not exist otherwise. Every line
    /// written must parse as a JSON-RPC message; they come back parsed.
    fn exchange(input: &str) -> Vec<Value> {
        let mut output = Vec::new();
        serve(input.as_bytes(), &mut output, |name, args| match name {
            "echo" => Ok(args),
            "fail" => Err(ToolError::Failed("refused".to_string())),
            _ => Err(ToolError::Unknown(name.to_string())),
        })
        .unwrap();
        let text = String::from_utf8(output).unwrap();
        text.lines()
            .map(|line| {
                let message: Value = serde_json::from_str(line)
                    .unwrap_or_else(|_| panic!("stdout carried a non-message: {line}"));
                assert_eq!(message["jsonrpc"], "2.0", "{line}");
                message
            })
            .collect()
    }

    fn request(id: u64, method: &str, params: Value) -> String {
        format!(
            "{}\n",
            json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
        )
    }

    #[test]
    fn the_handshake_negotiates_a_version_the_server_speaks() {
        let replies = exchange(&format!(
            "{}{}{}",
            request(1, "initialize", json!({ "protocolVersion": "2025-06-18" })),
            request(2, "initialize", json!({ "protocolVersion": "2026-07-28" })),
            request(3, "initialize", json!({})),
        ));
        assert_eq!(replies[0]["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(replies[1]["result"]["protocolVersion"], "2025-11-25");
        assert_eq!(replies[2]["result"]["protocolVersion"], "2025-11-25");
        assert_eq!(replies[0]["id"], 1);
        assert_eq!(replies[0]["result"]["serverInfo"]["name"], "glyph");
        assert!(replies[0]["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn notifications_and_responses_get_no_reply() {
        let replies = exchange(concat!(
            "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n",
            "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/cancelled\",\"params\":{\"requestId\":1}}\n",
            "{\"jsonrpc\":\"2.0\",\"method\":\"no/such/notification\"}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":9,\"result\":{}}\n",
            "\n   \n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n",
        ));
        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0]["id"], 1);
        assert_eq!(replies[0]["result"], json!({}));
    }

    #[test]
    fn tools_are_listed_with_their_schemas() {
        let replies = exchange(&request(1, "tools/list", Value::Null));
        let tools = replies[0]["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), registry::list().count());
        for tool in tools {
            assert!(tool["name"].is_string());
            assert_eq!(tool["inputSchema"]["type"], "object", "{}", tool["name"]);
            assert!(tool["annotations"]["readOnlyHint"].is_boolean());
        }
    }

    #[test]
    fn a_tool_result_is_text_and_a_refusal_is_an_error_result() {
        let replies = exchange(&format!(
            "{}{}{}{}",
            request(
                1,
                "tools/call",
                json!({ "name": "echo", "arguments": { "a": "line\nbreak" } })
            ),
            request(2, "tools/call", json!({ "name": "fail" })),
            request(3, "tools/call", json!({ "name": "nope" })),
            request(4, "tools/call", json!({ "arguments": {} })),
        ));
        let text = replies[0]["result"]["content"][0]["text"].as_str().unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(text).unwrap(),
            json!({ "a": "line\nbreak" })
        );
        assert!(replies[0]["result"].get("isError").is_none());
        assert_eq!(replies[1]["result"]["isError"], true);
        assert_eq!(replies[1]["result"]["content"][0]["text"], "refused");
        assert_eq!(replies[2]["error"]["code"], INVALID_PARAMS);
        assert_eq!(replies[3]["error"]["code"], INVALID_PARAMS);
    }

    #[test]
    fn malformed_messages_are_answered_and_the_loop_goes_on() {
        let replies = exchange(concat!(
            "{not json\n",
            "[{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}]\n",
            "42\n",
            "{\"jsonrpc\":\"2.0\",\"id\":null,\"method\":\"ping\"}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":{\"x\":1},\"method\":\"ping\"}\n",
            "{\"jsonrpc\":\"1.0\",\"id\":2,\"method\":\"ping\"}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":7}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"resources/list\"}\n",
            "\u{fffd}\u{fffd}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":\"last\",\"method\":\"ping\"}\n",
        ));
        let codes: Vec<i64> = replies
            .iter()
            .filter_map(|reply| reply["error"]["code"].as_i64())
            .collect();
        assert_eq!(
            codes,
            [
                PARSE_ERROR,
                INVALID_REQUEST,
                INVALID_REQUEST,
                INVALID_REQUEST,
                INVALID_REQUEST,
                INVALID_REQUEST,
                INVALID_REQUEST,
                METHOD_NOT_FOUND,
                PARSE_ERROR,
            ]
        );
        assert_eq!(replies.last().unwrap()["id"], "last");
    }

    #[test]
    fn an_oversized_line_is_refused_without_ending_the_session() {
        let huge = format!(
            "{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\",\"pad\":\"{}\"}}\n",
            "x".repeat(MAX_MESSAGE_BYTES + 10)
        );
        let replies = exchange(&format!("{huge}{}", request(2, "ping", Value::Null)));
        assert_eq!(replies.len(), 2);
        assert_eq!(replies[0]["error"]["code"], INVALID_REQUEST);
        assert_eq!(replies[1]["id"], 2);
    }

    #[test]
    fn a_line_at_the_limit_is_still_read() {
        let base = request(
            1,
            "tools/call",
            json!({ "name": "echo", "arguments": { "pad": "" } }),
        );
        let pad = "y".repeat(MAX_MESSAGE_BYTES + 1 - base.len());
        let line = request(
            1,
            "tools/call",
            json!({ "name": "echo", "arguments": { "pad": pad } }),
        );
        assert_eq!(
            line.len(),
            MAX_MESSAGE_BYTES + 1,
            "the limit plus its newline"
        );
        let replies = exchange(&line);
        assert!(replies[0]["result"].is_object(), "{}", replies[0]);
    }

    #[test]
    fn input_that_ends_mid_line_still_gets_an_answer() {
        let replies = exchange("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}");
        assert_eq!(replies[0]["id"], 1);
    }

    #[test]
    fn an_oversized_line_at_the_end_of_input_is_skipped_in_pieces() {
        // A small buffer makes the skip walk pieces with no newline in them,
        // and the input ends before one arrives.
        let huge = format!("{{\"pad\":\"{}\"", "z".repeat(MAX_MESSAGE_BYTES + 100));
        let input = std::io::BufReader::with_capacity(64, huge.as_bytes());
        let mut output = Vec::new();
        serve(input, &mut output, |_, _| Ok(Value::Null)).unwrap();
        let text = String::from_utf8(output).unwrap();
        assert_eq!(text.lines().count(), 1, "one refusal, then the end: {text}");
    }
}
