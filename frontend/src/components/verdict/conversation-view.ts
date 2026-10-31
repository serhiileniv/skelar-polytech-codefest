import type { CaseDetail, ChatMessage, TechIssue, Verdict } from "@/api";

import { fixAllowed } from "./fix-view";
import { groupSteps, type TraceItem } from "./investigate-trace";
import { FINAL_TOOLS, countOf, metaOf, plural } from "./tool-meta";

export type BubbleToolState = "running" | "done" | "failed";

export interface BubbleTool {
  /** "Checking billing" while running, "Billing" once done. */
  label: string;
  /** "2 payments"; null when the output has nothing to count. */
  count: string | null;
  /** Evidence ids the tool returned (empty for final tools). */
  ids: string[];
  state: BubbleToolState;
  errorText?: string;
}

/** One agent turn in the conversation: what it says, then what it checked. */
export interface StepBubble {
  key: string;
  text: string | null;
  /** Null for a thought without a tool, or for the final submit step. */
  tool: BubbleTool | null;
}

/** Words ending in -ing that are not a gerund opener. */
const NOT_GERUNDS = new Set(["nothing", "something", "everything", "anything"]);

/** "Checking billing." → "I'm checking billing."; text already in first person is kept. */
export function firstPerson(text: string): string {
  const t = text.trim();
  const m = /^([A-Z][a-z]+ing)\s+\S/.exec(t);
  if (!m || NOT_GERUNDS.has(m[1].toLowerCase())) return t;
  return `I'm ${t[0].toLowerCase()}${t.slice(1)}`;
}

function toolOf(item: Extract<TraceItem, { kind: "tool" }>): BubbleTool | null {
  if (FINAL_TOOLS.has(item.name)) return null;
  const meta = metaOf(item.name);
  const state: BubbleToolState =
    item.state === "output-available"
      ? "done"
      : item.state === "output-error"
        ? "failed"
        : "running";
  const ids = item.ids ?? [];
  const n =
    state !== "done"
      ? null
      : meta.noun
        ? countOf(item.output, meta.keys)
        : ids.length || null;
  return {
    label: state === "running" ? meta.running : (meta.subject ?? meta.done),
    count: n === null ? null : plural(n, meta.noun ?? "record"),
    ids: state === "done" ? ids : [],
    state,
    errorText: item.errorText,
  };
}

/** Maps the SSE trace to agent bubbles; empty bubbles (final tool, no text) are dropped. */
export function toBubbles(items: readonly TraceItem[]): StepBubble[] {
  return groupSteps(items)
    .map((node) => ({
      key: node.key,
      text: node.thought ? firstPerson(node.thought) : null,
      tool: node.tool ? toolOf(node.tool) : null,
    }))
    .filter((b) => b.text !== null || b.tool !== null);
}

/** Show typing dots after the last bubble while the agent is between tool calls. */
export function awaitingAgent(
  bubbles: readonly StepBubble[],
  running: boolean,
): boolean {
  if (!running) return false;
  const last = bubbles.at(-1);
  return !last || last.tool?.state !== "running";
}

/** Finished read tools in a run: "Checked 6 sources". */
export function sourcesChecked(items: readonly TraceItem[]): number {
  return items.filter(
    (i) =>
      i.kind === "tool" &&
      i.state === "output-available" &&
      !FINAL_TOOLS.has(i.name),
  ).length;
}

export interface CurrentThought {
  /** Key of the running step line the thought belongs under; null when the agent is between tools. */
  key: string | null;
  text: string | null;
}

/** The agent's words for the step in progress only; finished steps show just their line. */
export function currentThought(
  bubbles: readonly StepBubble[],
  running: boolean,
): CurrentThought {
  const last = bubbles.at(-1);
  if (!running || !last) return { key: null, text: null };
  if (last.tool?.state === "running") return { key: last.key, text: last.text };
  return { key: null, text: last.tool ? null : last.text };
}

export type PrimaryAction =
  | "fix"
  | "support_action"
  | "insert_instruction"
  | "send_to_tech"
  | "ask_clarifying";

export type OtherAction = "support_action" | "insert_instruction";

