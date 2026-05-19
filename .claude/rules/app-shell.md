---
paths:
  - "src/components/App.tsx"
  - "src/components/AppShell.tsx"
---

# App Shell Rules

`src/components/App.tsx` is the root provider stack. `src/components/AppShell.tsx` is the wiring shell beneath it. Both must stay focused. Do not grow them just to ship a new feature — extract instead, even for a one-line addition.

- **App.tsx mounts providers and global side-effects only.** Theme application (`useTheme`, `useCodeThemeStyle`) belongs here because it has no business logic. Anything that touches tabs, settings persistence, menu events, AI, TTS, print, or autosave belongs *below* the provider boundary, in `AppShell` or in a hook it calls.
- **Don't add new inline `useEffect` blocks, callbacks, or state to AppShell.** Extract into a focused hook in `src/hooks/` (`useXxx.ts`) with its own test, then call the hook from AppShell. Examples already in place: `useMenuEvents`, `useSidebarLayout`, `useFontZoom`, `useAIController`, `useReadAloudController`, `useNativeMenuState`, `useDocumentUndoRedo`.
- **Pass shared state via context, not props.** If a value from `useTabs` or `useSidebarLayout` is needed in more than one child, expose it through the matching provider (`TabsProvider`, `SidebarLayoutProvider`) and read it with `useTabsContext` / `useSidebarLayoutContext`. Don't re-add prop drilling to TabBar, Sidebar, StatusBar, or `TabContent`.
- **Render-mode branching belongs in its own component.** `TabContent` owns the view/edit/split switch; don't reintroduce an inline `renderContent` in AppShell.
- **Hook order over comment scaffolding.** If a section of AppShell needs a header comment to be navigable ("// AI", "// Print", "// Menu events"), that section is a hook waiting to be extracted.

When in doubt: if a change adds more than ~3 lines to App.tsx or AppShell.tsx, write a hook or a provider for it instead.
