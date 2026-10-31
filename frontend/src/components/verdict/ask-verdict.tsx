"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";

import { api, ApiRequestError, errorMessage } from "@/api";
import { cn } from "@/lib/utils";

import { AgentBubble, SupportBubble, TypingDots } from "./conversation";
import { GhostButton } from "./controls";
import { QUICK_QUESTIONS } from "./conversation-view";
import { IdChips } from "./trace";

/** Same cap as the backend (`400` above it). */
const MAX_QUESTION_CHARS = 500;

type Turn =
  | { id: number; question: string; state: "loading" }
  | { id: number; question: string; state: "error"; error: string }
  | {
      id: number;
      question: string;
      state: "done";
      answer: string;
      evidence: string[];
    };

function askError(e: unknown): string {
  if (e instanceof ApiRequestError && e.status === 409)
    return "There is no verdict to explain yet. Investigate first.";
  return errorMessage(e);
}

interface AskVerdictProps {
  caseId: string;
  /** False until a stored verdict exists (and while a run is in progress). */
  enabled: boolean;
}

/** "Ask Verdict why…": support asks, Verdict answers from the verdict's records with id chips. */
export function AskVerdict({ caseId, enabled }: AskVerdictProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const seq = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = turns.some((t) => t.state === "loading");
  const canAsk = enabled && !busy;

  useEffect(() => {
    if (turns.length > 0)
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns]);

  const replace = (next: Turn) =>
    setTurns((ts) => ts.map((t) => (t.id === next.id ? next : t)));

  async function run(id: number, q: string) {
    try {
      const res = await api.ask(caseId, q);
      replace({ id, question: q, state: "done", ...res });
    } catch (e) {
      replace({ id, question: q, state: "error", error: askError(e) });
    }
  }

  function ask(raw: string) {
    const q = raw.trim();
    if (!canAsk || q === "") return;
    seq.current += 1;
    const id = seq.current;
    setTurns((ts) => [...ts, { id, question: q, state: "loading" }]);
    setQuestion("");
    void run(id, q);
  }

  function retry(turn: Turn) {
    if (!canAsk) return;
    replace({ id: turn.id, question: turn.question, state: "loading" });
    void run(turn.id, turn.question);
  }

  return (
    <div className="space-y-2 border-t border-zinc-200 p-4">
      <div className="text-[12px] leading-4 font-medium text-zinc-500">
        Ask Verdict
      </div>
      {turns.map((t) => (
        <div key={t.id} className="space-y-2">
          <SupportBubble>{t.question}</SupportBubble>
          {t.state === "loading" && (
            <AgentBubble>
              <TypingDots />
            </AgentBubble>
          )}
          {t.state === "done" && (
            <AgentBubble>
              <p className="whitespace-pre-line">{t.answer}</p>
              {t.evidence.length > 0 && <IdChips ids={t.evidence} />}
            </AgentBubble>
          )}
          {t.state === "error" && (
            <div className="flex items-center gap-2 text-[13px] leading-5 text-[#b42318]">
              <span className="min-w-0 flex-1">
                Couldn&apos;t answer: {t.error}
              </span>
              <GhostButton disabled={!canAsk} onClick={() => retry(t)}>
                Retry
              </GhostButton>
            </div>
          )}
        </div>
      ))}
      <div ref={endRef} />

      <div className="flex flex-wrap gap-1.5">
        {QUICK_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={!canAsk}
            onClick={() => ask(q)}
            className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-[12px] text-zinc-700 transition-colors duration-100 hover:bg-zinc-50 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-white motion-reduce:transition-none"
          >
            {q}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white pr-1 pl-2.5 transition-colors duration-100 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 motion-reduce:transition-none",
          !enabled && "bg-zinc-50",
        )}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={!enabled}
          maxLength={MAX_QUESTION_CHARS}
          aria-label="Ask Verdict"
          placeholder={
            enabled
              ? "Ask Verdict why…"
              : "Ask Verdict why… (after the verdict)"
          }
          className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          aria-label="Ask"
          disabled={!canAsk || question.trim() === ""}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-white transition-[background-color,transform] duration-100 hover:bg-indigo-700 active:scale-[.98] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 motion-reduce:transition-none"
        >
          <Send aria-hidden strokeWidth={1.5} className="size-3.5" />
        </button>
      </form>
    </div>
  );
}
