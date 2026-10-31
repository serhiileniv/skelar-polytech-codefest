"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import {
  CircleCheck,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { api, errorMessage, type CaseStatus, type Verdict } from "@/api";

import { cn } from "@/lib/utils";

import { INITIAL_TRACE, groupSteps, traceReducer } from "./investigate-trace";
import { TimelineNode } from "./trace";
import { VerdictCard, instructionText } from "./verdict-card";

interface InvestigatePanelProps {
  caseId: string;
  caseStatus: CaseStatus;
  storedVerdict: Verdict | null;
  /** Current reply draft for this case; a fresh verdict only prefills an empty one. */
  draft: string;
  onInsert: (text: string) => void;
  onChanged: () => void;
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

export function InvestigatePanel({
  caseId,
  caseStatus,
  storedVerdict,
  draft,
  onInsert,
  onChanged,
}: InvestigatePanelProps) {
  const [trace, dispatch] = useReducer(traceReducer, INITIAL_TRACE);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const prefilledRef = useRef<Verdict | null>(null);
  const verdictRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Once per run: a fresh streamed verdict prefills the reply if the agent has not typed anything.
  useEffect(() => {
    const v = trace.verdict;
    if (!v || prefilledRef.current === v) return;
    prefilledRef.current = v;
    // Bring the verdict and its next step into view; long traces push it below the fold.
    verdictRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (draftRef.current.trim() === "") {
      onInsert(
        v.outcome === "user_can_fix" ? instructionText(v) : v.replyDraft,
      );
    }
  }, [trace.verdict, onInsert]);

  async function investigate() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ event: "reset" });
    setRunning(true);
    try {
      await api.investigate(caseId, dispatch, controller.signal);
    } catch (e) {
      if (isAbort(e) || controller.signal.aborted) return;
      dispatch({
        event: "error",
        data: { code: "internal", message: errorMessage(e) },
      });
    }
    if (controller.signal.aborted) return;
    setRunning(false);
    onChanged();
  }

  const started = trace.started || running;
  const verdict = trace.verdict ?? (started ? null : storedVerdict);
  const error = trace.error;
  const nodes = groupSteps(trace.items);

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900">
          <Sparkles className="size-3.5 text-indigo-600" />
          Verdict Copilot
        </h3>
        {verdict && !running && (
          <button
            type="button"
            onClick={() => void investigate()}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          >
            <RotateCcw className="size-3" />
            Re-run
          </button>
        )}
      </div>

      {!verdict && !started && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-center shadow-sm">
          <button
            type="button"
            onClick={() => void investigate()}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <Sparkles className="size-4" />
            Investigate
          </button>
          <p className="mt-2 text-xs text-zinc-500">
            Agent checks chat, billing, access and logs
          </p>
        </div>
      )}

      {started && (
        <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <header className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 text-xs">
            {running ? (
              <LoaderCircle className="size-3.5 animate-spin text-indigo-600" />
            ) : error ? (
              <TriangleAlert className="size-3.5 text-red-600" />
            ) : (
              <CircleCheck className="size-3.5 text-emerald-600" />
            )}
            <span className="font-medium text-zinc-800 tabular-nums">
              {running
                ? `Step ${Math.max(trace.steps, 1)} of ${trace.maxSteps}`
                : `${error ? "Stopped" : "Done"} · ${trace.steps} ${trace.steps === 1 ? "step" : "steps"}`}
            </span>
            {trace.started && (
              <span
                className={cn(
                  "ml-auto rounded-full px-1.5 py-px text-[10.5px] font-medium",
                  trace.replay
                    ? "bg-zinc-100 text-zinc-600"
                    : "bg-indigo-50 text-indigo-700",
                )}
              >
                {trace.replay ? "replay" : "live"}
              </span>
            )}
          </header>
          {running && (
            <div className="h-0.5 bg-zinc-100">
              <div
                className="h-full bg-indigo-500 transition-[width] duration-500"
                style={{
                  width: `${Math.min(100, (trace.steps / trace.maxSteps) * 100)}%`,
                }}
              />
            </div>
          )}
          <ol className="px-3 pt-3 pb-1">
            {nodes.map((node, i) => (
              <TimelineNode
                key={node.key}
                node={node}
                last={i === nodes.length - 1}
              />
            ))}
            {running && nodes.length === 0 && (
              <li className="pb-2 text-xs text-zinc-400">Starting agent…</li>
            )}
          </ol>
        </section>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          Investigation failed: {error}
          <button
            type="button"
            onClick={() => void investigate()}
            className="ml-2 font-medium underline"
          >
            Retry
          </button>
        </div>
      )}

      {started && !running && !error && !trace.verdict && (
        <p className="text-xs text-zinc-500">
          Agent finished without a verdict.
        </p>
      )}

      {verdict && (
        <div ref={verdictRef} className="scroll-mt-3">
          <VerdictCard
            caseId={caseId}
            caseStatus={caseStatus}
            verdict={verdict}
            onInsert={onInsert}
            onChanged={onChanged}
          />
        </div>
      )}
    </div>
  );
}
