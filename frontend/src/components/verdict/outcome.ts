import type { CaseStatus, Outcome } from "@/api";

interface OutcomeMeta {
  label: string;
  /** Outcome colour for text (badge label, status line). */
  text: string;
  /** Same colour as a solid fill: the outcome dot and the mix bar. */
  dot: string;
  /** Pale background; only the verdict header uses it. */
  tint: string;
}

// Muted hues at similar lightness; need_more_info is neutral because "unknown" isn't a hue.
export const OUTCOME_META: Record<Outcome, OutcomeMeta> = {
  user_can_fix: {
    label: "Customer can fix it",
    text: "text-[#2f7d55]",
    dot: "bg-[#2f7d55]",
    tint: "bg-[#eef6f1]",
  },
  support_can_fix: {
    label: "Support can fix it",
    text: "text-[#1f7a80]",
    dot: "bg-[#1f7a80]",
    tint: "bg-[#ecf5f5]",
  },
  tech_team: {
    label: "Tech team",
    text: "text-[#b4532a]",
    dot: "bg-[#b4532a]",
    tint: "bg-[#fbf0ea]",
  },
  need_more_info: {
    label: "Need more info",
    text: "text-[#6b6f76]",
    dot: "bg-[#6b6f76]",
    tint: "bg-[#f1f1f3]",
  },
  suspicious: {
    label: "Suspicious — blocked",
    text: "text-[#b42318]",
    dot: "bg-[#b42318]",
    tint: "bg-[#fdf0ef]",
  },
};

export const STATUS_LABEL: Record<CaseStatus, string> = {
  open: "Open",
  waiting_customer: "Waiting on customer",
  with_tech: "With tech",
  resolved: "Resolved",
};

export const STATUS_DOT: Record<CaseStatus, string> = {
  open: "bg-indigo-500",
  waiting_customer: "bg-amber-500",
  with_tech: "bg-[#b4532a]",
  resolved: "bg-zinc-300",
};
