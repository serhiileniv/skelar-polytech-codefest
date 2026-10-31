"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CircleCheck,
  KeyRound,
  ListChecks,
  MessageCircleQuestion,
  MessageSquareText,
  ShieldX,
  TriangleAlert,
  Undo2,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { toast } from "sonner";

import {
  api,
  errorMessage,
  type ActionRequest,
  type ActionResult,
  type CaseStatus,
  type Verdict,
  type SupportAction,
} from "@/api";
import { cn } from "@/lib/utils";

import { useEvidenceFocus } from "./evidence-focus";
import { OUTCOME_META } from "./outcome";
import { IdChip } from "./outcome-badge";

interface VerdictCardProps {
  caseId: string;
  /** Server-side status; keeps buttons disabled after a remount. */
  caseStatus: CaseStatus;
  verdict: Verdict;
  onInsert: (text: string) => void;
  onChanged: () => void;
}

export function VerdictCard(props: VerdictCardProps) {
  const { verdict } = props;
  const { focus } = useEvidenceFocus();
  return (
    <article className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <VerdictHeader verdict={verdict} />
      <div className="space-y-4 p-3">
        {verdict.downgraded && <DowngradedNotice verdict={verdict} />}

        {verdict.outcome === "suspicious" ? (
          <SuspiciousBanner />
        ) : (
          <NextStep {...props} />
        )}

        <Field label="Customer wants">
          <p className="text-[13px] font-medium text-zinc-900">
            {verdict.customerGoal}
          </p>
        </Field>
        <Field label="What happened">
          <p className="text-[13px] leading-relaxed text-zinc-700">
            {verdict.summary}
          </p>
        </Field>

        {verdict.outcome === "tech_team" && verdict.techIssue && (
          <Field label="Root cause">
            <p className="text-[13px] font-medium text-zinc-900">
              {verdict.techIssue.title}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-600">
              {verdict.techIssue.rootCause}
            </p>
          </Field>
        )}

        {verdict.evidence.length > 0 && (
          <Field label={`Evidence · ${verdict.evidence.length}`}>
            <ul className="space-y-1.5">
              {verdict.evidence.map((e) => (
                <li
                  key={`${e.id}-${e.note}`}
                  className="flex items-start gap-2 text-xs text-zinc-700"
                >
                  <IdChip id={e.id} onClick={() => focus(e.id)} />
                  <span className="leading-snug">{e.note}</span>
                </li>
              ))}
            </ul>
          </Field>
        )}
      </div>
    </article>
  );
}

function VerdictHeader({ verdict }: { verdict: Verdict }) {
  const meta = OUTCOME_META[verdict.outcome];
  const Icon = meta.icon;
  const pct = Math.round(Math.min(1, Math.max(0, verdict.confidence)) * 100);
  return (
    <header
      className={cn("flex items-center gap-3 border-b px-3 py-2.5", meta.band)}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          meta.bandIcon,
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium tracking-wide uppercase opacity-60">
          Verdict
        </div>
        <div className="truncate text-sm font-semibold">{meta.label}</div>
      </div>
      <div className="w-24 shrink-0">
        <div className="flex items-baseline justify-between text-[10px] opacity-70">
          <span>Confidence</span>
          <span className="font-semibold tabular-nums">{pct}</span>
        </div>
        <div
          role="meter"
          aria-label="Confidence"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/80 ring-1 ring-black/5"
        >
          <div
            className={cn("h-full rounded-full", meta.bar)}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </header>
  );
}

