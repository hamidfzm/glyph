import { useCallback, useContext } from "react";
import { TabsContext } from "@/contexts/TabsContext";

// Create the note a broken wikilink points at (at the workspace root, named
// after the target) and open it. Reads the tabs context optionally, like
// useWorkspaceRoot, so the shared renderers that run without a provider get
// null and hide the affordance instead of throwing.
export function useCreateWikilinkNote(): ((target: string) => Promise<void>) | null {
  const ctx = useContext(TabsContext);
  const root = ctx?.workspace?.root;
  const createNote = ctx?.createNote;
  const renamePath = ctx?.renamePath;
  const openFile = ctx?.openFile;

  const create = useCallback(
    async (target: string) => {
      if (!root || !createNote || !renamePath || !openFile) return;
      const created = await createNote(root);
      if (!created) return;
      // rename_path keeps the .md extension when the name carries none, and
      // resolves collisions, so the target name goes through as authored.
      const renamed = await renamePath(created, target);
      await openFile(renamed ?? created);
    },
    [root, createNote, renamePath, openFile],
  );

  return root ? create : null;
}
