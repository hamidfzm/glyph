// The `--help` text, answered before Tauri (and therefore GTK/WebKit) starts,
// for the same reason as `--version`: `tauri-plugin-cli` parses its args from
// inside `setup`, which needs a running app and a window. Printing here keeps
// `glyph --help` working on a headless machine.

use crate::cli::format_list;

/// The full usage text, including the version banner.
pub fn usage() -> String {
    let formats = format_list();
    format!(
        "glyph {version}
Markdown viewer with document and website export.

USAGE:
  glyph [<path>]                              Open a file or folder
  glyph <file> --export <format> [--out <p>]  Export a document and exit
  glyph <folder> --export site --out <dir>    Export a workspace as a website

OPTIONS:
      --export <format>  Export and exit. Formats: {formats}
  -o, --out <path>       Where to write. Defaults to the input path with the
                         format's extension; required for `site`.
  -h, --help             Print this help and exit
  -V, --version          Print the version and exit

An export writes nothing to stdout but the path it produced, and exits nonzero
with a message on stderr if it fails.",
        version = env!("CARGO_PKG_VERSION"),
    )
}

/// True when argv asks for the usage text.
pub fn wants_help(args: &[String]) -> bool {
    args.iter().skip(1).any(|a| a == "--help" || a == "-h")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_lists_every_format_and_flag() {
        let text = usage();
        for format in crate::cli::ExportFormat::ALL {
            let name = format.as_str();
            assert!(
                text.contains(name),
                "usage text is missing the '{name}' format"
            );
        }
        for flag in ["--export", "--out", "-o", "--help", "-h", "--version", "-V"] {
            assert!(text.contains(flag), "usage text is missing '{flag}'");
        }
        assert!(text.contains(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn wants_help_matches_only_the_help_flags() {
        let argv = |args: &[&str]| -> Vec<String> {
            std::iter::once("glyph")
                .chain(args.iter().copied())
                .map(String::from)
                .collect()
        };
        assert!(wants_help(&argv(&["--help"])));
        assert!(wants_help(&argv(&["notes.md", "-h"])));
        assert!(!wants_help(&argv(&["notes.md"])));
        // The program name is never a flag, even when it is spelled like one.
        assert!(!wants_help(&["--help".to_string()]));
    }
}
