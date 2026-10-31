"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";

import type { CaseDetail } from "@/api";
import { cn } from "@/lib/utils";

import { STATUS_LABEL } from "./outcome";
import { formatTime } from "./time";

interface ChatThreadProps {
  detail: CaseDetail;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (body: string) => Promise<void>;
}

export function ChatThread({
  detail,
  draft,
  onDraftChange,
  onSend,
}: ChatThreadProps) {
  const { case: c, customer } = detail;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [c.id, c.messages.length]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      await onSend(body);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-zinc-200 px-5">
        <h1 className="truncate text-[13px] font-semibold">{c.subject}</h1>
        <span className="shrink-0 text-xs text-zinc-400">
          {c.id} · {STATUS_LABEL[c.status]}
        </span>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5"
      >
        {c.messages.map((m) => {
          const mine = m.from === "support";
          return (
            <div
              key={m.id}
              className={cn(
                "flex flex-col gap-1",
                mine ? "items-end" : "items-start",
              )}
            >
              <span className="text-[11px] text-zinc-400">
                {mine ? "Support" : customer.name} · {formatTime(m.at)}
              </span>
              <div
                className={cn(
                  "max-w-[75%] rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap",
                  mine
                    ? "rounded-br-sm bg-indigo-600 text-white"
                    : "rounded-bl-sm bg-zinc-100 text-zinc-900",
                )}
              >
                {m.body}
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-zinc-200 p-3">
        <div className="rounded-lg border border-zinc-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
            placeholder={`Reply to ${customer.name}…`}
            rows={
              draft
                ? Math.min(10, Math.max(3, draft.split("\n").length + 1))
                : 3
            }
            className="block w-full resize-none bg-transparent px-3 py-2.5 text-[13.5px] leading-relaxed outline-none placeholder:text-zinc-400"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-[11px] text-zinc-400">⌘↵ to send</span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !draft.trim()}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              <Send className="size-3" />
              Send
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