export interface NextStepActions {
  /** The one highlighted action; null for `suspicious`. */
  primary: PrimaryAction | null;
  /** Manual alternatives behind "Other actions". */
  other: OtherAction[];
  /** "Use reply draft" as a secondary text button. */
  reply: boolean;
}

/** One primary action per outcome; Fix-it wins when rule F1 allows it, the manual action moves to "Other actions". */
export function nextStepActions(v: Verdict): NextStepActions {
  const reply = v.outcome !== "need_more_info" && v.replyDraft.trim() !== "";
  const canFix = fixAllowed(v);
  switch (v.outcome) {
    case "support_can_fix": {
      const manual: OtherAction[] = v.supportAction ? ["support_action"] : [];
      if (canFix) return { primary: "fix", other: manual, reply };
      return { primary: manual[0] ?? null, other: [], reply };
    }
    case "user_can_fix":
      if (canFix)
        return { primary: "fix", other: ["insert_instruction"], reply };
      return { primary: "insert_instruction", other: [], reply };
    case "tech_team":
      return { primary: "send_to_tech", other: [], reply };
    case "need_more_info":
      return { primary: "ask_clarifying", other: [], reply };
    case "suspicious":
      return { primary: null, other: [], reply };
  }
}

/** Above this the customer's goal is left out; the summary already covers it. */
const SHORT_GOAL_CHARS = 70;

export function shortGoal(v: Verdict): string | null {
  const goal = v.customerGoal.trim();
  return goal !== "" && goal.length <= SHORT_GOAL_CHARS ? goal : null;
}

/** Ids shown on the Customer tab; an evidence click on one switches to it. */
export function customerRecordIds(detail: CaseDetail): Set<string> {
  return new Set([
    detail.customer.id,
    ...detail.subscriptions.map((s) => s.id),
    ...detail.payments.map((p) => p.id),
    ...detail.entitlements.map((e) => e.id),
  ]);
}

export function confidencePct(v: Verdict): number {
  return Math.round(Math.min(1, Math.max(0, v.confidence)) * 100);
}

/** An inserted suggestion types in over this long regardless of text length. */
export const TYPEWRITER_MS = 1000;

/** Characters shown `elapsedMs` into a typewriter run over `durationMs`. */
export function typewriterLength(
  total: number,
  elapsedMs: number,
  durationMs: number = TYPEWRITER_MS,
): number {
  if (total <= 0) return 0;
  if (durationMs <= 0 || elapsedMs >= durationMs) return total;
  return Math.min(
    total,
    Math.max(0, Math.ceil((total * elapsedMs) / durationMs)),
  );
}

/** Quick questions above the Ask input, until the first question. */
export const QUICK_QUESTIONS = [
  "Show the evidence chain",
  "Which records prove it?",
  "What if I refund?",
] as const;

/** Customers hit by the verdict's tech issue: the board card for its signature, else "N customers" in the root cause / summary. */
export function affectedCount(
  v: Verdict,
  board: readonly TechIssue[] | null,
): number | null {
  const sig = v.techIssue?.signature;
  if (!sig) return null;
  const card = board?.find((t) => t.signature === sig);
  if (card) return card.affectedCustomerIds.length;
  const m = /(\d+) customers/.exec(`${v.techIssue?.rootCause} ${v.summary}`);
  return m ? Number(m[1]) : null;
}

/** Quote length for the injected text shown on a suspicious verdict. */
export const INJECTION_QUOTE_CHARS = 90;
const INJECTION_START = /system|ignore (all|previous)|admin mode|override/i;

/** First ~90 chars of the first cited chat message, starting at the injected instruction when one is found. */
export function injectionQuote(
  v: Verdict,
  messages: readonly ChatMessage[],
): string | null {
  const byId = new Map(messages.map((m) => [m.id, m.body]));
  const body = v.evidence.map((e) => byId.get(e.id)).find(Boolean);
  if (!body) return null;
  const flat = body.replace(/\s+/g, " ").trim();
  const at = flat.search(INJECTION_START);
  const text = at > 0 ? flat.slice(at) : flat;
  return text.length > INJECTION_QUOTE_CHARS
    ? `${text.slice(0, INJECTION_QUOTE_CHARS).trimEnd()}…`
    : text;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}
