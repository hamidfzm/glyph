/** Names a contribution across plugins: an id is only unique within its own plugin. */
export function contributionKey(entry: { pluginId: string; id: string }): string {
  return `${entry.pluginId}/${entry.id}`;
}
