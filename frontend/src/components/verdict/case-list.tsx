import type { CaseListItem } from "@/api";
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
    <aside className="flex min-h-0 w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 px-4">
        <h2 className="text-sm font-semibold">Inbox</h2>
        <span className="rounded-full bg-zinc-100 px-2 text-[11px] leading-5 font-medium text-zinc-600 tabular-nums">
          {cases?.length ?? "…"}
        </span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {cases === null && (
          <li className="p-3 text-xs text-zinc-400">Loading cases…</li>
        )}
        {cases?.length === 0 && (
          <li className="p-3 text-xs text-zinc-400">No cases.</li>
        )}
        {cases?.map((c) => (
          <li key={c.id}>
            <CaseRow
              item={c}
              selected={c.id === selectedId}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>
    </aside>
  );
}

interface CaseRowProps {
  item: CaseListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}

function CaseRow({ item: c, selected, onSelect }: CaseRowProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(c.id)}
      aria-current={selected || undefined}
      className={cn(
        "relative flex w-full gap-3 rounded-lg px-3 py-3 text-left transition-colors",
        selected ? "bg-indigo-50" : "hover:bg-zinc-50",
      )}
    >
      {selected && (
        <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-indigo-600" />
      )}
      <Avatar name={c.customerName} selected={selected} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-semibold text-zinc-900">
            {c.customerName}
          </span>
          <span className="shrink-0 text-[11px] text-zinc-400">
            {formatTime(c.createdAt)}
          </span>
        </div>
        <span className="truncate text-[13px] text-zinc-800">{c.subject}</span>
        <span className="line-clamp-2 text-xs leading-snug text-zinc-500">
          {c.preview}
        </span>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <StatusDot status={c.status} />
          {c.outcome && <OutcomeBadge outcome={c.outcome} />}
        </div>
      </div>
    </button>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts.at(-1)] : parts;
  return letters.map((p) => p?.[0]?.toUpperCase() ?? "").join("") || "?";
}

function Avatar({ name, selected }: { name: string; selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
        selected ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-600",
      )}
    >
      {initials(name)}
    </span>
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
    <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}
