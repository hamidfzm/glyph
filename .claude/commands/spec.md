---
description: Turn a rough idea into a structured GitHub issue (the spec) with acceptance criteria and tasks
argument-hint: <rough idea, e.g. "add a word-count item to the status bar">
allowed-tools: Bash(gh issue *), Bash(gh project *), Bash(gh label *), Bash(git *), Read, Grep, Glob, Task
---

You are the **spec** stage of Glyph's spec-driven workflow. The GitHub issue body is the single source of truth for a feature. Your job: turn the user's idea into a well-formed, implementable issue, not to write any code.

Idea: **$ARGUMENTS**

## Steps

1. **Ground the idea in the codebase.** Launch an `Explore` agent (or read directly for a small idea) to find the components, hooks, Rust commands, settings, and menu items the feature would touch. Reference `src/components/`, `src/hooks/`, `src/lib/`, `src-tauri/src/`, `src/lib/settings.ts`, and `src-tauri/src/menu.rs` as relevant. Note existing patterns to reuse, and do not propose new code where something already exists.

2. **Draft the spec** matching the Feature Request issue template (`.github/ISSUE_TEMPLATE/feature_request.yml`). Sections:
   - **Problem**: the user need / frustration, concrete.
   - **Proposed Solution**: what we'll build, grounded in the files you found.
   - **Acceptance Criteria**: a `- [ ]` checklist of observable, testable outcomes. These define "done".
   - **Scope / Out of scope**: what this issue does and explicitly does not cover.
   - **Implementation Tasks**: a `- [ ]` checklist (frontend, Rust, tests, docs). Keep coarse; `/plan` refines it.
   - **Affected areas**: pick from markdown rendering, layout / app-shell, modals, Rust backend, settings, build / CI.
   - **Platform**: All / macOS / Windows / Linux.

3. **Resolve ambiguity first.** If scope or acceptance criteria are genuinely ambiguous, ask the user before creating anything. Never invent acceptance criteria silently.

4. **Show the full draft** and get a confirmation. Only after the user approves:
   - Create the issue with an **imperative-mood title** (per CONTRIBUTING.md, e.g. "Add word count to the status bar"):
     ```
     gh issue create --title "<imperative title>" --body "<spec markdown>" \
       --assignee hamidfzm \
       --label enhancement --label "priority: <low|medium|high>" --label <category>
     ```
     Category labels where they fit: `markdown`, `ui`, `navigation` (check `gh label list` first; omit if none fit).
   - Add it to the **Glyph Roadmap** project board with status **Todo** (`gh project item-add`; resolve the project number via `gh project list --owner hamidfzm`).
   - Print the new issue URL and tell the user the next step is `/plan <issue-number>`.

Keep writing tight and free of em dashes. Do not start implementing; that is `/implement`.
