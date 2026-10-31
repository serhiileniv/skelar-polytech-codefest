import type { CaseStatus, Outcome } from "@/api";

interface OutcomeMeta {
  label: string;
  /** Tailwind classes for a soft badge. */
  badge: string;
  /** Tailwind classes for the verdict card accent border/bg. */
  panel: string;
}

export const OUTCOME_META: Record<Outcome, OutcomeMeta> = {
  user_can_fix: {
    label: "Customer can fix it",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    panel: "border-emerald-200 bg-emerald-50/40",
  },
  support_can_fix: {
    label: "Support can fix it",
    badge: "bg-sky-50 text-sky-700 ring-sky-600/20",
    panel: "border-sky-200 bg-sky-50/40",
  },
  tech_team: {
    label: "Tech team",
    badge: "bg-violet-50 text-violet-700 ring-violet-600/20",
    panel: "border-violet-200 bg-violet-50/40",
  },
  need_more_info: {
    label: "Need more info",
    badge: "bg-amber-50 text-amber-800 ring-amber-600/25",
    panel: "border-amber-200 bg-amber-50/40",
  },
  suspicious: {
    label: "Suspicious — blocked",
    badge: "bg-red-50 text-red-700 ring-red-600/20",
    panel: "border-red-200 bg-red-50/50",
  },
};

export const STATUS_LABEL: Record<CaseStatus, string> = {
  open: "Open",
  waiting_customer: "Waiting on customer",
  with_tech: "With tech",
  resolved: "Resolved",
};