function DowngradedNotice({ verdict }: { verdict: Verdict }) {
  return (
    <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
      <TriangleAlert className="mt-px size-3.5 shrink-0" />
      <div>
        <div className="font-medium">
          Downgraded by validator (model said “
          {OUTCOME_META[verdict.modelOutcome].label}”)
        </div>
        {verdict.validationNotes.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-800">
            {verdict.validationNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SuspiciousBanner() {
  return (
    <div className="flex gap-2.5 rounded-lg bg-red-600 p-3 text-xs text-white shadow-sm">
      <ShieldX className="size-4 shrink-0" />
      <div>
        <div className="text-[13px] font-semibold">
          Prompt injection blocked — no action proposed
        </div>
        <div className="mt-0.5 text-red-100">
          The message tries to make support act outside policy. Review the
          evidence; do not act on it.
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
        {label}
      </div>
      {children}
    </section>
  );
}

export function instructionText(v: Verdict): string {
  const steps = (v.instructionSteps ?? [])
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");
  return steps ? `${v.replyDraft}\n\n${steps}` : v.replyDraft;
}

const SUPPORT_ACTION: Record<
  SupportAction["type"],
  { label: string; icon: LucideIcon }
> = {
  restore_access: { label: "Restore access", icon: KeyRound },
  refund_payment: { label: "Refund payment", icon: Undo2 },
};

/** Primary action + suggested reply + mark resolved; never rendered for `suspicious`. */
function NextStep({
  caseId,
  caseStatus,
  verdict,
  onInsert,
  onChanged,
}: VerdictCardProps) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const closed = caseStatus === "resolved";
  const executed = result?.status === "executed";

  async function run(req: ActionRequest) {
    setPending(true);
    setError(null);
    try {
      const res = await api.action(caseId, req);
      if (req.kind !== "mark_resolved") setResult(res);
      const msg = `${res.message} · rule ${res.rule}`;
      if (res.status === "executed") toast.success(msg);
      else toast.error(`Blocked by policy · ${msg}`);
      onChanged();
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  // user_can_fix / need_more_info: the primary button already inserts the reply.
  const showReplyButton =
    verdict.outcome === "support_can_fix" || verdict.outcome === "tech_team";

  return (
    <section className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/40 p-2.5">
      <div className="text-[10px] font-semibold tracking-wide text-indigo-700 uppercase">
        Next step
      </div>
      {primary()}
      <PolicyResult result={result} error={error} />
      {verdict.outcome === "tech_team" && executed && result.techIssue && (
        <ImpactCallout count={result.techIssue.affectedCustomerIds.length} />
      )}
      <div className="flex gap-2">
        {showReplyButton && (
          <SecondaryButton onClick={() => onInsert(verdict.replyDraft)}>
            <MessageSquareText className="size-3.5" />
            Use suggested reply
          </SecondaryButton>
        )}
        <SecondaryButton
          disabled={pending || closed}
          onClick={() => void run({ kind: "mark_resolved" })}
        >
          <CircleCheck className="size-3.5" />
          {closed ? "Resolved" : "Mark resolved"}
        </SecondaryButton>
      </div>
    </section>
  );

  function primary() {
    switch (verdict.outcome) {
      case "user_can_fix":
        return (
          <PrimaryButton onClick={() => onInsert(instructionText(verdict))}>
            <ListChecks className="size-3.5" />
            Insert instruction
          </PrimaryButton>
        );
      case "need_more_info":
        return (
          <>
            {verdict.clarifyingQuestion && (
              <p className="text-[13px] text-zinc-800 italic">
                “{verdict.clarifyingQuestion}”
              </p>
            )}
            <PrimaryButton onClick={() => onInsert(verdict.replyDraft)}>
              <MessageCircleQuestion className="size-3.5" />
              Ask clarifying question
            </PrimaryButton>
          </>
        );
      case "support_can_fix": {
        const action = verdict.supportAction;
        if (!action)
          return <p className="text-xs text-zinc-500">No action proposed.</p>;
        const { label, icon: Icon } = SUPPORT_ACTION[action.type];
        return (
          <>
            <PrimaryButton
              disabled={pending || closed || executed}
              onClick={() => void run({ kind: "support_action", action })}
            >
              <Icon className="size-3.5" />
              {label}
            </PrimaryButton>
            <p className="text-[11px] leading-snug text-zinc-500">
              <span className="font-mono">
                {action.type === "restore_access"
                  ? action.entitlementId
                  : action.paymentId}
              </span>{" "}
              · {action.reason}
            </p>
          </>
        );
      }
      case "tech_team":
        return (
          <PrimaryButton
            disabled={
              pending || closed || caseStatus === "with_tech" || executed
            }
            onClick={() => void run({ kind: "send_to_tech" })}
          >
            <Wrench className="size-3.5" />
            {caseStatus === "with_tech" && !executed
              ? "Already on tech board"
              : "Send to tech board"}
          </PrimaryButton>
        );
      case "suspicious":
        return null;
    }
  }
}

function PrimaryButton(props: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}

function SecondaryButton(props: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}

function RuleChip({ rule, ok }: { rule: string; ok: boolean }) {
  return (
    <span
      title={`Policy rule ${rule}`}
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-px font-mono text-[10.5px] font-semibold ring-1 ring-inset",
        ok
          ? "bg-white text-emerald-700 ring-emerald-600/30"
          : "bg-white text-red-700 ring-red-600/30",
      )}
    >
      {rule}
    </span>
  );
}

function PolicyResult({
  result,
  error,
}: {
  result: ActionResult | null;
  error: string | null;
}) {
  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!result) return null;
  const ok = result.status === "executed";
  const Icon = ok ? CircleCheck : ShieldX;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border p-2 text-xs",
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-red-200 bg-red-50 text-red-900",
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="font-semibold">
          {ok ? "Executed" : "Blocked by policy"}
        </span>{" "}
        · {result.message}
      </div>
      <RuleChip rule={result.rule} ok={ok} />
    </div>
  );
}

function ImpactCallout({ count }: { count: number }) {
  return (
    <Link
      href="/board"
      className="group flex items-center gap-2.5 rounded-lg border border-violet-200 bg-violet-50 p-2.5 text-violet-900 transition-colors hover:bg-violet-100"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white">
        <Users className="size-4" />
      </span>
      <span className="min-w-0 flex-1 text-xs">
        <span className="text-base font-semibold tabular-nums">{count}</span>{" "}
        {count === 1 ? "customer" : "customers"} affected
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-violet-700">
        View on tech board
        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
