// Mobile has no CLI; the launch-plan half of this module (marked
// `#[cfg(desktop)]` item by item) is only called from the desktop-gated setup
// block, while the classifiers stay in use everywhere by the drag-drop and
// file-association handlers.

use std::path::{Path, PathBuf};

use crate::is_supported_file;

/// Pick the first non-flag argument from a second-instance argv. The slice is
/// expected to be the full argv including the program name at index 0, which
/// `tauri-plugin-single-instance` hands to its callback verbatim.
///
/// Anything starting with `-` is treated as a flag and skipped, matching the
/// way the OS hands us file-association launches: `glyph /path/to/file.md`.
pub fn pick_path_arg(argv: &[String]) -> Option<&str> {
    argv.iter()
        .skip(1)
        .find(|a| !a.is_empty() && !a.starts_with('-'))
        .map(String::as_str)
}

/// What an initial-launch path resolves to. Shared by every entry that turns
/// a user-supplied path into an "open this" intent — CLI args, macOS
/// `RunEvent::Opened`, and the single-instance plugin callback. Callers pick
/// what to do with each variant (store in managed state, emit a frontend
/// event, or warn + skip).
#[derive(Debug, PartialEq, Eq)]
pub enum InitialOpenAction {
    /// Open as a folder workspace. Inner is the absolute path.
    Folder(String),
    /// Open as a single markdown file. Inner is the absolute path.
    File(String),
    /// Path exists and resolves, but is not a supported document (markdown or
    /// `.ipynb`) — e.g. `.txt`, `.html`. The caller should log a warning and
    /// skip it rather than forwarding it to the renderer, which would otherwise
    /// treat the content as markdown and allow embedded HTML / JS through the
    /// sanitizer. Inner is the absolute path for the log message.
    RejectedUnsupported(String),
}

/// Classify a path that's already been resolved to a canonical absolute form.
/// Used by macOS `RunEvent::Opened` where the OS hands us a `file://` URL we
/// can `to_file_path()` directly — no relative-to-cwd resolution needed.
///
/// Returns `None` for paths that don't exist or aren't regular files /
/// directories (e.g. broken symlinks, sockets, FIFOs).
pub fn classify_resolved_path(canonical: &Path) -> Option<InitialOpenAction> {
    let abs = canonical.to_string_lossy().to_string();
    if canonical.is_dir() {
        Some(InitialOpenAction::Folder(abs))
    } else if canonical.is_file() {
        if is_supported_file(canonical) {
            Some(InitialOpenAction::File(abs))
        } else {
            Some(InitialOpenAction::RejectedUnsupported(abs))
        }
    } else {
        None
    }
}

/// Resolve a user-supplied path string against `cwd` and classify the
/// result. Used by the CLI argument parser at first launch — the user may
/// pass a relative path; classification needs to happen against the
/// canonicalized form so symlinks and `..` traversal are normalised.
pub fn classify_initial_arg(path_str: &str, cwd: &Path) -> Option<InitialOpenAction> {
    let canonical = resolve_initial_path(path_str, cwd)?;
    classify_resolved_path(&canonical)
}

/// Pick the initial path to open at first launch from the two sources we
/// have available, in order:
///
/// 1. `plugin_path` — the value `tauri-plugin-cli` parsed out of its
///    configured args. Works when the OS hands us the file via association,
///    or when the user runs the binary directly.
/// 2. `env_args` — the raw process argv, scanned by [`pick_path_arg`]. This
///    is the Windows-friendly path: `pnpm tauri dev -- samples` can land
///    `samples` in argv without ever populating the plugin's matches, so we
///    fall back to argv when the plugin yields nothing.
#[cfg(desktop)]
pub fn initial_open_action(
    plugin_path: Option<&str>,
    env_args: &[String],
    cwd: &Path,
) -> Option<InitialOpenAction> {
    let path_str = plugin_path
        .map(str::to_string)
        .or_else(|| pick_path_arg(env_args).map(str::to_string))?;
    classify_initial_arg(&path_str, cwd)
}

/// The frontend event a second-instance launch should fire on the running
/// window, plus the absolute path payload. Returned by [`second_instance_event`].
#[derive(Debug, PartialEq, Eq)]
pub struct SecondInstanceEvent {
    pub event_name: &'static str,
    pub path: String,
}

