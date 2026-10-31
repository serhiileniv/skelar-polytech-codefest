"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

import {
  api,
  errorMessage,
  type CaseStatus,
  type ChatMessage,
  type TechIssue,
  type Verdict,
} from "@/api";
import { cn } from "@/lib/utils";

import { AskVerdict } from "./ask-verdict";
import { Proposal, VerdictBubble } from "./conversation";
import { affectedCount, firstName, injectionQuote } from "./conversation-view";
import { ActionHint, GhostButton, SecondaryButton } from "./controls";
import { INITIAL_TRACE, traceReducer } from "./investigate-trace";
import { serverMayStillRun } from "./run-recovery";
import { RunSteps } from "./trace";
import { instructionText } from "./verdict-card";

/** Give up waiting for a lost server run after this long. */
const SERVER_WAIT_MS = 120_000;

const ENTER =
  "animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-[cubic-bezier(.25,.46,.45,.94)] motion-reduce:animate-none";

interface InvestigatePanelProps {
  caseId: string;
  caseStatus: CaseStatus;
  storedVerdict: Verdict | null;
  customerName: string;
  /** Chat messages; the suspicious notice quotes the cited one. */
  messages: readonly ChatMessage[];
  /** Shows the "Suggested reply" card; the composer is only filled on the agent's click. */
  onPropose: (text: string) => void;
  onChanged: () => void;
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

function suggestedText(v: Verdict): string {
  return v.outcome === "user_can_fix" ? instructionText(v) : v.replyDraft;
}

export function InvestigatePanel({
  caseId,
  caseStatus,
  storedVerdict,
  customerName,
  messages,
  onPropose,
  onChanged,
}: InvestigatePanelProps) {
  const [trace, dispatch] = useReducer(traceReducer, INITIAL_TRACE);
  const [running, setRunning] = useState(false);
  const [confirmRerun, setConfirmRerun] = useState(false);
  /** Stream lost (409 / network drop): the stored verdict's createdAt we wait to change. */
  const [awaiting, setAwaiting] = useState<{ since: string | null } | null>(
    null,
  );
  const [waitError, setWaitError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const proposedRef = useRef<Verdict | null>(null);
  const verdictRef = useRef<HTMLDivElement>(null);
  const onProposeRef = useRef(onPropose);
  useEffect(() => {
    onProposeRef.current = onPropose;
  }, [onPropose]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const recovered =
    awaiting !== null &&
    storedVerdict !== null &&
    storedVerdict.createdAt !== awaiting.since
      ? storedVerdict
      : null;
  const waiting = awaiting !== null && !recovered && !waitError;

  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(
      () => setWaitError("The server run did not finish. Try again."),
      SERVER_WAIT_MS,
    );
    return () => clearTimeout(t);
  }, [waiting]);

  // Once per fresh verdict: bring it into view and propose the reply (never insert it).
  const fresh = trace.verdict ?? recovered;
  useEffect(() => {
    if (!fresh || proposedRef.current === fresh) return;
    proposedRef.current = fresh;
    verdictRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    onProposeRef.current(suggestedText(fresh));
  }, [fresh]);

  async function investigate() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ event: "reset" });
    setConfirmRerun(false);
    setAwaiting(null);
    setWaitError(null);
    setRunning(true);
    try {
      await api.investigate(caseId, dispatch, controller.signal);
    } catch (e) {
      if (isAbort(e) || controller.signal.aborted) return;
      if (serverMayStillRun(e)) {
        // The server finishes the run; the inbox's 3 s case poll brings the verdict in.
        dispatch({ event: "reset" });
        setAwaiting({ since: storedVerdict?.createdAt ?? null });
      } else {
        dispatch({
          event: "error",
          data: { code: "internal", message: errorMessage(e) },
        });
      }
    }
    if (controller.signal.aborted) return;
    setRunning(false);
    onChanged();
  }

  const started = trace.started || running;
  const error = trace.error ?? waitError;
  // A failed re-run keeps the stored verdict visible under the error.
  const verdict =
    trace.verdict ??
    recovered ??
    (waiting || (started && !trace.error) ? null : storedVerdict);
  const showSteps = started && !(trace.error && trace.items.length === 0);
  const idle = !verdict && !started && !waiting && !error;
  const board = useTechBoard(verdict?.outcome === "tech_team");
  const affected = verdict ? affectedCount(verdict, board) : null;

  const rerun =
    verdict && !running && !waiting && !confirmRerun ? (
      <GhostButton className="h-6" onClick={() => setConfirmRerun(true)}>
        <RotateCcw
          aria-hidden
          strokeWidth={1.5}
          className="size-3.5 text-zinc-500"
        />
        Re-run
      </GhostButton>
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {confirmRerun && (
          <div className="flex items-center gap-2 text-[13px] text-zinc-700">
            <span className="min-w-0 flex-1">
              Run again? Uses a new investigation
            </span>
            <SecondaryButton onClick={() => void investigate()}>
              Run again
            </SecondaryButton>
            <GhostButton onClick={() => setConfirmRerun(false)}>
              Cancel
            </GhostButton>
          </div>
        )}

        {idle && (
          <div className="space-y-2.5 rounded-lg border border-dashed border-indigo-200 bg-white/70 p-4">
            <h3 className="text-[15px] leading-5 font-semibold tracking-[-0.01em] text-zinc-900">
              Find out what happened
            </h3>
            <p className="text-[13px] leading-5 text-zinc-700">
              I&apos;ll read the chat, billing, access and logs for{" "}
              {firstName(customerName) || "this customer"}, then make a call you
              can act on.
            </p>
            <SecondaryButton onClick={() => void investigate()}>
              Investigate
            </SecondaryButton>
            <p className="text-[12px] leading-4 text-zinc-500">
              Deep check · up to 8 steps · ~30 s
            </p>
          </div>
        )}

        {showSteps ? (
          <RunSteps
            trace={trace}
            running={running}
            countSources
            trailing={rerun}
          />
        ) : (
          verdict &&
          !waiting && (
            <div className="flex items-center gap-2 px-1 text-[12px] leading-4">
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-[#2f7d55]"
              />
              <span className="font-medium text-zinc-900 tabular-nums">
                Done · {verdict.stepsUsed}{" "}
                {verdict.stepsUsed === 1 ? "step" : "steps"}
              </span>
              <span className="text-zinc-400">earlier run</span>
              <span className="ml-auto">{rerun}</span>
            </div>
          )
        )}

        {(running || waiting) && (
          <ActionHint>
            Read only. Nothing changes for the customer until you click.
          </ActionHint>
        )}

        {waiting && (
          <p role="status" className="text-[13px] leading-5 text-zinc-500">
            Still running on the server…
          </p>
        )}

        {error && (
          <div className="flex items-center gap-2 text-[13px] leading-5 text-[#b42318]">
            <span className="min-w-0 flex-1">
              Investigation failed: {error}
            </span>
            <GhostButton onClick={() => void investigate()}>Retry</GhostButton>
          </div>
        )}

        {started && !running && !error && !trace.verdict && !waiting && (
          <p className="text-[12px] leading-4 text-zinc-500">
            Agent finished without a verdict.
          </p>
        )}

        {verdict && (
          <div
            ref={verdictRef}
            className={cn("scroll-mt-3", verdict === fresh && ENTER)}
          >
            <VerdictBubble
              verdict={verdict}
              affectedCount={affected}
              injectionQuote={injectionQuote(verdict, messages)}
            >
              <Proposal
                affectedCount={affected}
                key={verdict.createdAt}
                animate={verdict === fresh}
                caseId={caseId}
                caseStatus={caseStatus}
                verdict={verdict}
                onPropose={onPropose}
                onChanged={onChanged}
              />
            </VerdictBubble>
          </div>
        )}
      </div>

      {(started || verdict) && (
        <AskVerdict caseId={caseId} enabled={!!verdict && !running} />
      )}
    </div>
  );
}

/** Tech board, fetched once per mount while a tech-team verdict is shown; null until loaded or on error. */
function useTechBoard(enabled: boolean): TechIssue[] | null {
  const [board, setBoard] = useState<TechIssue[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api
      .board()
      .then((b) => live && setBoard(b))
      // The count falls back to the verdict text; no toast for a side fetch.
      .catch(() => live && setBoard(null));
    return () => {
      live = false;
    };
  }, [enabled]);
  return enabled ? board : null;
}
