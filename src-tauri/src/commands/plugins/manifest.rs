// Manifest parsing and validation for installed plugins and packages. The
// manifest is the security boundary: ids double as folder names and `files`
// is the whitelist installs and asset reads are held to, so everything here
// rejects rather than normalizes.

#[derive(Debug)]
pub(crate) struct ManifestInfo {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) api_version: String,
    pub(crate) description: Option<String>,
    pub(crate) permissions: Vec<String>,
    pub(crate) sandbox: bool,
    pub(crate) main: String,
    pub(crate) files: Vec<String>,
}

/// Caps for package installs: a plugin is code plus a few data assets
/// (dictionaries, fonts), not an arbitrary archive.
pub(crate) const MAX_PACKAGE_FILES: usize = 256;
pub(crate) const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
pub(crate) const MAX_TOTAL_BYTES: u64 = 50 * 1024 * 1024;

/// A declared file path must stay inside the plugin folder on every platform:
/// relative, `/`-separated, no empty/`.`/`..` segments, no drive colons.
pub(crate) fn validate_file_path(path: &str) -> Result<(), String> {
    let ok = !path.is_empty()
        && !path.contains('\\')
        && !path.contains(':')
        && !path.starts_with('/')
        && path
            .split('/')
            .all(|seg| !seg.is_empty() && seg != "." && seg != "..");
    if ok {
        Ok(())
    } else {
        Err(format!(
            "invalid manifest file path \"{path}\": use relative, '/'-separated paths inside the plugin folder"
        ))
    }
}

/// Optional `files` whitelist; when present it must be an array of valid
/// relative paths that includes the entry file.
pub(crate) fn parse_files(value: &serde_json::Value, main: &str) -> Result<Vec<String>, String> {
    match value.get("files") {
        None => Ok(Vec::new()),
        Some(serde_json::Value::Array(items)) => {
            let files = items
                .iter()
                .map(|v| {
                    let s = v.as_str().ok_or_else(|| {
                        String::from("manifest \"files\" must be an array of strings")
                    })?;
                    validate_file_path(s)?;
                    Ok(s.to_string())
                })
                .collect::<Result<Vec<String>, String>>()?;
            if files.len() > MAX_PACKAGE_FILES {
                return Err(format!(
                    "manifest \"files\" lists more than {MAX_PACKAGE_FILES} entries"
                ));
            }
            if !files.iter().any(|f| f == main) {
                return Err(format!(
                    "manifest \"files\" must include the entry file \"{main}\""
                ));
            }
            Ok(files)
        }
        Some(_) => Err("manifest \"files\" must be an array of strings".into()),
    }
}

/// Optional `permissions` array; when present it must be an array of strings.
pub(crate) fn parse_permissions(value: &serde_json::Value) -> Result<Vec<String>, String> {
    match value.get("permissions") {
        None => Ok(Vec::new()),
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .map(|v| {
                v.as_str()
                    .map(|s| s.to_string())
                    .ok_or_else(|| "manifest \"permissions\" must be an array of strings".into())
            })
            .collect(),
        Some(_) => Err("manifest \"permissions\" must be an array of strings".into()),
    }
}

pub(crate) fn required_str(value: &serde_json::Value, key: &str) -> Result<String, String> {
    match value.get(key).and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => Ok(s.trim().to_string()),
        _ => Err(format!("manifest.json is missing required field \"{key}\"")),
    }
}

/// The plugin id doubles as its folder name, so restrict it to characters that
/// are safe on every filesystem and can never traverse out of the plugins dir.
pub(crate) fn validate_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && !id.starts_with('.')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if ok {
        Ok(())
    } else {
        Err(format!(
            "invalid plugin id \"{id}\": use only letters, digits, '.', '_' and '-'"
        ))
    }
}

pub(crate) fn parse_manifest(json: &str) -> Result<ManifestInfo, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("manifest.json is not valid JSON: {e}"))?;
    let id = required_str(&value, "id")?;
    validate_id(&id)?;
    let main = match value.get("main").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => "main.js".to_string(),
    };
    // The entry must be a plain file name inside the plugin folder.
    if main.contains('/') || main.contains('\\') || main.starts_with('.') {
        return Err(format!("invalid manifest \"main\": {main}"));
    }
    let files = parse_files(&value, &main)?;
    Ok(ManifestInfo {
        id,
        name: required_str(&value, "name")?,
        version: required_str(&value, "version")?,
        api_version: required_str(&value, "apiVersion")?,
        description: value
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        permissions: parse_permissions(&value)?,
        sandbox: match value.get("sandbox") {
            None => false,
            Some(serde_json::Value::Bool(b)) => *b,
            Some(_) => return Err("manifest \"sandbox\" must be a boolean".into()),
        },
        main,
        files,
    })
}

