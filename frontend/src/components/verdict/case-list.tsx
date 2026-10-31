import type { CaseListItem } from "@/api";
import { cn } from "@/lib/utils";

import { OutcomeBadge, StatusDot } from "./outcome-badge";
import { formatTime } from "./time";

interface CaseListProps {
  cases: CaseListItem[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function CaseList({ cases, selectedId, onSelect }: CaseListProps) {
  return (
    <aside className="flex min-h-0 w-[300px] shrink-0 flex-col overflow-hidden border-r border-zinc-200 bg-white">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 px-4">
        <h2 className="text-[13px] leading-[18px] font-semibold text-zinc-900">
          Inbox
        </h2>
        <span className="text-[12px] text-zinc-500 tabular-nums">
          {cases?.length ?? "…"}
        </span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {cases === null && (
          <li className="p-3 text-[12px] text-zinc-500">Loading cases…</li>
        )}
        {cases?.length === 0 && (
          <li className="p-3 text-[12px] text-zinc-500">No cases.</li>
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
        "flex w-full gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-100 motion-reduce:transition-none",
        selected ? "bg-zinc-100" : "hover:bg-zinc-50",
      )}
    >
      <Avatar name={c.customerName} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-semibold text-zinc-900">
            {c.customerName}
          </span>
          <span className="shrink-0 text-[12px] leading-4 text-zinc-500 tabular-nums">
            {formatTime(c.createdAt)}
          </span>
        </div>
        <span className="truncate text-[13px] text-zinc-800">{c.subject}</span>
        <span className="truncate text-[12px] leading-4 text-zinc-500">
          {c.preview}
        </span>
        <div className="mt-1 flex flex-wrap items-center gap-3">
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

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-medium text-zinc-600 ring-1 ring-zinc-200"
    >
      {initials(name)}
    </span>
  );
}
