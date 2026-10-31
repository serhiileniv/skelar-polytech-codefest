import type { CaseListItem } from "@/lib/api-contract";
import { cn } from "@/lib/utils";

import { STATUS_LABEL } from "./outcome";
import { OutcomeBadge } from "./outcome-badge";
import { formatTime } from "./time";

interface CaseListProps {
  cases: CaseListItem[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function CaseList({ cases, selectedId, onSelect }: CaseListProps) {
  return (
    <aside className="flex min-h-0 w-80 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50/60">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-200 px-4">
        <h2 className="text-[13px] font-semibold">Conversations</h2>
        <span className="text-xs text-zinc-400 tabular-nums">{cases?.length ?? "…"}</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {cases === null && <li className="p-4 text-xs text-zinc-400">Loading cases…</li>}
        {cases?.length === 0 && <li className="p-4 text-xs text-zinc-400">No cases.</li>}
        {cases?.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className={cn(
                "flex w-full flex-col gap-1 border-b border-zinc-200/70 px-4 py-3 text-left transition-colors",
                c.id === selectedId ? "bg-white shadow-[inset_2px_0_0_var(--color-indigo-600)]" : "hover:bg-white/70",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-semibold text-zinc-900">{c.customerName}</span>
                <span className="shrink-0 text-[11px] text-zinc-400">{formatTime(c.createdAt)}</span>
              </div>
              <span className="truncate text-[13px] text-zinc-800">{c.subject}</span>
              <span className="line-clamp-2 text-xs leading-snug text-zinc-500">{c.preview}</span>
              <div className="mt-0.5 flex items-center gap-1.5">
                <StatusDot status={c.status} />
                {c.outcome && <OutcomeBadge outcome={c.outcome} />}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

const STATUS_DOT: Record<CaseListItem["status"], string> = {
  open: "bg-indigo-500",
  waiting_customer: "bg-amber-500",
  with_tech: "bg-violet-500",
  resolved: "bg-zinc-300",
};

function StatusDot({ status }: { status: CaseListItem["status"] }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}
