"use client";

import { useEffect, useState } from "react";

import { api, errorMessage, type Metrics, type Outcome } from "@/api";

import { metricsView } from "./metrics-view";
import { OUTCOME_META } from "./outcome";

const POLL_MS = 3000;

/** Solid fills for the outcome-mix bar (badge colours in OUTCOME_META are too pale for a bar). */
const BAR_FILL: Record<Outcome, string> = {
  user_can_fix: "bg-emerald-500",
  support_can_fix: "bg-sky-500",
  tech_team: "bg-violet-500",
  need_more_info: "bg-amber-400",
  suspicious: "bg-red-500",
};

export function MetricsStrip() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const m = await api.metrics();
        if (!alive) return;
        setMetrics(m);
        setError(null);
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

  if (!metrics) {
    return (
      <div className="flex h-[94px] shrink-0 items-center px-5 pt-3 text-xs text-zinc-400">
        {error ? `Metrics unavailable (${error})` : "Loading metrics…"}
      </div>
    );
  }

  const v = metricsView(metrics);
  return (
    <div className="flex shrink-0 gap-3 overflow-x-auto px-3 pt-3">
      <Tile label="Investigated" value={v.investigated} />
      <div className="flex min-w-[320px] flex-[2] flex-col justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3">
        <span className="text-xs font-medium text-zinc-500">Outcome mix</span>
        <div className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-zinc-100">
          {v.mix.map((s) => (
            <span
              key={s.outcome}
              className={BAR_FILL[s.outcome]}
              style={{ width: `${s.pct}%` }}
              title={`${OUTCOME_META[s.outcome].label}: ${s.count}`}
            />
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {v.mix.length === 0 && (
            <li className="text-[11px] text-zinc-400">No verdicts yet</li>
          )}
          {v.mix.map((s) => (
            <li
              key={s.outcome}
              className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600"
            >
              <span className={`size-2 rounded-full ${BAR_FILL[s.outcome]}`} />
              {OUTCOME_META[s.outcome].label}
              <span className="font-semibold text-zinc-900 tabular-nums">
                {s.count}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Tile label="Kept from tech" value={v.keptFromTech} />
      <Tile label="Downgraded" value={String(v.downgraded)} />
      <Tile label="Avg steps" value={v.avgSteps} />
      <Tile label="Actions done / blocked" value={v.actions} />
      <Tile label="Eval accuracy" value={v.evalAccuracy} />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-[120px] flex-1 shrink-0 flex-col justify-between gap-1 rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <span className="text-xs font-medium whitespace-nowrap text-zinc-500">
        {label}
      </span>
      <span className="text-2xl font-semibold tracking-tight whitespace-nowrap text-zinc-900 tabular-nums">
        {value}
      </span>
    </div>
  );
}
