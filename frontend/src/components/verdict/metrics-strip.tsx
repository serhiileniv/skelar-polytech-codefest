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
      <div className="flex h-11 shrink-0 items-center border-b border-zinc-200 bg-zinc-50 px-4 text-xs text-zinc-400">
        {error ? `Metrics unavailable (${error})` : "Loading metrics…"}
      </div>
    );
  }

  const v = metricsView(metrics);
  return (
    <div className="flex h-11 shrink-0 items-center gap-5 overflow-x-auto border-b border-zinc-200 bg-zinc-50 px-4 text-xs">
      <Stat label="Investigated" value={v.investigated} />
      <div className="flex min-w-[180px] flex-col gap-1">
        <span className="text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
          Outcome mix
        </span>
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
          {v.mix.map((s) => (
            <span
              key={s.outcome}
              className={BAR_FILL[s.outcome]}
              style={{ width: `${s.pct}%` }}
              title={`${OUTCOME_META[s.outcome].label}: ${s.count}`}
            />
          ))}
        </div>
      </div>
      <Stat label="Kept from tech" value={v.keptFromTech} />
      <Stat label="Downgraded" value={String(v.downgraded)} />
      <Stat label="Avg steps" value={v.avgSteps} />
      <Stat label="Actions done / blocked" value={v.actions} />
      <Stat label="Eval accuracy" value={v.evalAccuracy} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex shrink-0 flex-col">
      <span className="text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
        {label}
      </span>
      <span className="font-semibold text-zinc-800 tabular-nums">{value}</span>
    </div>
  );
}
