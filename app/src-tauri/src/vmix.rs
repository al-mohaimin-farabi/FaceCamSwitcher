//! vMix TCP command builder + sender (spec §9).
//!
//! Isolated from the UI and observer logic so the exact command can be tuned
//! later without touching anything else.
//!
//! Uses `SetMultiViewOverlay`: it places the input named by `value` (e.g. the
//! detected UID, which matches a vMix input name) onto `layer` of the `source`
//! input's MultiView. This matches the common observer workflow where each
//! player has a vMix input named after their UID/name and the controller routes
//! the active player onto a layer of a "CAM FEED" container input.

use std::collections::HashSet;
use std::io::{Read, Write};
use std::net::TcpStream;

use once_cell::sync::Lazy;
use regex::Regex;

static TITLE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"title="([^"]*)""#).unwrap());

/// Minimal percent-encoding for vMix query parameters (keeps the connection
/// robust to spaces and special characters in source names / values).
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Build the outgoing vMix TCP command for `value` → `source_name` / `layer`.
///
/// Returns a complete vMix TCP API line (CRLF-terminated). Routes the input
/// named `value` onto `layer` of `source_name`'s MultiView via
/// `SetMultiViewOverlay` (`Value=<layer>,<input>`).
pub fn build_payload(source_name: &str, layer: u32, value: &str) -> String {
    format!(
        "FUNCTION SetMultiViewOverlay Input={}&Value={},{}\r\n",
        url_encode(source_name),
        layer,
        url_encode(value),
    )
}

/// Write a prepared payload to an open vMix TCP stream.
pub fn send(stream: &mut TcpStream, payload: &str) -> std::io::Result<()> {
    stream.write_all(payload.as_bytes())?;
    stream.flush()
}

/// Send a command and read vMix's single-line reply (e.g. `FUNCTION OK`).
pub fn send_command(stream: &mut TcpStream, payload: &str) -> std::io::Result<String> {
    send(stream, payload)?;
    let mut buf = [0u8; 512];
    let n = stream.read(&mut buf).unwrap_or(0);
    Ok(String::from_utf8_lossy(&buf[..n]).trim().to_string())
}

fn unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

/// Query vMix for the set of input titles (names) currently loaded.
///
/// Uses the framed `XML` TCP response (`XML <length>\r\n<xml>`) so the exact
/// number of bytes is consumed and the socket stays in sync with other commands.
pub fn query_input_titles(stream: &mut TcpStream) -> std::io::Result<HashSet<String>> {
    send(stream, "XML\r\n")?;

    // Read the header line: "XML <length>\r\n".
    let mut header = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        let n = stream.read(&mut byte)?;
        if n == 0 || header.ends_with(b"\r\n") || header.len() > 64 {
            break;
        }
        header.push(byte[0]);
    }
    let header = String::from_utf8_lossy(&header);
    let len: usize = header
        .trim()
        .strip_prefix("XML")
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    if len == 0 {
        return Ok(HashSet::new());
    }

    let mut data = vec![0u8; len];
    stream.read_exact(&mut data)?;
    let xml = String::from_utf8_lossy(&data);

    let mut titles = HashSet::new();
    for cap in TITLE_RE.captures_iter(&xml) {
        titles.insert(unescape(&cap[1]));
    }
    Ok(titles)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_multiview_overlay_command() {
        let cmd = build_payload("CAM FEED", 2, "11838801107");
        assert_eq!(
            cmd,
            "FUNCTION SetMultiViewOverlay Input=CAM%20FEED&Value=2,11838801107\r\n"
        );
    }

    #[test]
    fn encodes_special_characters_in_name() {
        let cmd = build_payload("Lower 3rd", 1, "them!s&uwu");
        assert!(cmd.contains("Input=Lower%203rd"));
        assert!(cmd.contains("Value=1,them%21s%26uwu"));
        assert!(cmd.ends_with("\r\n"));
    }
}
