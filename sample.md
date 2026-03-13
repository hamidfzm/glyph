# Welcome to Glyph

A modern, cross-platform markdown viewer with platform-native styling.

## Features

- **Live reload** — edit this file and watch it update instantly
- **GFM support** — tables, task lists, strikethrough, and more
- **Syntax highlighting** — beautiful code blocks out of the box
- **Dark mode** — follows your system theme automatically
- **Table of Contents** — navigate long documents with ease

## Code Example

```rust
fn main() {
    println!("Hello from Glyph!");
    let numbers: Vec<i32> = (1..=10).filter(|n| n % 2 == 0).collect();
    println!("Even numbers: {:?}", numbers);
}
```

```typescript
interface MarkdownFile {
  name: string;
  path: string;
  content: string;
  modified: number;
}

function readingTime(words: number): string {
  const minutes = Math.max(1, Math.ceil(words / 230));
  return `${minutes} min read`;
}
```

## GFM Table

| Feature         | Status |
|-----------------|--------|
| Markdown render | Done   |
| File watching   | Done   |
| Sidebar TOC     | Done   |
| Dark mode       | Done   |
| Homebrew cask   | Done   |

## Task List

- [x] Set up Tauri v2 project
- [x] Implement markdown rendering
- [x] Add file watcher
- [x] Platform-adaptive styling
- [ ] Add more themes
- [ ] Plugin system

## Blockquote

> "The best interface is no interface."
>
> — Golden Krishna

## Nested List

1. Frontend
   - React 19
   - Tailwind CSS v4
   - react-markdown
2. Backend
   - Tauri v2 (Rust)
   - notify crate for file watching
3. Distribution
   - GitHub Actions CI/CD
   - Homebrew Cask

---

*Built with Glyph — view your markdown beautifully.*
