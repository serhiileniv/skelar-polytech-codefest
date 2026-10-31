"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";

import {
  api,
  errorMessage,
  type FixAutoStep,
  type FixCapability,
  type FixEvent,
  type FixPlan,
  type FixRunResult,
  type FixStep,
  type FixStepResult,
} from "@/api";
import { cn } from "@/lib/utils";

import { Field, GhostButton, PrimaryButton, RuleChip } from "./controls";
import {
  capabilityGroups,
  defaultSelection,
  ownerLabel,
  planRows,
  runSummary,
  toggleStep,
} from "./fix-view";
import { INITIAL_TRACE, traceReducer } from "./investigate-trace";
import { TraceCard } from "./trace";

interface FixPanelProps {
  caseId: string;
  /** Case already resolved: Fix-it cannot start. */
  closed: boolean;
  onChanged: () => void;
}

const isAbort = (e: unknown): boolean =>
  e instanceof DOMException && e.name === "AbortError";

/** Fix-it: live trace of the fix loop, then a plan support approves step by step. */
export function FixPanel({ caseId, closed, onChanged }: FixPanelProps) {
  const [trace, dispatch] = useReducer(traceReducer, INITIAL_TRACE);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [approving, setApproving] = useState(false);
  const [run, setRun] = useState<FixRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  function reset() {
    abortRef.current?.abort();
    dispatch({ event: "reset" });
    setRunning(false);
    setSelected([]);
    setRun(null);
    setError(null);
  }

  async function start() {
    reset();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    const onEvent = (e: FixEvent) => {
      dispatch(e);
      if (e.event === "plan") setSelected(defaultSelection(e.data.plan));
    };
    try {
      await api.fix(caseId, onEvent, controller.signal);
    } catch (e) {
      if (isAbort(e) || controller.signal.aborted) return;
      const msg = errorMessage(e);
      setError(msg);
      toast.error(`Fix-it refused · ${msg}`);
    }
    if (controller.signal.aborted) return;
    setRunning(false);
    onChanged();
  }

  async function approve(plan: FixPlan) {
    setApproving(true);
    try {
      const result = await api.approveFix(caseId, plan.id, selected);
      setRun(result);
      const { ok, message } = runSummary(result);
      if (ok) toast.success(message);
      else toast.error(message);
      onChanged();
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setApproving(false);
    }
  }

  const started = trace.started || running;
  // Resolved case: nothing to fix, so no disabled button either.
  if (!started && !error && closed) return null;
  if (!started && !error)
    return (
      <div className="space-y-1.5">
        <PrimaryButton disabled={closed} onClick={() => void start()}>
          Fix it for the customer
        </PrimaryButton>
        <FixCapabilities />
      </div>
    );

  const plan = trace.plan;
  return (
    <div className="space-y-2">
      {started && !(trace.error && trace.items.length === 0) && (
        <TraceCard trace={trace} running={running} label="Fix-it" />
      )}
      {(error ?? trace.error) && (
        <p className="text-[13px] leading-5 text-[#b42318]">
          {error ?? trace.error}
        </p>
      )}
      {plan && (
        <PlanCard
          plan={plan}
          selected={selected}
          run={run}
          approving={approving}
          onToggle={(id) => setSelected((s) => toggleStep(s, id))}
          onApprove={() => void approve(plan)}
          onDiscard={reset}
        />
      )}
      {!running && !plan && <GhostButton onClick={reset}>Close</GhostButton>}
    </div>
  );
}

