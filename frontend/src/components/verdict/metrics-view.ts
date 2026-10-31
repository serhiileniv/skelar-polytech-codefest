import type { Metrics, Outcome } from "@/api";

export const OUTCOME_ORDER: readonly Outcome[] = [
  "user_can_fix",
  "support_can_fix",
  "tech_team",
  "need_more_info",
  "suspicious",
];

export interface MixSlice {
  outcome: Outcome;
  count: number;
  /** Share of investigated cases, 0–100. */
  pct: number;
}

export interface MetricsView {
  investigated: string;
  mix: MixSlice[];
  keptFromTech: string;
  downgraded: number;
  avgSteps: string;
  actions: string;
  evalAccuracy: string;
}

const pct = (part: number, total: number): number =>
  total > 0 ? Math.round((part / total) * 100) : 0;

/** Display strings for the metrics strip. Pure, so it is unit-tested. */
export function metricsView(m: Metrics): MetricsView {
  const mix = OUTCOME_ORDER.map((outcome) => ({
    outcome,
    count: m.byOutcome[outcome] ?? 0,
    pct: pct(m.byOutcome[outcome] ?? 0, m.investigated),
  })).filter((s) => s.count > 0);
  return {
    investigated: `${m.investigated}/${m.totalCases}`,
    mix,
    keptFromTech:
      m.investigated > 0
        ? `${m.keptFromTech} (${pct(m.keptFromTech, m.investigated)}%)`
        : "—",
    downgraded: m.downgraded,
    avgSteps: m.investigated > 0 ? m.avgSteps.toFixed(1) : "—",
    actions: `${m.actions.executed} / ${m.actions.blocked}`,
    evalAccuracy: m.eval
      ? `${m.eval.correct}/${m.eval.total} (${pct(m.eval.correct, m.eval.total)}%)`
      : "not run",
  };
}
