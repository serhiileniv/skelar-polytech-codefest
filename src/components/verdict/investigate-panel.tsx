"use client";

import { useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isTextUIPart, isToolUIPart, type UIMessage } from "ai";
import { LoaderCircle, RotateCcw, Sparkles } from "lucide-react";

import type { StoredVerdict, Verdict } from "@/lib/verdict/schema";

import { investigateUrl } from "./api";
import { ThoughtRow, ToolRow } from "./trace";
import { VerdictCard } from "./verdict-card";

interface InvestigatePanelProps {
  caseId: string;
  storedVerdict: StoredVerdict | null;
  onInsert: (text: string) => void;
  onChanged: () => void;
}

type TraceItem =
  | { kind: "text"; key: string; text: string }
  | { kind: "tool"; key: string; name: string; state: string; output?: unknown; errorText?: string };

interface Trace {
  items: TraceItem[];
  verdict: StoredVerdict | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function hasOutcome(v: unknown): v is Verdict {
  return isRecord(v) && typeof v.outcome === "string" && typeof v.summary === "string";
}

/** submitVerdict output should be the validated StoredVerdict; fall back to the model's input if not. */
function toStoredVerdict(output: unknown, input: unknown): StoredVerdict | null {
  const candidate = hasOutcome(output) ? output : isRecord(output) && hasOutcome(output.verdict) ? output.verdict : null;
  const base = candidate ?? (hasOutcome(input) ? input : null);
  if (!base) return null;
  const extra = base as Partial<StoredVerdict>;
  return {
    ...base,
    evidence: base.evidence ?? [],
    downgraded: extra.downgraded ?? false,
    validationNotes: extra.validationNotes ?? [],
    modelOutcome: extra.modelOutcome ?? base.outcome,
    stepsUsed: extra.stepsUsed ?? 0,
    createdAt: extra.createdAt ?? new Date().toISOString(),
  };
}

function buildTrace(messages: UIMessage[]): Trace {
  const items: TraceItem[] = [];
  let verdict: StoredVerdict | null = null;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    m.parts.forEach((part, i) => {
      const key = `${m.id}-${i}`;
      if (isTextUIPart(part)) {
        const text = part.text.trim();
        if (text) items.push({ kind: "text", key, text });
      } else if (isToolUIPart(part)) {
        const name = getToolName(part);
        items.push({
          kind: "tool",
          key: part.toolCallId ?? key,
          name,
          state: part.state,
          output: part.state === "output-available" ? part.output : undefined,
          errorText: part.state === "output-error" ? part.errorText : undefined,
        });
        if (name === "submitVerdict" && part.state === "output-available") {
          verdict = toStoredVerdict(part.output, part.input) ?? verdict;
        }
      }
    });
  }
  return { items, verdict };
}

export function InvestigatePanel({ caseId, storedVerdict, onInsert, onChanged }: InvestigatePanelProps) {
  const [replay, setReplay] = useState(false);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: investigateUrl(caseId),
        fetch: async (input, init) => {
          const res = await fetch(input, init);
          setReplay(res.headers.get("x-replay") === "1");
          return res;
        },
      }),
    [caseId],
  );
  const { messages, sendMessage, setMessages, status, error } = useChat({
    id: `investigate-${caseId}`,
    transport,
    onFinish: () => onChanged(),
  });

  const running = status === "submitted" || status === "streaming";
  const trace = useMemo(() => buildTrace(messages), [messages]);
  const started = messages.length > 0;
  const verdict = trace.verdict ?? (started ? null : storedVerdict);

  function investigate() {
    setMessages([]);
    void sendMessage({ text: "investigate" });
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Sparkles className="size-3.5 text-indigo-600" />
          Investigation
          {replay && <span className="rounded bg-zinc-100 px-1 text-[10px] font-medium text-zinc-500">replay</span>}
        </h3>
        {verdict && !running && (
          <button
            type="button"
            onClick={investigate}
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
          onClick={investigate}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          <Sparkles className="size-4" />
          Investigate
        </button>
      )}

      {started && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
            {running ? <LoaderCircle className="size-3 animate-spin text-indigo-500" /> : null}
            {running ? "Investigating" : "Trace"}
            <span className="tabular-nums">· {trace.items.filter((i) => i.kind === "tool").length} steps</span>
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
            {status === "submitted" && trace.items.length === 0 && (
              <li className="py-1 text-xs text-zinc-400">Starting agent…</li>
            )}
          </ul>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          Investigation failed: {error.message}
          <button type="button" onClick={investigate} className="ml-2 font-medium underline">
            Retry
          </button>
        </div>
      )}

      {started && !running && !error && !trace.verdict && (
        <p className="text-xs text-zinc-500">Agent finished without a verdict.</p>
      )}

      {verdict && <VerdictCard caseId={caseId} verdict={verdict} onInsert={onInsert} onChanged={onChanged} />}
    </div>
  );
}
