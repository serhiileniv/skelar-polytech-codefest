"use client";

import { useEffect, useState } from "react";

import { api, errorMessage, type Metrics } from "@/api";
import { cn } from "@/lib/utils";

import { metricsView, type MetricsView } from "./metrics-view";
import { OUTCOME_META } from "./outcome";

const POLL_MS = 3000;

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

  // Loading / error keeps the same row with dashes, so the inbox below never shifts.
  const v: MetricsView = metrics ? metricsView(metrics) : EMPTY_VIEW;
  return (
    <div
      className="flex h-12 shrink-0 items-center divide-x divide-zinc-200 overflow-hidden border-b border-zinc-200 bg-white"
      title={error && !metrics ? `Metrics unavailable (${error})` : undefined}
    >
      <Stat label="Investigated" value={v.investigated} />
      <div className="flex min-w-0 shrink items-center gap-3 px-4">
        <span className="text-[12px] whitespace-nowrap text-zinc-500">
          Outcome mix
        </span>
        <div className="flex h-1.5 w-32 shrink-0 gap-px overflow-hidden rounded-full bg-zinc-100">
          {v.mix.map((s) => (
            <span
              key={s.outcome}
              className={OUTCOME_META[s.outcome].dot}
              style={{ width: `${s.pct}%` }}
              title={`${OUTCOME_META[s.outcome].label}: ${s.count}`}
            />
          ))}
        </div>
        <ul className="flex min-w-0 gap-3 overflow-hidden whitespace-nowrap">
          {metrics && v.mix.length === 0 && (
            <li className="text-[12px] text-zinc-400">No verdicts yet</li>
          )}
          {v.mix.map((s) => (
            <li
              key={s.outcome}
              title={`${OUTCOME_META[s.outcome].label}: ${s.count}`}
              className="inline-flex items-center gap-1.5 text-[12px] text-zinc-600"
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  OUTCOME_META[s.outcome].dot,
                )}
              />
              {OUTCOME_META[s.outcome].label}
            </li>
          ))}
        </ul>
      </div>
      <Stat label="Kept from tech" value={v.keptFromTech} />
      <Stat label="Downgraded" value={metrics ? String(v.downgraded) : DASH} />
      <Stat label="Avg steps" value={v.avgSteps} />
      <Stat label="Actions" value={v.actions} />
      <Stat
        label="Eval accuracy"
        value={v.evalAccuracy}
        title={metrics?.eval ? undefined : "Run eval"}
      />
    </div>
  );
}

const DASH = "—";

const EMPTY_VIEW: MetricsView = {
  investigated: DASH,
  mix: [],
  keptFromTech: DASH,
  downgraded: 0,
  avgSteps: DASH,
  actions: DASH,
  evalAccuracy: DASH,
};

function Stat({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex shrink-0 items-baseline gap-2 px-4" title={title}>
      <span className="text-[12px] whitespace-nowrap text-zinc-500">
        {label}
      </span>
      <span
        className={cn(
          "text-[15px] font-semibold whitespace-nowrap tabular-nums",
          value === DASH ? "text-zinc-400" : "text-zinc-900",
        )}
      >
        {value}
      </span>
    </div>
  );
}