/// Decide what (if anything) a second instance should tell the running app to
/// open. Picks the first non-flag arg out of `argv`, resolves it against
/// `cwd`, and classifies the result. Non-markdown files are silently rejected
/// here (the running app already logged the warning at first launch if it
/// hit one).
pub fn second_instance_event(argv: &[String], cwd: &Path) -> Option<SecondInstanceEvent> {
    let path_arg = pick_path_arg(argv)?;
    match classify_initial_arg(path_arg, cwd)? {
        InitialOpenAction::Folder(path) => Some(SecondInstanceEvent {
            event_name: "open-folder",
            path,
        }),
        InitialOpenAction::File(path) => Some(SecondInstanceEvent {
            event_name: "open-file",
            path,
        }),
        InitialOpenAction::RejectedUnsupported(_) => None,
    }
}

/// Value of a `--flag value` / `--flag=value` pair in argv, if present. The
/// argv fallback for `tauri-plugin-cli` flags, mirroring [`pick_path_arg`].
#[cfg(desktop)]
pub fn pick_flag_value<'a>(argv: &'a [String], flag: &str) -> Option<&'a str> {
    let prefix = format!("{flag}=");
    let mut iter = argv.iter().skip(1);
    while let Some(arg) = iter.next() {
        if arg == flag {
            return iter.next().map(String::as_str);
        }
        if let Some(rest) = arg.strip_prefix(&prefix) {
            return Some(rest);
        }
    }
    None
}

/// Remove `--flag value` / `--flag=value` from argv so positional scanning
/// ([`pick_path_arg`]) can't mistake the flag's value for the path argument.
#[cfg(desktop)]
pub fn strip_flag(argv: &[String], flag: &str) -> Vec<String> {
    let prefix = format!("{flag}=");
    let mut out = Vec::new();
    let mut iter = argv.iter();
    while let Some(arg) = iter.next() {
        if arg == flag {
            iter.next();
            continue;
        }
        if arg.starts_with(&prefix) {
            continue;
        }
        out.push(arg.clone());
    }
    out
}

/// Resolve the `--export-website` output directory against `cwd`. Unlike
/// input paths it does not need to exist yet, so there is no canonicalize.
#[cfg(desktop)]
pub fn resolve_out_dir(path_str: &str, cwd: &Path) -> Option<String> {
    if path_str.trim().is_empty() {
        return None;
    }
    let path = Path::new(path_str);
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    Some(absolute.to_string_lossy().to_string())
}

/// What this process launch should do, decided from the CLI once at startup.
#[cfg(desktop)]
#[derive(Debug, PartialEq, Eq)]
pub enum CliLaunch {
    /// Normal interactive launch, optionally opening a path.
    Open(Option<InitialOpenAction>),
    /// Headless website export: render `root` into `out_dir` and exit.
    ExportWebsite { root: String, out_dir: String },
}

/// Combine the positional path and the `--export-website` flag into a launch
/// plan. `Err` is a usage error the caller should print before exiting
/// nonzero: an export was requested without a valid workspace folder.
#[cfg(desktop)]
pub fn launch_plan(
    plugin_path: Option<&str>,
    plugin_export: Option<&str>,
    env_args: &[String],
    cwd: &Path,
) -> Result<CliLaunch, String> {
    let export_out = plugin_export
        .map(str::to_string)
        .or_else(|| pick_flag_value(env_args, "--export-website").map(str::to_string));
    let positional_args = strip_flag(env_args, "--export-website");
    let action = initial_open_action(plugin_path, &positional_args, cwd);
    let Some(out) = export_out else {
        return Ok(CliLaunch::Open(action));
    };
    let out_dir = resolve_out_dir(&out, cwd)
        .ok_or("--export-website needs an output directory".to_string())?;
    match action {
        Some(InitialOpenAction::Folder(root)) => Ok(CliLaunch::ExportWebsite { root, out_dir }),
        _ => Err(
            "--export-website requires an existing workspace folder: glyph <folder> --export-website <outDir>"
                .to_string(),
        ),
    }
}

