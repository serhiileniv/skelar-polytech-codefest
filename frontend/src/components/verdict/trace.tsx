"use client";

import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  HIGHLIGHT_CLASS,
  useEvidenceFocus,
  useEvidenceTarget,
} from "./evidence-focus";
import {
  groupSteps,
  type TraceNode,
  type TraceState,
} from "./investigate-trace";
import { IdChip } from "./outcome-badge";
import { FINAL_TOOLS, countOf, metaOf, plural } from "./tool-meta";

/** Chips shown per tool row before collapsing the rest into "+N". */
const MAX_ID_CHIPS = 4;

const NO_IDS: string[] = [];

interface TimelineNodeProps {
  node: TraceNode;
  /** 1-based position in the timeline, shown in the node. */
  step: number;
  last: boolean;
}

/** One agent step: muted thought, then the tool it called with the record ids it returned. */
export function TimelineNode({ node, step, last }: TimelineNodeProps) {
  const { tool, thought } = node;
  const ids =
    tool && !FINAL_TOOLS.has(tool.name) ? (tool.ids ?? NO_IDS) : NO_IDS;
  const { attrs, highlighted } = useEvidenceTarget(ids, { reference: true });
  const meta = tool ? metaOf(tool.name) : null;
  const done = tool?.state === "output-available";
  const failed = tool?.state === "output-error";
  const running = !!tool && !done && !failed;
  const count = done && meta?.noun ? countOf(tool.output, meta.keys) : null;

  return (
    <li className="animate-in fade-in-0 slide-in-from-bottom-1 relative flex gap-3 duration-200 ease-[cubic-bezier(.25,.46,.45,.94)] motion-reduce:animate-none">
      {!last && (
        <span
          aria-hidden
          className="absolute top-7 bottom-0 left-[11px] w-px bg-zinc-200"
        />
      )}
      <StepNode
        step={step}
        tone={
          failed ? "failed" : running ? "running" : tool ? "done" : "thinking"
        }
      />
      <div
        {...attrs}
        className={cn(
          "-mx-1 min-w-0 flex-1 px-1 pb-3",
          highlighted && HIGHLIGHT_CLASS,
        )}
      >
        {thought && (
          <p className="pt-0.5 text-[13px] leading-5 whitespace-pre-line text-zinc-600">
            {thought}
          </p>
        )}
        {tool && meta && (
          <div
            className={cn(
              "flex items-center gap-1.5 pt-1 text-[13px]",
              thought && "pt-1.5",
            )}
          >
            <span
              className={cn(
                "truncate font-medium",
                failed ? "text-[#b42318]" : "text-zinc-900",
              )}
            >
              {failed
                ? `${meta.done} failed`
                : done
                  ? meta.done
                  : `${meta.running}…`}
            </span>
            {count !== null && meta.noun && (
              <span className="shrink-0 text-[12px] text-zinc-500 tabular-nums">
                · {plural(count, meta.noun)}
              </span>
            )}
          </div>
        )}
        {failed && tool?.errorText && (
          <p className="text-[12px] leading-4 text-[#b42318]">
            {tool.errorText}
          </p>
        )}
        {done && ids.length > 0 && <IdChips ids={ids} />}
      </div>
    </li>
  );
}

type NodeTone = "running" | "done" | "failed" | "thinking";

const NODE_TONE: Record<NodeTone, string> = {
  running: "border-indigo-200 bg-white text-indigo-600",
  done: "border-zinc-200 bg-white text-zinc-500",
  failed: "border-[#b42318] bg-white text-[#b42318]",
  thinking: "border-zinc-200 bg-zinc-50 text-zinc-400",
};

/** Numbered timeline node; spinner while the tool runs. */
function StepNode({ step, tone }: { step: number; tone: NodeTone }) {
  return (
    <span
      className={cn(
        "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium tabular-nums",
        NODE_TONE[tone],
      )}
    >
      {tone === "running" ? (
        <LoaderCircle
          strokeWidth={1.5}
          className="size-3.5 animate-spin motion-reduce:animate-none"
        />
      ) : (
        step
      )}
    </span>
  );
}

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

interface TraceCardProps {
  trace: TraceState;
  running: boolean;
  /** Prefix for the header, e.g. "Fix-it". */
  label?: string;
}

/** Status line ("Step n of 8" / "Done · n steps"), live/replay badge and progress bar of a run. */
export function TraceHeader({ trace, running, label }: TraceCardProps) {
  const error = trace.error;
  const status = running
    ? `${label ? `${label} · step` : "Step"} ${Math.max(trace.steps, 1)} of ${trace.maxSteps}`
    : `${label ? `${label} · ` : ""}${error ? "Stopped" : "Done"} · ${trace.steps} ${trace.steps === 1 ? "step" : "steps"}`;
  return (
    <>
      <header className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 text-[12px] leading-4">
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            running ? "bg-indigo-500" : error ? "bg-[#b42318]" : "bg-[#2f7d55]",
          )}
        />
        <span className="font-medium text-zinc-900 tabular-nums">{status}</span>
        {trace.started && (
          <span className="ml-auto text-zinc-500">
            {trace.replay ? "replay" : "live"}
          </span>
        )}
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
    </>
  );
}

/** Live agent timeline: status header, step progress bar, one node per step. */
export function TraceCard({ trace, running, label }: TraceCardProps) {
  const nodes = groupSteps(trace.items);
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <TraceHeader trace={trace} running={running} label={label} />
      <ol className="px-3 pt-3 pb-1">
        {nodes.map((node, i) => (
          <TimelineNode
            key={node.key}
            node={node}
            step={i + 1}
            last={i === nodes.length - 1}
          />
        ))}
        {running && nodes.length === 0 && (
          <li className="pb-2 text-[12px] text-zinc-500">Starting agent…</li>
        )}
      </ol>
    </section>
  );
}
