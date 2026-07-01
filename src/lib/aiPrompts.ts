// Prompt construction for the AI assistant: the conversation-level system
// prompt (assistant persona + open-document context) and the canned user
// prompts behind the quick actions. Pure string building, no React.

export type AIAction = "summarize" | "explain" | "translate" | "simplify";

export const AI_ACTIONS: readonly AIAction[] = ["summarize", "explain", "translate", "simplify"];

export interface AIDocContext {
  content: string;
  /** File path or name, shown to the model so it can refer to the document. */
  path?: string;
}

// Documents are sent whole up to this budget; local models have modest context
// windows, so the tail is dropped past it with an explicit truncation note.
const MAX_DOC_CONTEXT_CHARS = 24_000;

const BASE_SYSTEM_PROMPT = [
  "You are the AI assistant built into Glyph, a markdown viewer.",
  "Respond in GitHub-flavored markdown and keep answers focused and concise.",
  "When you reference a specific passage of the open document, quote it verbatim in a markdown blockquote so the app can highlight it in the document.",
].join(" ");

/** Build the system prompt, embedding the open document as context. */
export function buildSystemPrompt(doc: AIDocContext | null): string {
  if (!doc?.content) return BASE_SYSTEM_PROMPT;
  const truncated =
    doc.content.length > MAX_DOC_CONTEXT_CHARS
      ? `${doc.content.slice(0, MAX_DOC_CONTEXT_CHARS)}\n\n[Document truncated]`
      : doc.content;
  const name = doc.path ? ` (${doc.path})` : "";
  return `${BASE_SYSTEM_PROMPT}\n\nThe user has this document open${name}:\n\n---\n${truncated}\n---`;
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