/// Resolve a CLI-supplied path against the working directory. Returns the
/// canonicalized path if it points at something on disk, otherwise `None`.
///
/// Resolution order:
/// 1. Empty / blank input → None.
/// 2. Absolute path → canonicalize as-is.
/// 3. Relative path → try `cwd/path`, then `cwd/../path` (covers `cargo tauri
///    dev` running from `src-tauri/`). If neither exists, fall back to the
///    cwd-relative variant so canonicalize can still report a meaningful error.
pub fn resolve_initial_path(path_str: &str, cwd: &Path) -> Option<PathBuf> {
    if path_str.is_empty() {
        return None;
    }
    let path = Path::new(path_str);
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        let from_cwd = cwd.join(path);
        if from_cwd.exists() {
            from_cwd
        } else {
            let from_parent = cwd.join("..").join(path);
            if from_parent.exists() {
                from_parent
            } else {
                from_cwd
            }
        }
    };
    absolute.canonicalize().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "glyph_cli_test_{}_{}_{}",
            name,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn pick_path_arg_skips_program_name() {
        let argv = vec!["glyph".to_string(), "notes.md".to_string()];
        assert_eq!(pick_path_arg(&argv), Some("notes.md"));
    }

    #[test]
    fn pick_path_arg_skips_flags() {
        let argv = vec![
            "glyph".to_string(),
            "--verbose".to_string(),
            "-q".to_string(),
            "real.md".to_string(),
        ];
        assert_eq!(pick_path_arg(&argv), Some("real.md"));
    }

    #[test]
    fn pick_path_arg_returns_none_when_no_path_arg() {
        let argv = vec!["glyph".to_string()];
        assert_eq!(pick_path_arg(&argv), None);
        let only_flag = vec!["glyph".to_string(), "--help".to_string()];
        assert_eq!(pick_path_arg(&only_flag), None);
    }

    #[test]
    fn pick_path_arg_skips_empty_strings() {
        let argv = vec!["glyph".to_string(), "".to_string(), "real.md".to_string()];
        assert_eq!(pick_path_arg(&argv), Some("real.md"));
    }

    #[test]
    fn second_instance_event_classifies_file_argv() {
        let cwd = unique_tmp("si_file");
        let file = cwd.join("note.md");
        fs::write(&file, "x").unwrap();

        let argv = vec!["glyph".to_string(), "note.md".to_string()];
        let result = second_instance_event(&argv, &cwd).expect("should resolve");
        assert_eq!(result.event_name, "open-file");
        assert_eq!(
            PathBuf::from(&result.path).canonicalize().unwrap(),
            file.canonicalize().unwrap()
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn second_instance_event_classifies_folder_argv() {
        let cwd = unique_tmp("si_folder");
        let sub = cwd.join("workspace");
        fs::create_dir_all(&sub).unwrap();

        let argv = vec!["glyph".to_string(), "workspace".to_string()];
        let result = second_instance_event(&argv, &cwd).expect("should resolve");
        assert_eq!(result.event_name, "open-folder");
        assert_eq!(
            PathBuf::from(&result.path).canonicalize().unwrap(),
            sub.canonicalize().unwrap()
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn second_instance_event_returns_none_when_no_path_arg() {
        let cwd = unique_tmp("si_none");
        let argv = vec!["glyph".to_string(), "--verbose".to_string()];
        assert!(second_instance_event(&argv, &cwd).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn second_instance_event_returns_none_when_path_does_not_exist() {
        let cwd = unique_tmp("si_missing");
        let argv = vec!["glyph".to_string(), "nope.md".to_string()];
        assert!(second_instance_event(&argv, &cwd).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[cfg(unix)]
    #[test]
    fn second_instance_event_returns_none_for_non_file_non_dir_paths() {
        // A named pipe (FIFO) `.exists()` and canonicalises, but is_file/is_dir
        // both return false — exercises the fallthrough `return None` branch.
        let cwd = unique_tmp("si_fifo");
        let fifo = cwd.join("pipe");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo invocation should succeed on a unix runner");
        assert!(status.success(), "mkfifo should succeed on this runner");

        let argv = vec!["glyph".to_string(), "pipe".to_string()];
        assert!(second_instance_event(&argv, &cwd).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn initial_open_action_implements_debug_formatting() {
        // Covers the auto-derived `Debug` impl for the enum. Without an
        // explicit call site, the impl is only reached via the panic
        // messages in the matches! tests below, which never fire when
        // those tests pass.
        let actions = [
            InitialOpenAction::Folder("/workspace".to_string()),
            InitialOpenAction::File("/workspace/notes.md".to_string()),
            InitialOpenAction::RejectedUnsupported("/workspace/evil.txt".to_string()),
        ];
        for action in &actions {
            let formatted = format!("{action:?}");
            assert!(
                !formatted.is_empty(),
                "expected non-empty Debug for {action:?}"
            );
        }
    }

    #[test]
    fn classify_resolved_path_recognises_folders() {
        let cwd = unique_tmp("cls_folder");
        let result = classify_resolved_path(&cwd.canonicalize().unwrap()).expect("classifies");
        assert!(matches!(result, InitialOpenAction::Folder(_)));
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn classify_resolved_path_recognises_markdown_files() {
        let cwd = unique_tmp("cls_md");
        let file = cwd.join("note.md");
        fs::write(&file, "x").unwrap();
        let result = classify_resolved_path(&file.canonicalize().unwrap()).expect("classifies");
        assert!(
            matches!(&result, InitialOpenAction::File(p) if p.ends_with("note.md")),
            "expected File ending in note.md, got {result:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn classify_resolved_path_rejects_non_markdown_files() {
        let cwd = unique_tmp("cls_txt");
        let file = cwd.join("evil.txt");
        fs::write(&file, "<script>alert('x')</script>").unwrap();
        let result = classify_resolved_path(&file.canonicalize().unwrap()).expect("classifies");
        assert!(
            matches!(&result, InitialOpenAction::RejectedUnsupported(p) if p.ends_with("evil.txt")),
            "expected RejectedUnsupported ending in evil.txt, got {result:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn classify_resolved_path_returns_none_for_missing_paths() {
        let cwd = unique_tmp("cls_miss");
        let missing = cwd.join("not-here.md");
        // Don't actually create the file — passing the would-be path directly.
        assert!(classify_resolved_path(&missing).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[cfg(unix)]
    #[test]
    fn classify_resolved_path_returns_none_for_non_file_non_dir_paths() {
        // FIFO exists but is_file/is_dir both return false.
        let cwd = unique_tmp("cls_fifo");
        let fifo = cwd.join("pipe");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo invocation should succeed on a unix runner");
        assert!(status.success());
        let canonical = fifo.canonicalize().unwrap();
        assert!(classify_resolved_path(&canonical).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn classify_initial_arg_resolves_then_classifies() {
        let cwd = unique_tmp("cia_md");
        let file = cwd.join("notes.md");
        fs::write(&file, "x").unwrap();
        let result = classify_initial_arg("notes.md", &cwd).expect("classifies");
        assert!(
            matches!(&result, InitialOpenAction::File(p) if p.ends_with("notes.md")),
            "expected File ending in notes.md, got {result:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn classify_initial_arg_rejects_non_markdown_extensions() {
        let cwd = unique_tmp("cia_txt");
        let file = cwd.join("evil.txt");
        fs::write(&file, "x").unwrap();
        let result = classify_initial_arg("evil.txt", &cwd).expect("classifies");
        assert!(matches!(result, InitialOpenAction::RejectedUnsupported(_)));
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn classify_initial_arg_returns_none_for_unresolvable_paths() {
        let cwd = unique_tmp("cia_missing");
        assert!(classify_initial_arg("does_not_exist.md", &cwd).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn second_instance_event_returns_none_for_non_markdown_files() {
        // Covers the RejectedUnsupported -> None arm in second_instance_event:
        // a second instance pointed at evil.txt should not fire any event.
        let cwd = unique_tmp("si_txt");
        let file = cwd.join("evil.txt");
        fs::write(&file, "<script>").unwrap();
        let argv = vec!["glyph".to_string(), "evil.txt".to_string()];
        assert!(second_instance_event(&argv, &cwd).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn second_instance_event_skips_program_name_and_flags() {
        let cwd = unique_tmp("si_flags");
        let file = cwd.join("readme.md");
        fs::write(&file, "x").unwrap();

        let argv = vec![
            "glyph".to_string(),
            "--quiet".to_string(),
            "-v".to_string(),
            "readme.md".to_string(),
        ];
        let result = second_instance_event(&argv, &cwd).expect("should resolve");
        assert_eq!(result.event_name, "open-file");
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn pick_flag_value_finds_space_and_equals_forms() {
        let argv: Vec<String> = ["glyph", "docs", "--export-website", "site"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(pick_flag_value(&argv, "--export-website"), Some("site"));

        let eq_form: Vec<String> = ["glyph", "--export-website=out", "docs"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(pick_flag_value(&eq_form, "--export-website"), Some("out"));
    }

    #[test]
    fn pick_flag_value_returns_none_when_absent_or_valueless() {
        let argv: Vec<String> = ["glyph", "docs"].iter().map(|s| s.to_string()).collect();
        assert_eq!(pick_flag_value(&argv, "--export-website"), None);
        let dangling: Vec<String> = ["glyph", "--export-website"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(pick_flag_value(&dangling, "--export-website"), None);
    }

    #[test]
    fn strip_flag_removes_flag_and_value_leaving_positionals() {
        let argv: Vec<String> = ["glyph", "--export-website", "site", "docs"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(strip_flag(&argv, "--export-website"), vec!["glyph", "docs"]);
        let eq_form: Vec<String> = ["glyph", "--export-website=site", "docs"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(
            strip_flag(&eq_form, "--export-website"),
            vec!["glyph", "docs"]
        );
    }

    #[test]
    fn resolve_out_dir_makes_relative_paths_absolute_without_requiring_existence() {
        let cwd = Path::new("/work");
        let resolved = resolve_out_dir("site", cwd).expect("resolves");
        assert_eq!(resolved, Path::new("/work").join("site").to_string_lossy());
        assert!(resolve_out_dir("  ", cwd).is_none());
    }

    #[test]
    fn resolve_out_dir_keeps_absolute_paths_as_given() {
        // temp_dir is absolute on every platform (a bare "/x" is not absolute
        // on Windows, where absolute needs a drive or UNC prefix).
        let abs = std::env::temp_dir().join("glyph-site-out");
        let resolved = resolve_out_dir(abs.to_string_lossy().as_ref(), Path::new("/elsewhere"))
            .expect("resolves");
        assert_eq!(resolved, abs.to_string_lossy());
    }

    #[test]
    fn launch_plan_without_export_flag_is_a_normal_open() {
        let cwd = unique_tmp("lp_open");
        let ws = cwd.join("docs");
        fs::create_dir_all(&ws).unwrap();
        let argv: Vec<String> = ["glyph", "docs"].iter().map(|s| s.to_string()).collect();

        let plan = launch_plan(None, None, &argv, &cwd).expect("plans");
        assert!(matches!(
            plan,
            CliLaunch::Open(Some(InitialOpenAction::Folder(_)))
        ));
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_pairs_folder_with_export_flag_even_when_flag_precedes_path() {
        // The flag's value must not be mistaken for the positional path.
        let cwd = unique_tmp("lp_export");
        let ws = cwd.join("docs");
        fs::create_dir_all(&ws).unwrap();
        let argv: Vec<String> = ["glyph", "--export-website", "site", "docs"]
            .iter()
            .map(|s| s.to_string())
            .collect();

        let plan = launch_plan(None, None, &argv, &cwd).expect("plans");
        let expected_out = cwd.join("site").to_string_lossy().to_string();
        assert!(
            matches!(
                &plan,
                CliLaunch::ExportWebsite { root, out_dir }
                    if root.ends_with("docs") && *out_dir == expected_out
            ),
            "expected ExportWebsite for docs -> site, got {plan:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_export_without_folder_is_a_usage_error() {
        let cwd = unique_tmp("lp_err");
        let argv: Vec<String> = ["glyph", "--export-website", "site"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let err = launch_plan(None, None, &argv, &cwd).expect_err("usage error");
        assert!(err.contains("--export-website"));

        // A file (not a folder) positional is also a usage error.
        let file = cwd.join("note.md");
        fs::write(&file, "x").unwrap();
        let argv: Vec<String> = ["glyph", "note.md", "--export-website", "site"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert!(launch_plan(None, None, &argv, &cwd).is_err());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_rejects_a_blank_output_directory() {
        let cwd = unique_tmp("lp_blank");
        let ws = cwd.join("docs");
        fs::create_dir_all(&ws).unwrap();
        let argv: Vec<String> = ["glyph", "docs"].iter().map(|s| s.to_string()).collect();

        let err = launch_plan(None, Some("   "), &argv, &cwd).expect_err("usage error");
        assert!(err.contains("output directory"), "got: {err}");
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_prefers_plugin_export_value() {
        let cwd = unique_tmp("lp_plugin");
        let ws = cwd.join("docs");
        fs::create_dir_all(&ws).unwrap();
        let argv: Vec<String> = ["glyph", "docs"].iter().map(|s| s.to_string()).collect();

        let plan = launch_plan(None, Some("from-plugin"), &argv, &cwd).expect("plans");
        let expected_out = cwd.join("from-plugin").to_string_lossy().to_string();
        assert!(
            matches!(&plan, CliLaunch::ExportWebsite { out_dir, .. } if *out_dir == expected_out),
            "expected ExportWebsite with the plugin's out dir, got {plan:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn empty_input_returns_none() {
        assert!(resolve_initial_path("", Path::new("/tmp")).is_none());
    }

    #[test]
    fn nonexistent_path_returns_none() {
        let cwd = unique_tmp("missing");
        let result = resolve_initial_path("does_not_exist.md", &cwd);
        assert!(result.is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn absolute_existing_file_is_canonicalized() {
        let cwd = unique_tmp("abs_file");
        let file = cwd.join("notes.md");
        fs::write(&file, "x").unwrap();

        let resolved = resolve_initial_path(file.to_string_lossy().as_ref(), Path::new("/"))
            .expect("should resolve");
        assert_eq!(
            resolved.canonicalize().unwrap(),
            file.canonicalize().unwrap()
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn relative_path_resolves_against_cwd() {
        let cwd = unique_tmp("rel_cwd");
        let file = cwd.join("readme.md");
        fs::write(&file, "x").unwrap();

        let resolved = resolve_initial_path("readme.md", &cwd).expect("should resolve");
        assert_eq!(resolved, file.canonicalize().unwrap());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn relative_path_falls_back_to_parent_when_cwd_misses() {
        // Simulates `cargo tauri dev` running with cwd=src-tauri/ but the user
        // passed a path that lives in the repo root one level up.
        let root = unique_tmp("rel_parent_root");
        fs::write(root.join("notes.md"), "x").unwrap();
        let inner = root.join("src-tauri");
        fs::create_dir_all(&inner).unwrap();

        let resolved = resolve_initial_path("notes.md", &inner).expect("should resolve via parent");
        assert_eq!(resolved, root.join("notes.md").canonicalize().unwrap());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn initial_open_action_prefers_plugin_value_over_argv() {
        let cwd = unique_tmp("ioa_pref");
        let plugin_target = cwd.join("from-plugin");
        let argv_target = cwd.join("from-argv");
        fs::create_dir_all(&plugin_target).unwrap();
        fs::create_dir_all(&argv_target).unwrap();

        let env_args = vec!["glyph".to_string(), "from-argv".to_string()];
        let result = initial_open_action(Some("from-plugin"), &env_args, &cwd).expect("classifies");
        assert!(
            matches!(&result, InitialOpenAction::Folder(p) if p.ends_with("from-plugin")),
            "expected the plugin-supplied path to win, got {result:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn initial_open_action_falls_back_to_argv_when_plugin_is_empty() {
        // This is the Windows path: tauri-plugin-cli's `file` arg is
        // None / null because pnpm's arg forwarding bypassed it, but the
        // positional arg is still in argv. The fallback must pick it up.
        let cwd = unique_tmp("ioa_fallback");
        let target = cwd.join("samples");
        fs::create_dir_all(&target).unwrap();

        let env_args = vec!["glyph".to_string(), "samples".to_string()];
        let result = initial_open_action(None, &env_args, &cwd).expect("classifies via argv");
        assert!(
            matches!(&result, InitialOpenAction::Folder(p) if p.ends_with("samples")),
            "expected argv fallback to find samples, got {result:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn initial_open_action_returns_none_when_neither_source_yields_a_path() {
        let cwd = unique_tmp("ioa_none");
        let env_args = vec!["glyph".to_string(), "--verbose".to_string()];
        assert!(initial_open_action(None, &env_args, &cwd).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn initial_open_action_returns_none_when_path_does_not_exist() {
        // Plugin and argv agree on a path, but it isn't there. Should be
        // None (and the caller decides whether to log).
        let cwd = unique_tmp("ioa_missing");
        let env_args = vec!["glyph".to_string(), "nope".to_string()];
        assert!(initial_open_action(Some("nope"), &env_args, &cwd).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn resolves_to_a_directory_path_too() {
        let cwd = unique_tmp("rel_dir");
        let sub = cwd.join("workspace");
        fs::create_dir_all(&sub).unwrap();

        let resolved = resolve_initial_path("workspace", &cwd).expect("should resolve");
        assert!(resolved.is_dir());
        assert_eq!(resolved, sub.canonicalize().unwrap());
        let _ = fs::remove_dir_all(&cwd);
    }
}
