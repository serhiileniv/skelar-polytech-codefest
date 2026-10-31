import type { Verdict } from "@/api";

import { groupSteps, type TraceItem } from "./investigate-trace";
import { FINAL_TOOLS, countOf, metaOf, plural } from "./tool-meta";

export type BubbleToolState = "running" | "done" | "failed";

export interface BubbleTool {
  /** "Checking billing" while running, "Checked billing" once done. */
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

export interface Reason {
  text: string;
  ids: string[];
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
    label: state === "running" ? meta.running : meta.done,
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

/** "Because" bullets: one per cited record; the summary when nothing is cited. */
export function verdictReasons(v: Verdict): Reason[] {
  if (v.evidence.length === 0) return [{ text: v.summary, ids: [] }];
  return v.evidence.map((e) => ({ text: e.note, ids: [e.id] }));
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

/** Quick questions under the Ask input. */
export const QUICK_QUESTIONS = [
  "Why this outcome?",
  "What evidence?",
  "What if I refund?",
] as const;
