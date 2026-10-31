"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";

import { api, errorMessage, type TechIssue } from "@/api";
import { cn } from "@/lib/utils";

import { IdChip } from "../verdict/outcome-badge";
import { formatTime } from "../verdict/time";

const POLL_MS = 3000;

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

  return (
    <main className="min-h-0 flex-1 overflow-auto p-5">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-base font-semibold tracking-tight">Tech issues</h1>
        <span className="text-xs text-zinc-500">
          Merged by root cause · created from Verdict investigations
        </span>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      <div className="grid min-w-[900px] grid-cols-3 gap-4">
        {COLUMNS.map((col) => {
          const items = issues?.filter((i) => i.status === col.status) ?? [];
          return (
            <section key={col.status} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-700">
                <span className={cn("size-2 rounded-full", col.dot)} />
                {col.label}
                <span className="text-xs font-normal text-zinc-400 tabular-nums">
                  {items.length}
                </span>
              </h2>
              {issues === null && (
                <p className="text-xs text-zinc-400">Loading…</p>
              )}
              {issues !== null && items.length === 0 && (
                <p className="rounded-lg border border-dashed border-zinc-200 p-4 text-center text-xs text-zinc-400">
                  No issues
                </p>
              )}
              {items.map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </section>
          );
        })}
      </div>
    </main>
  );
}

interface IssueCardProps {
  issue: TechIssue;
}

function IssueCard({ issue }: IssueCardProps) {
  const affected = issue.affectedCustomerIds.length;
  return (
    <article className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-zinc-400">
            {issue.id} · {formatTime(issue.createdAt)}
          </div>
          <h3 className="mt-0.5 text-sm leading-snug font-semibold text-zinc-900">
            {issue.title}
          </h3>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-md bg-violet-50 px-3 py-2 text-violet-900">
        <Users className="size-5 shrink-0 text-violet-500" />
        <div className="leading-none">
          <span className="text-2xl font-bold tabular-nums">{affected}</span>
          <span className="ml-1.5 text-xs font-medium">
            customer{affected === 1 ? "" : "s"} affected
          </span>
        </div>
      </div>

      <div>
        <div className="mb-0.5 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
          Root cause
        </div>
        <p className="text-[13px] leading-relaxed text-zinc-700">
          {issue.rootCause}
        </p>
      </div>

      <ChipRow label="Linked cases" ids={issue.caseIds} />
      <ChipRow label="Evidence" ids={issue.evidenceIds} />
    </article>
  );
}

function ChipRow({ label, ids }: { label: string; ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
        {label} · {ids.length}
      </div>
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => (
          <IdChip key={id} id={id} />
        ))}
      </div>
    </div>
  );
}
