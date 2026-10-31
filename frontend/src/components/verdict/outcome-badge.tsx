import { cn } from "@/lib/utils";
import type { Outcome } from "@/api";

import { OUTCOME_META } from "./outcome";

interface OutcomeBadgeProps {
  outcome: Outcome;
  size?: "sm" | "md";
  className?: string;
}

export function OutcomeBadge({
  outcome,
  size = "sm",
  className,
}: OutcomeBadgeProps) {
  const meta = OUTCOME_META[outcome];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md font-medium whitespace-nowrap ring-1 ring-inset",
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-xs",
        meta.badge,
        className,
      )}
    >
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
  "inline-flex shrink-0 items-center rounded border border-zinc-200 bg-zinc-50 px-1 py-px font-mono text-[10.5px] text-zinc-600";

export function IdChip({ id, onClick }: IdChipProps) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={`Show ${id}`}
        className={cn(
          CHIP_CLASS,
          "cursor-pointer transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none",
        )}
      >
        {id}
      </button>
    );
  }
  return <code className={CHIP_CLASS}>{id}</code>;
}
