"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";

import { api, errorMessage, type TechIssue } from "@/api";
import { cn } from "@/lib/utils";

import { IdChip } from "../verdict/outcome-badge";
import { formatTime } from "../verdict/time";

const POLL_MS = 3000;
const SHOWN_CUSTOMERS = 5;

const COLUMNS: { status: TechIssue["status"]; label: string; dot: string }[] = [
  { status: "new", label: "New", dot: "bg-indigo-500" },
  { status: "in_progress", label: "In progress", dot: "bg-amber-500" },
  { status: "resolved", label: "Resolved", dot: "bg-emerald-500" },
];

export function TechBoard() {
  const [issues, setIssues] = useState<TechIssue[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api.board();
        if (alive) {
          setIssues(data);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
    };
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const totalAffected = (issues ?? []).reduce(
    (sum, i) => sum + i.affectedCustomerIds.length,
    0,
  );

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-zinc-100/70 p-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
            Tech issues
          </h1>
          <p className="text-[13px] text-zinc-500">
            Root causes found by Verdict investigations, merged by signature
          </p>
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-right">
          <div className="text-xl leading-none font-semibold text-indigo-700 tabular-nums">
            {totalAffected}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500">
            customers affected in total
          </div>
        </div>
      </header>

      {issues !== null && issues.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
          No tech issues yet — investigate case_104 and send it to tech
        </div>
      ) : (
        <div className="grid min-w-[900px] grid-cols-3 gap-4">
          {COLUMNS.map((col) => {
            const items = issues?.filter((i) => i.status === col.status) ?? [];
            return (
              <section key={col.status} className="flex flex-col gap-3">
                <h2 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-700">
                  <span className={cn("size-2 rounded-full", col.dot)} />
                  {col.label}
                  <span className="rounded-full bg-zinc-200/70 px-1.5 text-[11px] font-medium text-zinc-600 tabular-nums">
                    {items.length}
                  </span>
                </h2>
                {issues === null && (
                  <p className="text-xs text-zinc-400">Loading…</p>
                )}
                {issues !== null && items.length === 0 && (
                  <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-400">
                    Nothing here
                  </p>
                )}
                {items.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

function IssueCard({ issue }: { issue: TechIssue }) {
  const affected = issue.affectedCustomerIds.length;
  const shown = issue.affectedCustomerIds.slice(0, SHOWN_CUSTOMERS);
  const more = affected - shown.length;
  return (
    <article className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-end gap-2">
        <span className="text-5xl leading-none font-bold tracking-tight text-indigo-700 tabular-nums">
          {affected}
        </span>
        <span className="flex items-center gap-1 pb-1 text-xs font-medium text-zinc-500">
          <Users className="size-3.5" />
          customer{affected === 1 ? "" : "s"} affected
        </span>
      </div>

      <div>
        <span className="inline-flex rounded border border-indigo-200 bg-indigo-50 px-1.5 py-px font-mono text-[11px] text-indigo-700">
          {issue.signature}
        </span>
        <h3 className="mt-1.5 text-sm leading-snug font-semibold text-zinc-900">
          {issue.title}
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-600">
          {issue.rootCause}
        </p>
      </div>

      <ChipRow label="Linked cases" ids={issue.caseIds} />
      <ChipRow
        label="Customers"
        ids={shown}
        extra={more > 0 ? `+${more} more` : undefined}
      />
      <ChipRow label="Evidence" ids={issue.evidenceIds} />

      <div className="border-t border-zinc-100 pt-2 text-[11px] text-zinc-400">
        {issue.id} · created {formatTime(issue.createdAt)}
      </div>
    </article>
  );
}

interface ChipRowProps {
  label: string;
  ids: string[];
  extra?: string;
}

function ChipRow({ label, ids, extra }: ChipRowProps) {
  if (ids.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {ids.map((id) => (
          <IdChip key={id} id={id} />
        ))}
        {extra && <span className="text-[11px] text-zinc-500">{extra}</span>}
      </div>
    </div>
  );
}
