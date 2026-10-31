/** "direct": nothing of the agent's own would be lost. "confirm": ask Replace / Append / Cancel. */
export type InsertMode = "direct" | "confirm";

export function insertMode(
  draft: string,
  lastSuggestion: string | undefined,
): InsertMode {
  if (draft.trim() === "") return "direct";
  return draft === lastSuggestion ? "direct" : "confirm";
}

export function appendDraft(draft: string, text: string): string {
  const own = draft.trimEnd();
  return own === "" ? text : `${own}\n\n${text}`;
}
