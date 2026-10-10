---
paths:
  - "src-tauri/**/*.rs"
---

# Rust Rules

- All Tauri commands must return `Result<T, String>` or `Option<T>` for proper frontend error handling
- Use `serde(rename_all = "camelCase")` on structs returned to the frontend
- File watcher state is the managed `FileWatcherState` in `watcher.rs` (`Arc<Mutex<HashMap<String, RecommendedWatcher>>>`)
- Register all commands in `lib.rs` via `generate_handler![]`
- Import Tauri traits explicitly (`Emitter`, `Manager`, `StoreExt`); they're not in prelude
