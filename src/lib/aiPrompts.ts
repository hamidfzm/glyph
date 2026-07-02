// Prompt construction for the AI assistant: the conversation-level system
// prompt (assistant persona + open-document context) and the canned user
// prompts behind the quick actions. Pure string building, no React.

export type AIAction = "summarize" | "explain" | "translate" | "simplify";

export const AI_ACTIONS: readonly AIAction[] = ["summarize", "explain", "translate", "simplify"];

export interface AIDocContext {
  /** Text of the active document; empty for non-text files (images, etc.). */
  content: string;
  /** File path or name, shown to the model so it can refer to the document. */
  path?: string;
  /** Root of the open folder workspace, when there is one. */
  workspaceRoot?: string;
  /** Files in the workspace, so the assistant can answer questions about it. */
  workspaceFiles?: readonly string[];
}

// Documents are sent whole up to this budget; local models have modest context
// windows, so the tail is dropped past it with an explicit truncation note.
const MAX_DOC_CONTEXT_CHARS = 24_000;
// Workspace listings are context, not content; huge vaults get elided.
const MAX_WORKSPACE_FILES = 200;

const BASE_SYSTEM_PROMPT = [
  "You are the AI assistant built into Glyph, a markdown viewer.",
  "Respond in GitHub-flavored markdown and keep answers focused and concise.",
  "When you reference a specific passage of the open document, quote it verbatim in a markdown blockquote so the app can highlight it in the document.",
].join(" ");

/**
 * Assemble the AI context from the app's view state. Returns null when there
 * is truly nothing open, so the assistant doesn't hallucinate a document.
 */
export function aiDocContext(source: {
  path?: string;
  content: string | null;
  workspaceRoot?: string;
  workspaceFiles?: readonly string[];
}): AIDocContext | null {
  const { path, content, workspaceRoot, workspaceFiles } = source;
  if (!path && !content && !workspaceRoot) return null;
  return {
    content: content ?? "",
    path,
    workspaceRoot,
    workspaceFiles: workspaceRoot ? workspaceFiles : undefined,
  };
}

/** Build the system prompt, embedding the workspace and open document. */
export function buildSystemPrompt(doc: AIDocContext | null): string {
  if (!doc) return BASE_SYSTEM_PROMPT;
  const parts = [BASE_SYSTEM_PROMPT];

  if (doc.workspaceRoot) {
    const files = doc.workspaceFiles ?? [];
    const listed = files.slice(0, MAX_WORKSPACE_FILES);
    const elided = files.length - listed.length;
    parts.push(
      `The user has the folder workspace ${doc.workspaceRoot} open.${
        listed.length > 0
          ? ` Files in the workspace:\n${listed.join("\n")}${
              elided > 0 ? `\n[and ${elided} more]` : ""
            }`
          : ""
      }`,
    );
  }

  if (doc.content) {
    const truncated =
      doc.content.length > MAX_DOC_CONTEXT_CHARS
        ? `${doc.content.slice(0, MAX_DOC_CONTEXT_CHARS)}\n\n[Document truncated]`
        : doc.content;
    const name = doc.path ? ` (${doc.path})` : "";
    parts.push(`The user has this document open${name}:\n\n---\n${truncated}\n---`);
  } else if (doc.path) {
    parts.push(
      `The active file is ${doc.path}. Its content is not readable text (an image, notebook, or diagram), so say so rather than guessing if asked about its contents.`,
    );
  }

  return parts.join("\n\n");
}

const DOCUMENT_PROMPTS: Record<AIAction, string> = {
  summarize: "Summarize the open document concisely.",
  explain: "Explain the open document in simple terms.",
  translate:
    "Detect the language of the open document and translate it to English. If it is already in English, translate it to Spanish.",
  simplify:
    "Rewrite the open document in simplified form: simple words and short sentences, keeping the meaning.",
};

const SELECTION_PROMPTS: Record<AIAction, (text: string) => string> = {
  summarize: (text) => `Summarize the following passage concisely:\n\n${text}`,
  explain: (text) => `Explain the following passage in simple terms:\n\n${text}`,
  translate: (text) =>
    `Detect the language of the following passage and translate it to English. If it is already in English, translate it to Spanish:\n\n${text}`,
  simplify: (text) =>
    `Rewrite the following passage in simplified form: simple words and short sentences, keeping the meaning:\n\n${text}`,
};

/**
 * The user-message prompt for a quick action. With a selection the passage is
 * embedded; without one the prompt refers to the document already carried in
 * the system prompt, so the text is never sent twice.
 */
export function actionPrompt(action: AIAction, selection?: string): string {
  return selection ? SELECTION_PROMPTS[action](selection) : DOCUMENT_PROMPTS[action];
}
