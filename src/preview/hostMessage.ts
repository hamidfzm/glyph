// What the preview handler DLL posts to the page (document.rs builds it).
export type HostMessage =
  | { kind: "document"; content: string; baseUrl: string }
  | { kind: "tooLarge"; bytes: number }
  | { kind: "unreadable" };

/** The message the host posted, or null for anything else. */
export function parseHostMessage(data: unknown): HostMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  switch (message.kind) {
    case "document":
      if (typeof message.content !== "string" || typeof message.baseUrl !== "string") return null;
      return { kind: "document", content: message.content, baseUrl: message.baseUrl };
    case "tooLarge":
      if (typeof message.bytes !== "number") return null;
      return { kind: "tooLarge", bytes: message.bytes };
    case "unreadable":
      return { kind: "unreadable" };
    default:
      return null;
  }
}
