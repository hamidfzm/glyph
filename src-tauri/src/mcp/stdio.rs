//! The MCP stdio transport: newline-delimited JSON-RPC 2.0 on stdin and
//! stdout. This is the only code on the `glyph mcp` path that writes to
//! stdout; diagnostics go to stderr, because one stray line corrupts the
//! stream.

use std::collections::VecDeque;
use std::io::{self, BufRead, Read, Write};

use serde_json::{json, Value};

use super::registry::{self, ToolError};

/// Newest first. A client asking for one of these gets it back; any other
/// request gets the newest, and the client decides whether it speaks that.
const PROTOCOL_VERSIONS: [&str; 2] = ["2025-11-25", "2025-06-18"];

/// Far beyond any tool call; bounds what a client can make this process hold.
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;

/// Messages kept while a question is out. A client that sends more is not
/// waiting on the answer.
const MAX_HELD: usize = 64;

const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;

const INSTRUCTIONS: &str = "Glyph's index of markdown vaults: wikilinks resolved the way the app resolves them, backlinks, tags, headings, the link graph and canvas boards. A note reference (`ref`) is a wikilink target such as `Note`, `Folder/Note` or `Note#Heading`, a path relative to the vault, or an absolute path. Call vault_context first to see which vaults are open. When it reports canAskForVaults, a folder that is not listed can be passed by its absolute path as `vault`, and the user is asked to allow it.";

/// Puts a question to the user in the middle of a call.
pub(super) trait Ask {
    /// Whether the client declared it can put a question to the user.
    fn can_ask(&self) -> bool;
    /// Ask `message` as a yes-or-no question: Ok when the user accepts, else
    /// why not, in words for the model.
    fn confirm(&mut self, message: &str) -> Result<(), String>;
}

enum Incoming {
    Message(Value),
    /// A line that is not JSON.
    Malformed,
    /// A line past the limit, already skipped.
    Oversized,
}

struct Client<R, W> {
    input: R,
    output: W,
    /// Whether the client declared it can show the user a form.
    can_ask: bool,
    /// The `tools/call` in progress, which a cancellation may name.
    call_id: Value,
    /// Whether the client gave up the call in progress.
    cancelled: bool,
    asked: u64,
    /// What arrived while a question was out, handled once the call returns.
    held: VecDeque<Incoming>,
}

/// Answer requests from `input` until it ends. `call` runs one tool; this loop
/// owns everything else about the protocol.
pub(super) fn serve(
    input: impl BufRead,
    output: impl Write,
    mut call: impl FnMut(&str, Value, &mut dyn Ask) -> Result<String, ToolError>,
) -> io::Result<()> {
    let mut client = Client {
        input,
        output,
        can_ask: false,
        call_id: Value::Null,
        cancelled: false,
        asked: 0,
        held: VecDeque::new(),
    };
    loop {
        let next = match client.held.pop_front() {
            Some(held) => Some(held),
            None => read(&mut client.input)?,
        };
        let reply = match next {
            None => return Ok(()),
            Some(Incoming::Oversized) => Some(error(
                Value::Null,
                INVALID_REQUEST,
                "message is larger than 1 MiB",
            )),
            Some(Incoming::Malformed) => Some(error(Value::Null, PARSE_ERROR, "Parse error")),
            Some(Incoming::Message(message)) => respond(&message, &mut client, &mut call),
        };
        if let Some(reply) = reply {
            send(&mut client.output, &reply)?;
        }
    }
}

