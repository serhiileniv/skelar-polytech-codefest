import type { Platform, Verdict } from "@/api";

/** Reply + numbered steps; steps are skipped when the model already put them in replyDraft. */
export function instructionText(v: Verdict): string {
  const steps = (v.instructionSteps ?? []).filter((s) => s.trim() !== "");
  if (steps.length === 0) return v.replyDraft;
  if (v.replyDraft.includes(steps[0].trim())) return v.replyDraft;
  const list = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return v.replyDraft.trim() ? `${v.replyDraft}\n\n${list}` : list;
}

/** Backend sends rule "-" when no policy rule applied. */
export function actionToastMessage(message: string, rule: string): string {
  const r = rule.trim();
  return r === "" || r === "-" ? message : `${message} · rule ${r}`;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  ios: "iOS",
  android: "Android",
  web: "Web",
};

export function platformLabel(platform: Platform): string {
  return PLATFORM_LABEL[platform] ?? platform;
}

export type TextPart = { text: string } | { id: string };

const RECORD_ID = /\b((?:msg|sub|pay|ent|ev|err|cust|help)_\w+)\b/;

/** Splits prose into text and record ids, so ids can render as chips. */
export function splitRecordIds(text: string): TextPart[] {
  return text
    .split(new RegExp(RECORD_ID.source, "g"))
    .map((part, i): TextPart => (i % 2 === 1 ? { id: part } : { text: part }))
    .filter((p) => !("text" in p) || p.text !== "");
}
