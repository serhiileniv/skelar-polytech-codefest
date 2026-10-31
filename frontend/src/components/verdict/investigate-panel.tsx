"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

import { api, errorMessage, type CaseStatus, type Verdict } from "@/api";
import { cn } from "@/lib/utils";

import { AskVerdict } from "./ask-verdict";
import { ConversationSteps, Proposal, VerdictBubble } from "./conversation";
import { GhostButton, SecondaryButton } from "./controls";
import { INITIAL_TRACE, traceReducer } from "./investigate-trace";
import { serverMayStillRun } from "./run-recovery";
import { instructionText } from "./verdict-card";

/** Give up waiting for a lost server run after this long. */
const SERVER_WAIT_MS = 120_000;

const ENTER =
  "animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-[cubic-bezier(.25,.46,.45,.94)] motion-reduce:animate-none";

interface InvestigatePanelProps {
  caseId: string;
  caseStatus: CaseStatus;
  storedVerdict: Verdict | null;
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

  return (
    <div className="flex flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 px-4">
        <h2 className="text-[13px] leading-[18px] font-semibold text-zinc-900">
          Copilot
        </h2>
        {verdict && !running && !waiting && !confirmRerun && (
          <GhostButton onClick={() => setConfirmRerun(true)}>
            <RotateCcw
              aria-hidden
              strokeWidth={1.5}
              className="size-3.5 text-zinc-500"
            />
            Re-run
          </GhostButton>
        )}
      </header>

      <div className="space-y-4 p-4">
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
          <div className="space-y-1.5">
            <SecondaryButton onClick={() => void investigate()}>
              Investigate
            </SecondaryButton>
            <p className="text-[12px] leading-4 text-zinc-500">
              Deep check · up to 8 steps · ~30 s
            </p>
          </div>
        )}

        {showSteps && <ConversationSteps trace={trace} running={running} />}

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
          <div className={cn("space-y-4", verdict === fresh && ENTER)}>
            <div ref={verdictRef} className="scroll-mt-3">
              <VerdictBubble verdict={verdict} />
            </div>
            <Proposal
              key={verdict.createdAt}
              animate={verdict === fresh}
              caseId={caseId}
              caseStatus={caseStatus}
              verdict={verdict}
              onPropose={onPropose}
              onChanged={onChanged}
            />
          </div>
        )}
      </div>

      {(started || verdict) && (
        <AskVerdict caseId={caseId} enabled={!!verdict && !running} />
      )}
    </div>
  );
}
