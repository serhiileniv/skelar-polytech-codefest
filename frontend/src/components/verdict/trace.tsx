"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import {
  awaitingAgent,
  currentThought,
  sourcesChecked,
  toBubbles,
  type StepBubble,
} from "./conversation-view";
import {
  HIGHLIGHT_CLASS,
  useEvidenceFocus,
  useEvidenceTarget,
} from "./evidence-focus";
import type { TraceState } from "./investigate-trace";
import { IdChip } from "./outcome-badge";

/** Chips shown before collapsing the rest into "+N". */
const MAX_ID_CHIPS = 4;

const NO_IDS: string[] = [];

/** Clickable record ids; a click highlights the record (evidence focus). */
export function IdChips({ ids }: { ids: readonly string[] }) {
  const { focus } = useEvidenceFocus();
  const shown = ids.slice(0, MAX_ID_CHIPS);
  const rest = ids.length - shown.length;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {shown.map((id) => (
        <IdChip key={id} id={id} onClick={() => focus(id)} />
      ))}
      {rest > 0 && (
        <span
          title={ids.slice(MAX_ID_CHIPS).join(", ")}
          className="text-[12px] text-zinc-500 tabular-nums"
        >
          +{rest}
        </span>
      )}
    </div>
  );
}

interface RunStepsProps {
  trace: TraceState;
  running: boolean;
  /** Prefix for the status, e.g. "Fix-it". */
  label?: string;
  /** Adds "Checked n sources" to the finished line (Investigate). */
  countSources?: boolean;
  /** Right side of the finished line, e.g. Re-run. */
  trailing?: React.ReactNode;
}

/** "Step n of 8" / "Done · n steps". */
function runStatus(trace: TraceState, running: boolean, label?: string) {
  const prefix = label ? `${label} · ` : "";
  if (running)
    return `${label ? `${label} · step` : "Step"} ${Math.max(trace.steps, 1)} of ${trace.maxSteps}`;
  const steps = `${trace.steps} ${trace.steps === 1 ? "step" : "steps"}`;
  return `${prefix}${trace.error ? "Stopped" : "Done"} · ${steps}`;
}

/** Live: one line per step, the agent's thought under the current one. Done: one collapsible line. */
export function RunSteps({
  trace,
  running,
  label,
  countSources,
  trailing,
}: RunStepsProps) {
  const [open, setOpen] = useState(false);
  const bubbles = toBubbles(trace.items);
  const expanded = running || open;
  const sources = sourcesChecked(trace.items);
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <header className="flex items-center gap-2 px-3 py-2 text-[12px] leading-4">
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            running
              ? "bg-indigo-500"
              : trace.error
                ? "bg-[#b42318]"
                : "bg-[#2f7d55]",
          )}
        />
        <span className="truncate">
          <span className="font-medium text-zinc-900 tabular-nums">
            {runStatus(trace, running, label)}
          </span>
          {!running && countSources && sources > 0 && (
            <span className="text-zinc-500 tabular-nums">
              {" "}
              · Checked {sources} {sources === 1 ? "source" : "sources"}
            </span>
          )}
        </span>
        {trace.started && (
          <span className="shrink-0 text-zinc-400">
            {trace.replay ? "replay" : "live"}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {!running && bubbles.length > 0 && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className="rounded px-1 font-medium text-indigo-700 hover:text-indigo-800 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none"
            >
              {open ? "Hide steps" : "Show steps"}
            </button>
          )}
          {!running && trailing}
        </span>
      </header>
      {running && (
        <div className="h-0.5 bg-zinc-100">
          <div
            className="h-full bg-indigo-500 transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{
              width: `${Math.min(100, (trace.steps / trace.maxSteps) * 100)}%`,
            }}
          />
        </div>
      )}
      {expanded && (
        <StepLines bubbles={bubbles} running={running} trace={trace} />
      )}
    </section>
  );
}

function StepLines({
  bubbles,
  running,
  trace,
}: {
  bubbles: StepBubble[];
  running: boolean;
  trace: TraceState;
}) {
  const thought = currentThought(bubbles, running);
  const lines = bubbles.filter((b) => b.tool);
  return (
    <ol className="space-y-0.5 border-t border-zinc-100 px-3 py-2">
      {lines.map((b) => (
        <StepLine
          key={b.key}
          bubble={b}
          thought={b.key === thought.key ? thought.text : null}
        />
      ))}
      {awaitingAgent(bubbles, running) && (
        <li className="animate-in fade-in-0 duration-200 motion-reduce:animate-none">
          <div className="flex items-center gap-2 text-[13px] leading-5 text-zinc-500">
            <LineDot state="running" />
            {trace.items.length === 0 ? "Starting…" : "Thinking…"}
          </div>
          {thought.key === null && thought.text && (
            <Thought text={thought.text} />
          )}
        </li>
      )}
    </ol>
  );
}

function StepLine({
  bubble,
  thought,
}: {
  bubble: StepBubble;
  thought: string | null;
}) {
  const tool = bubble.tool;
  const ids = tool?.ids ?? NO_IDS;
  const { attrs, highlighted } = useEvidenceTarget(ids, { reference: true });
  if (!tool) return null;
  return (
    <li
      {...attrs}
      title={ids.length > 0 ? ids.join(", ") : undefined}
      className={cn(
        "animate-in fade-in-0 -mx-1 px-1 duration-200 motion-reduce:animate-none",
        highlighted && HIGHLIGHT_CLASS,
      )}
    >
      <div className="flex items-center gap-2 text-[13px] leading-5">
        <LineDot state={tool.state} />
        {tool.state === "running" ? (
          <span className="truncate text-zinc-900">{tool.label}…</span>
        ) : tool.state === "failed" ? (
          <span className="truncate text-[#b42318]">
            {tool.label} failed
            {tool.errorText ? ` · ${tool.errorText}` : ""}
          </span>
        ) : (
          <span className="truncate text-zinc-700">
            {tool.label}
            {tool.count && (
              <span className="text-zinc-500 tabular-nums">
                {" "}
                · {tool.count}
              </span>
            )}
          </span>
        )}
      </div>
      {thought && <Thought text={thought} />}
    </li>
  );
}

function Thought({ text }: { text: string }) {
  return (
    <p className="line-clamp-3 pb-1 pl-3.5 text-[12px] leading-4 whitespace-pre-line text-zinc-500">
      {text}
    </p>
  );
}

const LINE_DOT = {
  running: "bg-indigo-500 animate-pulse motion-reduce:animate-none",
  done: "bg-zinc-300",
  failed: "bg-[#b42318]",
} as const;

function LineDot({ state }: { state: keyof typeof LINE_DOT }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", LINE_DOT[state])}
    />
  );
}