impl ManifestInfo {
    /// The files an install copies: the declared whitelist, or just the entry
    /// for a legacy manifest without `files`.
    pub(crate) fn install_files(&self) -> Vec<String> {
        if self.files.is_empty() {
            vec![self.main.clone()]
        } else {
            self.files.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_manifest_reads_all_fields() {
        let info = parse_manifest(
        r#"{"id":"com.x.demo","name":"Demo","version":"2.1.0","apiVersion":"^1.0.0","description":"d","main":"index.js"}"#,
    )
    .unwrap();
        assert_eq!(info.id, "com.x.demo");
        assert_eq!(info.name, "Demo");
        assert_eq!(info.version, "2.1.0");
        assert_eq!(info.api_version, "^1.0.0");
        assert_eq!(info.description.as_deref(), Some("d"));
        assert_eq!(info.main, "index.js");
    }

    #[test]
    fn parse_manifest_defaults_main_to_main_js() {
        let info = parse_manifest(
            r#"{"id":"com.x.demo","name":"Demo","version":"1.0.0","apiVersion":"^1.0.0"}"#,
        )
        .unwrap();
        assert_eq!(info.main, "main.js");
    }

    #[test]
    fn parse_manifest_rejects_missing_required_fields() {
        for json in [
            r#"{}"#,
            r#"{"id":"a"}"#,
            r#"{"id":"a","name":"n"}"#,
            r#"{"id":"a","name":"n","version":"1.0.0"}"#,
            r#"{"id":"  ","name":"n","version":"1.0.0","apiVersion":"^1.0.0"}"#,
        ] {
            assert!(parse_manifest(json).is_err(), "should reject: {json}");
        }
    }

    #[test]
    fn parse_manifest_rejects_unsafe_ids_and_entries() {
        let with_id = |id: &str| {
            format!(r#"{{"id":"{id}","name":"n","version":"1.0.0","apiVersion":"^1.0.0"}}"#)
        };
        for id in ["../evil", "a/b", "a\\b", ".hidden", "spa ce"] {
            assert!(
                parse_manifest(&with_id(id)).is_err(),
                "should reject id {id}"
            );
        }
        let bad_main =
            r#"{"id":"ok.id","name":"n","version":"1.0.0","apiVersion":"^1.0.0","main":"../x.js"}"#;
        assert!(parse_manifest(bad_main).is_err());
    }

    #[test]
    fn parse_manifest_rejects_invalid_json() {
        assert!(parse_manifest("not json").is_err());
    }

    #[test]
    fn parse_manifest_rejects_backslash_in_main() {
        let json = r#"{"id":"ok.id","name":"n","version":"1.0.0","apiVersion":"^1.0.0","main":"sub\\x.js"}"#;
        assert!(parse_manifest(json).is_err());
    }

    #[test]
    fn parse_manifest_rejects_a_files_list_over_the_cap() {
        let mut files: Vec<String> = vec![String::from("\"main.js\"")];
        files.extend((0..MAX_PACKAGE_FILES).map(|i| format!("\"a{i}.txt\"")));
        let json = format!(
            r#"{{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"0.16.0","files":[{}]}}"#,
            files.join(",")
        );
        let err = parse_manifest(&json).unwrap_err();
        assert!(err.contains("more than"), "unexpected error: {err}");
    }

    #[test]
    fn parse_manifest_validates_the_files_whitelist() {
        let with_files = |files: &str| {
            format!(
                r#"{{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"0.16.0","files":{files}}}"#
            )
        };
        let ok = parse_manifest(&with_files(r#"["main.js","assets/fa.dic"]"#)).unwrap();
        assert_eq!(ok.files, ["main.js", "assets/fa.dic"]);
        assert_eq!(ok.install_files(), ok.files);

        // Legacy manifest: no files -> install just the entry.
        let legacy =
            parse_manifest(r#"{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"0.16.0"}"#)
                .unwrap();
        assert_eq!(legacy.install_files(), ["main.js"]);

        for bad in [
            r#"["assets/fa.dic"]"#,       // must include main
            r#"["main.js","../escape"]"#, // traversal
            r#"["main.js","/abs"]"#,      // absolute
            r#"["main.js","a\\b"]"#,      // backslash
            r#"["main.js","c:evil"]"#,    // drive colon
            r#"["main.js",""]"#,          // empty
            r#"["main.js","a//b"]"#,      // empty segment
            r#"["main.js","./x"]"#,       // dot segment
            r#""main.js""#,               // not an array
            r#"[1]"#,                     // not strings
        ] {
            assert!(
                parse_manifest(&with_files(bad)).is_err(),
                "should reject files={bad}"
            );
        }
    }

    #[test]
    fn parse_manifest_reads_sandbox_flag() {
        let with_sandbox = |v: &str| {
            format!(
                r#"{{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"^1.0.0","sandbox":{v}}}"#
            )
        };
        assert!(parse_manifest(&with_sandbox("true")).unwrap().sandbox);
        assert!(!parse_manifest(&with_sandbox("false")).unwrap().sandbox);
        assert!(
            !parse_manifest(r#"{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"^1.0.0"}"#)
                .unwrap()
                .sandbox
        );
        assert!(parse_manifest(&with_sandbox("\"yes\"")).is_err());
    }

    #[test]
    fn parse_manifest_reads_permissions() {
        let info = parse_manifest(
        r#"{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"^1.0.0","permissions":["workspace:read","network:example.com"]}"#,
    )
    .unwrap();
        assert_eq!(info.permissions, ["workspace:read", "network:example.com"]);
    }

    #[test]
    fn parse_manifest_defaults_permissions_to_empty() {
        let info =
            parse_manifest(r#"{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"^1.0.0"}"#)
                .unwrap();
        assert!(info.permissions.is_empty());
    }

    #[test]
    fn parse_manifest_rejects_non_string_permissions() {
        for json in [
            r#"{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"^1.0.0","permissions":"workspace:read"}"#,
            r#"{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"^1.0.0","permissions":[1]}"#,
        ] {
            assert!(parse_manifest(json).is_err(), "should reject: {json}");
        }
    }
}
