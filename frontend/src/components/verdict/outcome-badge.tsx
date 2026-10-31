import { cn } from "@/lib/utils";
import type { CaseStatus, Outcome } from "@/api";

import { OUTCOME_META, STATUS_DOT, STATUS_LABEL } from "./outcome";

interface OutcomeBadgeProps {
  outcome: Outcome;
  className?: string;
}

export function OutcomeBadge({ outcome, className }: OutcomeBadgeProps) {
  const meta = OUTCOME_META[outcome];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12px] leading-4 font-medium whitespace-nowrap",
        meta.text,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

interface IdChipProps {
  id: string;
  /** Makes the chip a button, e.g. to jump to the record. */
  onClick?: () => void;
}

const CHIP_CLASS =
  "inline-flex shrink-0 items-center rounded-[4px] bg-zinc-100 px-1 font-mono text-[11.5px] leading-4 text-zinc-600";

export function IdChip({ id, onClick }: IdChipProps) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={`Show ${id}`}
        className={cn(
          CHIP_CLASS,
          "cursor-pointer transition-colors duration-100 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none motion-reduce:transition-none",
        )}
      >
        {id}
      </button>
    );
  }
  return <code className={CHIP_CLASS}>{id}</code>;
}

/** Case status as a dot plus text. */
export function StatusDot({ status }: { status: CaseStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] leading-4 text-zinc-500">
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}
