import { createContext, useContext } from "react";

// Carries what an embedded note needs to render itself down to EmbedComponent,
// which react-markdown instantiates without a way to pass extra props. `chain`
// is the list of file paths currently being rendered above this point; each
// nested MarkdownContent appends its own file, so an embed whose target is
// already in the chain is a cycle and renders a placeholder instead of looping.
export interface EmbedContextValue {
  workspaceFiles?: string[];
  onOpenWikilink?: (path: string, heading?: string) => void;
  chain: string[];
}

export const EmbedContext = createContext<EmbedContextValue>({ chain: [] });

export function useEmbedContext(): EmbedContextValue {
  return useContext(EmbedContext);
}
