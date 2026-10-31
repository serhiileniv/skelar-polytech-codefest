import {
  CircleHelp,
  LifeBuoy,
  ShieldAlert,
  UserRoundCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { CaseStatus, Outcome } from "@/api";

interface OutcomeMeta {
  label: string;
  icon: LucideIcon;
  /** Tailwind classes for a soft badge. */
  badge: string;
  /** Tailwind classes for the verdict card accent border/bg. */
  panel: string;
  /** Verdict card header band: background + text. */
  band: string;
  /** Icon tile inside the header band. */
  bandIcon: string;
  /** Solid fill for the confidence bar. */
  bar: string;
}

export const OUTCOME_META: Record<Outcome, OutcomeMeta> = {
  user_can_fix: {
    label: "Customer can fix it",
    icon: UserRoundCheck,
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    panel: "border-emerald-200 bg-emerald-50/40",
    band: "bg-emerald-50 text-emerald-900 border-emerald-100",
    bandIcon: "bg-emerald-600 text-white",
    bar: "bg-emerald-500",
  },
  support_can_fix: {
    label: "Support can fix it",
    icon: LifeBuoy,
    badge: "bg-sky-50 text-sky-700 ring-sky-600/20",
    panel: "border-sky-200 bg-sky-50/40",
    band: "bg-sky-50 text-sky-900 border-sky-100",
    bandIcon: "bg-sky-600 text-white",
    bar: "bg-sky-500",
  },
  tech_team: {
    label: "Tech team",
    icon: Wrench,
    badge: "bg-violet-50 text-violet-700 ring-violet-600/20",
    panel: "border-violet-200 bg-violet-50/40",
    band: "bg-violet-50 text-violet-900 border-violet-100",
    bandIcon: "bg-violet-600 text-white",
    bar: "bg-violet-500",
  },
  need_more_info: {
    label: "Need more info",
    icon: CircleHelp,
    badge: "bg-amber-50 text-amber-800 ring-amber-600/25",
    panel: "border-amber-200 bg-amber-50/40",
    band: "bg-amber-50 text-amber-900 border-amber-100",
    bandIcon: "bg-amber-500 text-white",
    bar: "bg-amber-500",
  },
  suspicious: {
    label: "Suspicious — blocked",
    icon: ShieldAlert,
    badge: "bg-red-50 text-red-700 ring-red-600/20",
    panel: "border-red-200 bg-red-50/50",
    band: "bg-red-50 text-red-900 border-red-100",
    bandIcon: "bg-red-600 text-white",
    bar: "bg-red-500",
  },
};

export const STATUS_LABEL: Record<CaseStatus, string> = {
  open: "Open",
  waiting_customer: "Waiting on customer",
  with_tech: "With tech",
  resolved: "Resolved",
};
