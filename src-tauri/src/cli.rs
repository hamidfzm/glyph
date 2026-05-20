use std::path::{Path, PathBuf};

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

/// The frontend event a second-instance launch should fire on the running
/// window, plus the absolute path payload. Returned by [`second_instance_event`].
#[derive(Debug, PartialEq, Eq)]
pub struct SecondInstanceEvent {
    pub event_name: &'static str,
    pub path: String,
}

/// Decide what (if anything) a second instance should tell the running app to
/// open. Picks the first non-flag arg out of `argv`, resolves it against
/// `cwd`, and classifies the result as folder vs file so the caller can emit
/// the matching event. Returns `None` if there's no path argument, the path
/// can't be resolved on disk, or the resolved path is neither a file nor a
/// directory (e.g. a broken symlink).
pub fn second_instance_event(argv: &[String], cwd: &Path) -> Option<SecondInstanceEvent> {
    let path_arg = pick_path_arg(argv)?;
    let canonical = resolve_initial_path(path_arg, cwd)?;
    let event_name = if canonical.is_dir() {
        "open-folder"
    } else if canonical.is_file() {
        "open-file"
    } else {
        return None;
    };
    Some(SecondInstanceEvent {
        event_name,
        path: canonical.to_string_lossy().to_string(),
    })
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
        if !status.success() {
            let _ = fs::remove_dir_all(&cwd);
            return;
        }

        let argv = vec!["glyph".to_string(), "pipe".to_string()];
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
