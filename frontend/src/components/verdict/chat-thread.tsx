"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";

import type { CaseDetail, CaseStatus } from "@/api";
import { cn } from "@/lib/utils";

import { useEvidenceFocus } from "./evidence-focus";
import { STATUS_LABEL } from "./outcome";
import { formatTime } from "./time";

interface ChatThreadProps {
  detail: CaseDetail;
  draft: string;
  /** True while the draft is exactly the text the copilot inserted. */
  suggested: boolean;
  onDraftChange: (value: string) => void;
  onSend: (body: string) => Promise<void>;
}

const STATUS_PILL: Record<CaseStatus, string> = {
  open: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  waiting_customer: "bg-amber-50 text-amber-800 ring-amber-600/25",
  with_tech: "bg-violet-50 text-violet-700 ring-violet-600/20",
  resolved: "bg-zinc-100 text-zinc-600 ring-zinc-400/30",
};

export function ChatThread({
  detail,
  draft,
  suggested,
  onDraftChange,
  onSend,
}: ChatThreadProps) {
  const { case: c, customer } = detail;
  const scrollRef = useRef<HTMLDivElement>(null);
  const { focusedId } = useEvidenceFocus();
  const [sending, setSending] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [c.id, c.messages.length]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 px-6 py-3.5">
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold text-zinc-900">
            {c.subject}
          </h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="truncate">{customer.name}</span>
            <span className="text-zinc-300">·</span>
            <code className="font-mono text-[11px] text-zinc-500">{c.id}</code>
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset",
            STATUS_PILL[c.status],
          )}
        >
          {STATUS_LABEL[c.status]}
        </span>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-zinc-50/50 px-6 py-6"
      >
        {c.messages.map((m) => {
          const mine = m.from === "support";
          return (
            <div
              key={m.id}
              className={cn(
                "flex flex-col gap-1.5",
                mine ? "items-end" : "items-start",
              )}
            >
              <span className="px-1 text-[11px] text-zinc-400">
                <span className="font-medium text-zinc-600">
                  {mine ? "Support" : customer.name}
                </span>{" "}
                · {formatTime(m.at)}
              </span>
              <div
                data-evidence={m.id}
                className={cn(
                  "max-w-[75%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap transition-shadow",
                  focusedId === m.id && "ring-2 ring-amber-400 ring-offset-2",
                  mine
                    ? "rounded-br-md bg-indigo-600 text-white"
                    : "rounded-bl-md border border-zinc-200 bg-zinc-100 text-zinc-900",
                )}
              >
                {m.body}
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-zinc-200 bg-white p-4">
        <div
          className={cn(
            "rounded-xl border bg-white shadow-sm transition-colors focus-within:ring-2",
            suggested
              ? "border-indigo-300 focus-within:ring-indigo-100"
              : "border-zinc-200 focus-within:border-indigo-400 focus-within:ring-indigo-100",
          )}
        >
          {suggested && (
            <div className="px-3 pt-2.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-600/20 ring-inset">
                <Sparkles className="size-3" />
                Suggested by Verdict
              </span>
            </div>
          )}
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
            aria-label={`Reply to ${customer.name}`}
            placeholder={`Reply to ${customer.name}…`}
            rows={
              draft
                ? Math.min(10, Math.max(3, draft.split("\n").length + 1))
                : 3
            }
            className="block w-full resize-none bg-transparent px-3 py-2.5 text-[13.5px] leading-relaxed outline-none placeholder:text-zinc-400"
          />
          <div className="flex items-center justify-between border-t border-zinc-100 px-3 py-2">
            <span className="text-[11px] text-zinc-400">⌘↵ to send</span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !draft.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"
            >
              <Send className="size-3.5" />
              Send
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