/// The next line that is not blank, parsed, or `None` once the input ends.
fn read(input: &mut impl BufRead) -> io::Result<Option<Incoming>> {
    let mut line = Vec::new();
    loop {
        line.clear();
        let read = input
            .by_ref()
            .take(MAX_MESSAGE_BYTES as u64 + 1)
            .read_until(b'\n', &mut line)?;
        if read == 0 {
            return Ok(None);
        }
        if line.len() > MAX_MESSAGE_BYTES && line.last() != Some(&b'\n') {
            skip_line(input)?;
            return Ok(Some(Incoming::Oversized));
        }
        let text = String::from_utf8_lossy(&line);
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        return Ok(Some(match serde_json::from_str(text) {
            Ok(message) => Incoming::Message(message),
            Err(_) => Incoming::Malformed,
        }));
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
fn respond<R: BufRead, W: Write>(
    message: &Value,
    client: &mut Client<R, W>,
    call: &mut impl FnMut(&str, Value, &mut dyn Ask) -> Result<String, ToolError>,
) -> Option<Value> {
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
        "initialize" => {
            client.can_ask = can_ask(&params);
            Ok(initialize(&params))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({
            "tools": registry::list().map(|tool| tool.describe()).collect::<Vec<_>>()
        })),
        "tools/call" => {
            client.call_id = id.clone();
            let result = call_tool(&params, client, call);
            // The client gave the call up, so it gets no answer.
            if std::mem::take(&mut client.cancelled) {
                return None;
            }
            result
        }
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
fn call_tool<R: BufRead, W: Write>(
    params: &Value,
    client: &mut Client<R, W>,
    call: &mut impl FnMut(&str, Value, &mut dyn Ask) -> Result<String, ToolError>,
) -> Result<Value, (i64, String)> {
    let Some(name) = params.get("name").and_then(Value::as_str) else {
        return Err((INVALID_PARAMS, "tools/call needs a tool name".to_string()));
    };
    let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
    match call(name, arguments, client) {
        Ok(text) => Ok(json!({ "content": [{ "type": "text", "text": text }] })),
        Err(ToolError::Unknown(name)) => Err((INVALID_PARAMS, format!("Unknown tool: {name}"))),
        Err(ToolError::Failed(message)) => Ok(json!({
            "content": [{ "type": "text", "text": message }],
            "isError": true,
        })),
    }
}

/// Whether the client can show the user a form: it declared `elicitation`
/// empty, as 2025-06-18 does, or with `form`.
fn can_ask(params: &Value) -> bool {
    params["capabilities"]["elicitation"]
        .as_object()
        .is_some_and(|modes| modes.is_empty() || modes.contains_key("form"))
}

impl<R: BufRead, W: Write> Ask for Client<R, W> {
    fn can_ask(&self) -> bool {
        self.can_ask
    }

    fn confirm(&mut self, message: &str) -> Result<(), String> {
        if !self.can_ask {
            return Err("this client cannot ask the user".to_string());
        }
        // A call replayed from behind another may have been cancelled already.
        if self.held.iter().any(|held| cancels(held, &self.call_id)) {
            self.cancelled = true;
            return Err("the call was cancelled".to_string());
        }
        self.asked += 1;
        let id = json!(format!("glyph-ask-{}", self.asked));
        let question = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "elicitation/create",
            // Nothing to fill in: accepting is the answer.
            "params": { "message": message, "requestedSchema": { "type": "object", "properties": {} } },
        });
        let lost = |err: io::Error| format!("the client cannot be reached: {err}");
        send(&mut self.output, &question).map_err(lost)?;
        // Messages held for an earlier question are not this one's doing.
        let already_held = self.held.len();
        loop {
            let Some(incoming) = read(&mut self.input).map_err(lost)? else {
                return Err("the client closed the session".to_string());
            };
            if let Incoming::Message(message) = &incoming {
                let is_answer = message.get("id") == Some(&id) && message.get("method").is_none();
                if is_answer {
                    return answer(message);
                }
            }
            if cancels(&incoming, &self.call_id) {
                self.cancelled = true;
                self.withdraw(&id);
                return Err("the call was cancelled".to_string());
            }
            self.held.push_back(incoming);
            if self.held.len() - already_held > MAX_HELD {
                self.withdraw(&id);
                return Err("the client sent too much while the user decided".to_string());
            }
        }
    }
}

impl<R, W: Write> Client<R, W> {
    /// Tell the client a question no longer needs an answer, so it can take
    /// the prompt down.
    fn withdraw(&mut self, id: &Value) {
        let notice = json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": id } });
        let _ = send(&mut self.output, &notice);
    }
}

/// Whether `incoming` cancels the call `call_id`.
fn cancels(incoming: &Incoming, call_id: &Value) -> bool {
    let Incoming::Message(message) = incoming else {
        return false;
    };
    message["method"] == "notifications/cancelled" && message["params"]["requestId"] == *call_id
}

/// The user's answer, from the client's reply to a question.
fn answer(reply: &Value) -> Result<(), String> {
    if let Some(error) = reply.get("error") {
        let reason = error["message"].as_str().unwrap_or("no reason given");
        return Err(format!("the client could not ask the user: {reason}"));
    }
    match reply["result"]["action"].as_str() {
        Some("accept") => Ok(()),
        Some("decline") => Err("the user declined".to_string()),
        _ => Err("the user dismissed the question".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feed `input` through the loop with a tool that echoes its arguments
    /// for `echo`, asks the user for `ask`, fails for `fail`, and does not
    /// exist otherwise. Every line written must parse as a JSON-RPC message;
    /// they come back parsed.
    fn exchange(input: &str) -> Vec<Value> {
        let mut output = Vec::new();
        serve(
            input.as_bytes(),
            &mut output,
            |name, args, ask| match name {
                "echo" => Ok(args.to_string()),
                "ask" => ask
                    .confirm("May I?")
                    .map(|()| "\"allowed\"".to_string())
                    .map_err(ToolError::Failed),
                "fail" => Err(ToolError::Failed("refused".to_string())),
                _ => Err(ToolError::Unknown(name.to_string())),
            },
        )
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
        serve(input, &mut output, |_, _, _| Ok(String::new())).unwrap();
        let text = String::from_utf8(output).unwrap();
        assert_eq!(text.lines().count(), 1, "one refusal, then the end: {text}");
    }

    fn init_able_to_ask() -> String {
        request(
            1,
            "initialize",
            json!({ "protocolVersion": "2025-11-25", "capabilities": { "elicitation": {} } }),
        )
    }

    fn answer_to(asked: u64, result: Value) -> String {
        format!(
            "{}\n",
            json!({ "jsonrpc": "2.0", "id": format!("glyph-ask-{asked}"), "result": result })
        )
    }

    fn text_of(reply: &Value) -> &str {
        reply["result"]["content"][0]["text"].as_str().unwrap()
    }

    #[test]
    fn only_a_client_that_declares_forms_can_be_asked() {
        let declared = |elicitation: Value| {
            can_ask(&json!({ "capabilities": { "elicitation": elicitation } }))
        };
        assert!(declared(json!({})));
        assert!(declared(json!({ "form": {} })));
        assert!(declared(json!({ "form": {}, "url": {} })));
        assert!(!declared(json!({ "url": {} })));
        assert!(!declared(Value::Null));
        assert!(!can_ask(&Value::Null));
    }

    #[test]
    fn a_client_that_cannot_ask_is_never_asked() {
        let replies = exchange(&format!(
            "{}{}",
            request(1, "initialize", json!({})),
            request(2, "tools/call", json!({ "name": "ask" })),
        ));
        assert_eq!(replies.len(), 2, "no question went out");
        assert_eq!(replies[1]["result"]["isError"], true);
        assert!(text_of(&replies[1]).contains("cannot ask"));
    }

    #[test]
    fn the_users_answer_decides_the_call() {
        let refused = json!({ "jsonrpc": "2.0", "id": "glyph-ask-4", "error": { "code": -32601, "message": "no forms here" } });
        let replies = exchange(&format!(
            "{}{}{}{}{}{}{}{}{}\n",
            init_able_to_ask(),
            request(2, "tools/call", json!({ "name": "ask" })),
            answer_to(1, json!({ "action": "accept", "content": {} })),
            request(3, "tools/call", json!({ "name": "ask" })),
            answer_to(2, json!({ "action": "decline" })),
            request(4, "tools/call", json!({ "name": "ask" })),
            answer_to(3, json!({ "action": "cancel" })),
            request(5, "tools/call", json!({ "name": "ask" })),
            refused,
        ));
        assert_eq!(replies.len(), 9, "four questions and four answers");
        let question = &replies[1];
        assert_eq!(question["method"], "elicitation/create");
        assert_eq!(question["id"], "glyph-ask-1");
        assert_eq!(question["params"]["message"], "May I?");
        assert_eq!(question["params"]["requestedSchema"]["type"], "object");
        assert_eq!(text_of(&replies[2]), "\"allowed\"");
        assert!(text_of(&replies[4]).contains("declined"));
        assert!(text_of(&replies[6]).contains("dismissed"));
        assert!(text_of(&replies[8]).contains("no forms here"));
    }

    #[test]
    fn what_arrives_while_the_user_decides_waits_its_turn() {
        let oversized = format!("{{\"pad\":\"{}\"}}\n", "x".repeat(MAX_MESSAGE_BYTES + 10));
        let replies = exchange(&format!(
            "{}{}{}{}{}{}{}{}",
            init_able_to_ask(),
            request(2, "tools/call", json!({ "name": "ask" })),
            request(3, "ping", Value::Null),
            oversized,
            "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/cancelled\",\"params\":{\"requestId\":99}}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":\"glyph-ask-7\",\"result\":{}}\n",
            request(4, "tools/call", json!({ "name": "echo", "arguments": { "n": 4 } })),
            answer_to(1, json!({ "action": "accept" })),
        ));
        let ids: Vec<&Value> = replies.iter().map(|reply| &reply["id"]).collect();
        assert_eq!(
            ids,
            [
                &json!(1),
                &json!("glyph-ask-1"),
                &json!(2),
                &json!(3),
                &Value::Null,
                &json!(4)
            ]
        );
        assert_eq!(replies[4]["error"]["code"], INVALID_REQUEST);
        assert_eq!(text_of(&replies[2]), "\"allowed\"");
    }

    #[test]
    fn messages_held_for_an_earlier_question_do_not_count_against_the_next() {
        let pings: String = (100..100 + MAX_HELD as u64)
            .map(|id| request(id, "ping", Value::Null))
            .collect();
        let replies = exchange(&format!(
            "{}{}{}{}{}{}{}",
            init_able_to_ask(),
            request(2, "tools/call", json!({ "name": "ask" })),
            request(3, "tools/call", json!({ "name": "ask" })),
            pings,
            answer_to(1, json!({ "action": "accept" })),
            request(4, "ping", Value::Null),
            answer_to(2, json!({ "action": "accept" })),
        ));
        let third = replies.iter().find(|reply| reply["id"] == 3).unwrap();
        assert_eq!(text_of(third), "\"allowed\"");
    }

    #[test]
    fn a_cancelled_call_stops_waiting_for_the_answer() {
        let replies = exchange(&format!(
            "{}{}{}{}",
            init_able_to_ask(),
            request(7, "tools/call", json!({ "name": "ask" })),
            "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/cancelled\",\"params\":{\"requestId\":7}}\n",
            answer_to(1, json!({ "action": "accept" })),
        ));
        assert_eq!(
            replies.len(),
            3,
            "neither the call nor the late answer gets a reply"
        );
        assert_eq!(replies[2]["method"], "notifications/cancelled");
        assert_eq!(replies[2]["params"]["requestId"], "glyph-ask-1");
    }

    #[test]
    fn a_call_cancelled_while_another_waits_never_asks() {
        let replies = exchange(&format!(
            "{}{}{}{}{}",
            init_able_to_ask(),
            request(2, "tools/call", json!({ "name": "ask" })),
            request(3, "tools/call", json!({ "name": "ask" })),
            "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/cancelled\",\"params\":{\"requestId\":3}}\n",
            answer_to(1, json!({ "action": "accept" })),
        ));
        let ids: Vec<&Value> = replies.iter().map(|reply| &reply["id"]).collect();
        assert_eq!(ids, [&json!(1), &json!("glyph-ask-1"), &json!(2)]);
    }

    #[test]
    fn a_client_that_floods_a_question_gets_it_withdrawn() {
        let pings: String = (0..=MAX_HELD as u64)
            .map(|n| request(10 + n, "ping", Value::Null))
            .collect();
        let replies = exchange(&format!(
            "{}{}{pings}",
            init_able_to_ask(),
            request(2, "tools/call", json!({ "name": "ask" })),
        ));
        assert_eq!(replies[2]["method"], "notifications/cancelled");
        assert!(text_of(&replies[3]).contains("too much"));
        assert_eq!(replies.len(), 4 + MAX_HELD + 1, "every ping still answered");
    }

    #[test]
    fn a_client_that_leaves_mid_question_ends_the_session() {
        let replies = exchange(&format!(
            "{}{}",
            init_able_to_ask(),
            request(2, "tools/call", json!({ "name": "ask" })),
        ));
        assert_eq!(replies.len(), 3);
        assert!(text_of(&replies[2]).contains("closed the session"));
    }

    /// Takes `left` messages, then refuses every write.
    struct Closing(usize);

    impl Write for Closing {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            if self.0 == 0 {
                return Err(io::ErrorKind::BrokenPipe.into());
            }
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            self.0 = self.0.saturating_sub(1);
            Ok(())
        }
    }

    #[test]
    fn a_question_the_client_cannot_take_is_a_refusal() {
        let input = format!(
            "{}{}",
            init_able_to_ask(),
            request(2, "tools/call", json!({ "name": "ask" })),
        );
        let mut refusal = None;
        let served = serve(input.as_bytes(), Closing(1), |_, _, ask| {
            refusal = ask.confirm("May I?").err();
            Ok(String::new())
        });
        assert_eq!(served.unwrap_err().kind(), io::ErrorKind::BrokenPipe);
        assert!(refusal.unwrap().contains("cannot be reached"));
    }
}
