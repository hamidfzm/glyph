//! A config file, judged as text rather than parsed: a parser that disagreed
//! with libgit2's about a single value would let that value through.

use std::path::{Component, Path};

use super::{read, Judge};

/// Refuse the config at `path`, if there is one, when it includes another
/// file or holds a value `judge` refuses.
pub(super) fn check(path: &Path, judge: Judge) -> Result<(), String> {
    let Some(bytes) = read(path)? else {
        return Ok(());
    };
    // An included file would need the same check, and libgit2 resolves the
    // path to it first. It takes a section's name right after the bracket.
    let header = b"[include";
    let includes = |start: &[u8]| start.eq_ignore_ascii_case(header);
    if bytes.windows(header.len()).any(includes) {
        return Err(format!("{} includes other files", path.display()));
    }
    for word in double_separator_words(&bytes) {
        let named = Path::new(&word);
        judge(named)?;
        // Separators with no share after them, in which `judge` finds
        // nothing remote: the line libgit2 joins on may go on to name one.
        if !matches!(named.components().next(), Some(Component::Prefix(_))) {
            return Err(format!(
                "{} holds {word}, which begins like a network path and is never looked up",
                path.display()
            ));
        }
    }
    Ok(())
}

/// Every word that begins with two path separators, the way a network or a
/// device path does, whatever its key: libgit2 resolves `core.worktree`,
/// `core.excludesfile`, `core.attributesfile` and a remote's `url` alike.
/// Quotes are dropped and `\\` is one backslash, as libgit2 reads a value.
/// Lines are not joined the way it joins them. The backslash that continues
/// a value onto the next line stays, and counts as a separator itself, so a
/// path split there still begins with two.
fn double_separator_words(config: &[u8]) -> Vec<String> {
    let mut plain = Vec::with_capacity(config.len());
    let mut bytes = config.iter().copied().peekable();
    while let Some(byte) = bytes.next() {
        if byte == b'"' {
            continue;
        }
        plain.push(byte);
        if byte == b'\\' && bytes.peek() == Some(&b'\\') {
            bytes.next();
        }
    }
    plain
        .split(|byte| byte.is_ascii_whitespace() || *byte == b'=')
        .filter(|word| matches!(word, [b'/' | b'\\', b'/' | b'\\', ..]))
        .map(|word| String::from_utf8_lossy(word).into_owned())
        .collect()
}
