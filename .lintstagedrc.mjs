// lint-staged config. Per-file frontend formatting + linting via Biome
// goes through the normal "string command + appended file paths" form;
// `cargo fmt --check` runs once over the whole workspace when any Rust
// file is staged. The function-returning-string form is what tells
// lint-staged "this command runs as-is, do not append the staged file
// list" — otherwise cargo would try to interpret the file paths as
// extra arguments.

export default {
  "src/**/*.{ts,tsx,js,jsx,css}":
    "biome check --error-on-warnings --write --no-errors-on-unmatched",
  "src-tauri/**/*.rs": () =>
    "cargo fmt --manifest-path src-tauri/Cargo.toml --check",
};
