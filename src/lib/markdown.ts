export function countWords(text: string): number {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/[#*_~\[\]()>|+-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

export function readingTime(wordCount: number): string {
  const minutes = Math.max(1, Math.ceil(wordCount / 230));
  return `${minutes} min read`;
}
