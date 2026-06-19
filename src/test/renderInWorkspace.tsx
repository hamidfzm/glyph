import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { WorkspaceRootContext } from "@/contexts/WorkspaceRootContext";

// Render with an opened workspace root in context, the value components read via
// useWorkspaceRoot instead of a prop. Use in tests that exercise relative-path
// resolution and root clamping.
export function renderInWorkspace(ui: ReactNode, root = "/ws") {
  return render(<WorkspaceRootContext.Provider value={root}>{ui}</WorkspaceRootContext.Provider>);
}