/** Collapsible catalog from `GET /api/fix/capabilities`, loaded on first open. */
function FixCapabilities() {
  const [caps, setCaps] = useState<FixCapability[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load(open: boolean) {
    if (!open || caps) return;
    api
      .fixCapabilities()
      .then(setCaps)
      .catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <details
      className="group text-[12px] leading-4"
      onToggle={(e) => load(e.currentTarget.open)}
    >
      <summary className="w-fit cursor-pointer list-none font-medium text-indigo-700 hover:text-indigo-800">
        <span className="group-open:hidden">What Fix-it can do</span>
        <span className="hidden group-open:inline">Hide</span>
      </summary>
      <div className="mt-2 space-y-3 border-l-2 border-zinc-200 py-1 pl-3">
        {error && <p className="text-[#b42318]">{error}</p>}
        {!caps && !error && <p className="text-zinc-500">Loading…</p>}
        {caps &&
          capabilityGroups(caps).map((g) => (
            <section key={g.title}>
              <div className="mb-1.5 text-[12px] leading-4 font-medium text-zinc-500">
                {g.title}
              </div>
              <ul className="space-y-1">
                {g.items.map((c) => (
                  <li key={c.tool} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-zinc-800">
                        {c.label}
                      </span>
                      <span className="text-zinc-500"> · {c.description}</span>
                    </div>
                    {c.rule !== "-" && <RuleChip rule={c.rule} ok />}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        <p className="text-zinc-500">
          Then it replies to the customer as support and resolves the case when
          nothing is left for a person. Every write goes through the policy gate
          after your approval.
        </p>
      </div>
    </details>
  );
}

interface PlanCardProps {
  plan: FixPlan;
  selected: readonly string[];
  run: FixRunResult | null;
  approving: boolean;
  onToggle: (id: string) => void;
  onApprove: () => void;
  onDiscard: () => void;
}

function PlanCard({
  plan,
  selected,
  run,
  approving,
  onToggle,
  onApprove,
  onDiscard,
}: PlanCardProps) {
  const results = new Map(run?.steps.map((s) => [s.stepId, s]));
  const n = selected.length;
  return (
    <article className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <header className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2">
        <span className="text-[13px] leading-[18px] font-semibold text-zinc-900">
          Fix plan
        </span>
        {run && <RunBadge run={run} />}
      </header>
      <div className="space-y-3 px-3 py-3">
        <Field label="Problem">
          <p className="text-[13px] font-medium text-zinc-900">
            {plan.problem}
          </p>
        </Field>
        <Field label="Plan">
          <p className="text-[13px] leading-5 text-zinc-700">{plan.summary}</p>
        </Field>
      </div>
      <ol className="divide-y divide-zinc-100 border-t border-zinc-100">
        {planRows(plan).map((row, i) =>
          row.kind === "reply" ? (
            <ReplyRow key="reply" body={row.body} run={run} />
          ) : (
            <StepRow
              key={row.step.id}
              n={i + 1}
              step={row.step}
              checked={selected.includes(row.step.id)}
              locked={!!run || approving}
              result={results.get(row.step.id)}
              onToggle={() => onToggle(row.step.id)}
            />
          ),
        )}
      </ol>
      {!run && (
        <div className="flex items-center gap-2 border-t border-zinc-100 px-3 py-2.5">
          <PrimaryButton disabled={approving || n === 0} onClick={onApprove}>
            {approving ? "Running…" : `Approve & run selected (${n})`}
          </PrimaryButton>
          <GhostButton
            className="ml-auto"
            disabled={approving}
            onClick={onDiscard}
          >
            Discard
          </GhostButton>
        </div>
      )}
    </article>
  );
}

function RunBadge({ run }: { run: FixRunResult }) {
  const ok = run.status === "executed";
  const label = !ok ? "Stopped" : run.resolved ? "Resolved" : "Ran · case open";
  return (
    <span
      className={cn(
        "ml-auto inline-flex items-center gap-1.5 text-[12px] leading-4 font-medium",
        ok ? "text-[#2f7d55]" : "text-[#b42318]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          ok ? "bg-[#2f7d55]" : "bg-[#b42318]",
        )}
      />
      {label}
    </span>
  );
}

interface StepRowProps {
  n: number;
  step: FixStep;
  checked: boolean;
  locked: boolean;
  result: FixStepResult | undefined;
  onToggle: () => void;
}

function StepRow({ n, step, checked, locked, result, onToggle }: StepRowProps) {
  const auto = step.kind === "auto" ? step : null;
  const dimmed = !!auto && auto.wouldBe === "blocked" && !checked && !result;
  const inputId = `fix-step-${step.id}`;
  return (
    <li className={cn("flex gap-2.5 px-3 py-2.5", dimmed && "opacity-60")}>
      {auto ? (
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={locked}
          onChange={onToggle}
          className="mt-0.5 size-3.5 shrink-0 rounded-[4px] accent-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none"
        />
      ) : (
        <span className="w-3.5 shrink-0 text-center text-[12px] leading-4 text-zinc-400 tabular-nums">
          {n}
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <OwnerChip step={step} />
          {auto?.tool === "cancelSubscription" && (
            <span className="text-[12px] leading-4 text-amber-700">
              simulated connector
            </span>
          )}
        </div>
        <label
          htmlFor={auto ? inputId : undefined}
          className="block text-[13px] leading-5 font-medium text-zinc-900"
        >
          {step.title}
        </label>
        <p className="text-[12px] leading-4 text-zinc-600">{step.detail}</p>
        {auto && <GateLine step={auto} result={result} />}
      </div>
    </li>
  );
}

function OwnerChip({ step }: { step: FixStep }) {
  const agent = step.owner === "agent";
  return (
    <span
      className={cn(
        "rounded-[4px] px-1 text-[11.5px] leading-4 font-medium",
        agent
          ? "bg-zinc-100 text-zinc-700"
          : "bg-white text-zinc-600 ring-1 ring-zinc-200 ring-inset",
      )}
    >
      {ownerLabel(step)}
    </span>
  );
}

/** The drafted reply: sent after the selected steps unless the run stopped; no checkbox. */
function ReplyRow({ body, run }: { body: string; run: FixRunResult | null }) {
  return (
    <li className="flex gap-2.5 px-3 py-2.5">
      <span aria-hidden className="w-3.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <span className="rounded-[4px] bg-zinc-100 px-1 text-[11.5px] leading-4 font-medium text-zinc-700">
          I&apos;ll do this as support
        </span>
        <div className="text-[13px] leading-5 font-medium text-zinc-900">
          Reply to the customer
        </div>
        <p className="line-clamp-3 text-[12px] leading-4 text-zinc-600">
          {body}
        </p>
        {run && (
          <div
            className={cn(
              "pt-0.5 text-[12px] leading-4 font-medium",
              run.replied ? "text-[#2f7d55]" : "text-zinc-500",
            )}
          >
            {run.replied ? "Sent" : "Not sent · the run stopped"}
          </div>
        )}
      </div>
    </li>
  );
}

const RESULT_TEXT: Record<FixStepResult["status"], string> = {
  executed: "Executed",
  blocked: "Blocked by policy",
  skipped: "Skipped",
};

/** Before the run: gate dry run. After: what actually happened. */
function GateLine({
  step,
  result,
}: {
  step: FixAutoStep;
  result: FixStepResult | undefined;
}) {
  if (result) {
    const ok = result.status === "executed";
    return (
      <div
        className={cn(
          "flex items-start gap-1.5 pt-0.5 text-[12px] leading-4",
          result.status === "skipped"
            ? "text-zinc-500"
            : ok
              ? "text-[#2f7d55]"
              : "text-[#b42318]",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="font-medium">{RESULT_TEXT[result.status]}</span>
          {result.result && <> · {result.result.message}</>}
        </span>
        {result.result && result.result.rule !== "-" && (
          <RuleChip rule={result.result.rule} ok={ok} />
        )}
      </div>
    );
  }
  const ok = step.wouldBe === "executed";
  return (
    <div className="flex items-start gap-1.5 pt-0.5 text-[12px] leading-4 text-zinc-500">
      <span className="min-w-0 flex-1">
        {ok ? "Gate would allow" : "Gate would block"} · {step.previewMessage}
      </span>
      {step.rule !== "-" && <RuleChip rule={step.rule} ok={ok} />}
    </div>
  );
}
