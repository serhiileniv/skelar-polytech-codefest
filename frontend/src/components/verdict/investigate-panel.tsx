"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { LoaderCircle, RotateCcw, Sparkles } from "lucide-react";

import { api, errorMessage, type CaseStatus, type Verdict } from "@/api";

import { INITIAL_TRACE, traceReducer } from "./investigate-trace";
import { ThoughtRow, ToolRow } from "./trace";
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
  const replay = trace.replay;
  const error = trace.error;
  const toolCount = trace.items.filter((i) => i.kind === "tool").length;

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Sparkles className="size-3.5 text-indigo-600" />
          Investigation
          {replay && (
            <span className="rounded bg-zinc-100 px-1 text-[10px] font-medium text-zinc-500">
              replay
            </span>
          )}
        </h3>
        {verdict && !running && (
          <button
            type="button"
            onClick={() => void investigate()}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800"
          >
            <RotateCcw className="size-3" />
            Re-run
          </button>
        )}
      </div>

      {!verdict && !started && (
        <button
          type="button"
          onClick={() => void investigate()}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          <Sparkles className="size-4" />
          Investigate
        </button>
      )}

      {started && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
            {running ? (
              <LoaderCircle className="size-3 animate-spin text-indigo-500" />
            ) : null}
            {running ? "Investigating" : "Trace"}
            <span className="tabular-nums">· {toolCount} steps</span>
          </div>
          <ul className="space-y-0.5">
            {trace.items.map((item) =>
              item.kind === "text" ? (
                <ThoughtRow key={item.key} text={item.text} />
              ) : (
                <ToolRow
                  key={item.key}
                  name={item.name}
                  state={item.state}
                  output={item.output}
                  errorText={item.errorText}
                />
              ),
            )}
            {running && trace.items.length === 0 && (
              <li className="py-1 text-xs text-zinc-400">Starting agent…</li>
            )}
          </ul>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
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
        <VerdictCard
          caseId={caseId}
          caseStatus={caseStatus}
          verdict={verdict}
          onInsert={onInsert}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
