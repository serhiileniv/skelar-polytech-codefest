"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";

import type { CaseDetail } from "@/api";
import { cn } from "@/lib/utils";

import { useEvidenceFocus } from "./evidence-focus";
import { StatusDot } from "./outcome-badge";
import { formatTime } from "./time";
import { SuggestedReplyCard, type Proposal } from "./suggested-reply-card";
import { useTypewriter } from "./use-typewriter";

interface ChatThreadProps {
  detail: CaseDetail;
  draft: string;
  /** True while the draft is exactly the text the copilot inserted. */
  suggested: boolean;
  /** Last text inserted from a proposal; Insert asks first when the draft differs from it. */
  lastSuggestion: string | undefined;
  /** Pending suggested reply, shown above the composer until Insert or Dismiss. */
  proposal: Proposal | null;
  onProposalInsert: (text: string, how: "replace" | "append") => void;
  onProposalDismiss: () => void;
  onDraftChange: (value: string) => void;
  onSend: (body: string) => Promise<void>;
}

export function ChatThread({
  detail,
  draft,
  suggested,
  lastSuggestion,
  proposal,
  onProposalInsert,
  onProposalDismiss,
  onDraftChange,
  onSend,
}: ChatThreadProps) {
  const { case: c, customer } = detail;
  const scrollRef = useRef<HTMLDivElement>(null);
  const { focusedId } = useEvidenceFocus();
  const [sending, setSending] = useState(false);
  // An inserted suggestion types itself in; any click, key or focus shows it whole.
  const prefill = useTypewriter(draft, suggested, c.id);

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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-zinc-200 px-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-[15px] leading-5 font-semibold tracking-[-0.01em] text-zinc-900">
            {c.subject}
          </h1>
          <span className="truncate text-[12px] leading-4 text-zinc-500">
            {customer.name}
          </span>
          <code className="shrink-0 font-mono text-[11.5px] leading-4 text-zinc-500">
            {c.id}
          </code>
        </div>
        <span className="shrink-0">
          <StatusDot status={c.status} />
        </span>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-white px-6 py-5"
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
              <span className="px-1 text-[12px] leading-4 text-zinc-500 tabular-nums">
                <span className="font-medium text-zinc-700">
                  {mine ? "Support" : customer.name}
                </span>{" "}
                · {formatTime(m.at)}
              </span>
              <div
                data-evidence={m.id}
                className={cn(
                  "max-w-[64ch] rounded-lg border px-3.5 py-2.5 text-[14px] leading-[22px] whitespace-pre-wrap text-zinc-900 transition-shadow duration-200 motion-reduce:transition-none",
                  focusedId === m.id && "ring-2 ring-indigo-300 ring-offset-2",
                  mine
                    ? "border-indigo-100 bg-indigo-50"
                    : "border-zinc-200 bg-white",
                )}
              >
                {m.body}
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-zinc-200 bg-white p-4">
        {proposal && (
          <SuggestedReplyCard
            proposal={proposal}
            draft={draft}
            lastSuggestion={lastSuggestion}
            onInsert={onProposalInsert}
            onDismiss={onProposalDismiss}
          />
        )}
        <div
          className={cn(
            "rounded-lg border bg-white transition-colors duration-100 focus-within:ring-2 motion-reduce:transition-none",
            suggested
              ? "border-indigo-300 focus-within:ring-indigo-100"
              : "border-zinc-200 focus-within:border-indigo-400 focus-within:ring-indigo-100",
          )}
        >
          {suggested && (
            <div className="px-3 pt-2.5 text-[12px] leading-4 font-medium text-indigo-700">
              Suggested by Verdict
            </div>
          )}
          <textarea
            value={prefill.value}
            onChange={(e) => onDraftChange(e.target.value)}
            onFocus={prefill.skip}
            onPointerDown={prefill.skip}
            onKeyDown={(e) => {
              prefill.skip();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
            aria-label={`Reply to ${customer.name}`}
            placeholder={`Reply to ${customer.name}…`}
            rows={
              draft
                ? Math.min(10, Math.max(3, draft.split("\n").length + 1))
                : 3
            }
            className="block w-full resize-none bg-transparent px-3 py-2.5 text-[14px] leading-[22px] outline-none placeholder:text-zinc-400"
          />
          <div className="flex items-center justify-between border-t border-zinc-100 px-3 py-2">
            <span className="text-[12px] leading-4 text-zinc-400">
              ⌘↵ to send
            </span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !draft.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-[13px] font-medium text-white transition-[background-color,transform] duration-100 hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-1 focus-visible:outline-none active:scale-[.98] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 motion-reduce:transition-none"
            >
              <Send className="size-3.5" strokeWidth={1.5} />
              Send
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
