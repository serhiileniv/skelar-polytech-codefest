"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { api, errorMessage, type TechIssue } from "@/api";
import { cn } from "@/lib/utils";

import { IdChip } from "../verdict/outcome-badge";
import { formatTime } from "../verdict/time";

const POLL_MS = 3000;
const SHOWN_CUSTOMERS = 5;
const DASH = "—";

const COLUMNS: { status: TechIssue["status"]; label: string; dot: string }[] = [
  { status: "new", label: "New", dot: "bg-indigo-500" },
  { status: "in_progress", label: "In progress", dot: "bg-amber-500" },
  { status: "resolved", label: "Resolved", dot: "bg-[#2f7d55]" },
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

  const totalAffected =
    issues === null
      ? DASH
      : String(
          issues.reduce((sum, i) => sum + i.affectedCustomerIds.length, 0),
        );

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-zinc-50 p-6">
      <header className="mb-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[15px] leading-5 font-semibold tracking-[-0.01em] text-zinc-900">
            Tech issues
          </h1>
          <span className="text-[13px] text-zinc-500">
            <span className="font-semibold text-zinc-900 tabular-nums">
              {totalAffected}
            </span>{" "}
            customers affected in total
          </span>
        </div>
        <p className="mt-0.5 text-[13px] text-zinc-500">
          Root causes found by Verdict investigations, merged by signature
        </p>
        {error && <p className="mt-1 text-[13px] text-[#b42318]">{error}</p>}
      </header>

      {issues !== null && issues.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-[13px] text-zinc-500">
          No tech issues yet — investigate case_104 and send it to tech
          <Link
            href="/?case=case_104"
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-zinc-500 transition-colors duration-100 hover:bg-zinc-100 hover:text-zinc-900 motion-reduce:transition-none"
          >
            Open case_104
            <ArrowRight aria-hidden strokeWidth={1.5} className="size-3.5" />
          </Link>
        </div>
      ) : (
        <div className="grid min-w-[900px] grid-cols-3 gap-4">
          {COLUMNS.map((col) => {
            const items = issues?.filter((i) => i.status === col.status) ?? [];
            return (
              <section key={col.status} className="flex flex-col gap-3">
                <h2 className="flex items-center gap-2 text-[13px] leading-[18px] font-semibold text-zinc-900">
                  <span className={cn("size-1.5 rounded-full", col.dot)} />
                  {col.label}
                  <span className="text-[12px] font-normal text-zinc-500 tabular-nums">
                    {issues === null ? DASH : items.length}
                  </span>
                </h2>
                {issues === null && (
                  <p className="text-[12px] text-zinc-400">Loading…</p>
                )}
                {issues !== null && items.length === 0 && (
                  <p className="text-[12px] text-zinc-400">None</p>
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
    <article className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white [&>*]:px-4 [&>*]:py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-[32px] leading-9 font-semibold tracking-[-0.02em] text-zinc-900 tabular-nums">
          {affected}
        </span>
        <span className="text-[12px] text-zinc-500">
          customer{affected === 1 ? "" : "s"} affected
        </span>
      </div>

      <div>
        <IdChip id={issue.signature} />
        <h3 className="mt-1.5 text-[13px] leading-5 font-semibold text-zinc-900">
          {issue.title}
        </h3>
        <p className="mt-1 text-[13px] leading-5 text-zinc-700">
          {issue.rootCause}
        </p>
      </div>

      <div className="space-y-3">
        <ChipRow label="Linked cases" ids={issue.caseIds} />
        <ChipRow
          label="Customers"
          ids={shown}
          extra={more > 0 ? `+${more} more` : undefined}
        />
        <ChipRow label="Evidence" ids={issue.evidenceIds} />
      </div>

      <div className="text-[12px] text-zinc-500 tabular-nums">
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
      <div className="mb-1.5 text-[12px] leading-4 font-medium text-zinc-500">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {ids.map((id) => (
          <IdChip key={id} id={id} />
        ))}
        {extra && <span className="text-[12px] text-zinc-500">{extra}</span>}
      </div>
    </div>
  );
}
