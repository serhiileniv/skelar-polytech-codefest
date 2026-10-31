"use client";

import { useState } from "react";
import { CircleCheck, KeyRound, ShieldX, TriangleAlert, Undo2, Wrench, type LucideIcon } from "lucide-react";

import type { ActionRequest, ActionResult } from "@/lib/api-contract";
import { cn } from "@/lib/utils";
import type { StoredVerdict, SupportAction } from "@/lib/verdict/schema";

import { api } from "./api";
import { OUTCOME_META } from "./outcome";
import { IdChip, OutcomeBadge } from "./outcome-badge";

interface VerdictCardProps {
  caseId: string;
  verdict: StoredVerdict;
  onInsert: (text: string) => void;
  onChanged: () => void;
}

export function VerdictCard({ caseId, verdict, onInsert, onChanged }: VerdictCardProps) {
  const meta = OUTCOME_META[verdict.outcome];
  return (
    <div className={cn("space-y-3 rounded-lg border p-3", meta.panel)}>
      <div className="flex items-center justify-between gap-2">
        <OutcomeBadge outcome={verdict.outcome} size="md" />
        <span className="text-xs text-zinc-500 tabular-nums">
          <span className="font-semibold text-zinc-800">{Math.round(verdict.confidence * 100)}%</span> confidence
        </span>
      </div>

      {verdict.downgraded && (
        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <div>
            <div className="font-medium">
              Downgraded by validator (model said “{OUTCOME_META[verdict.modelOutcome].label}”)
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
      )}

      <div>
        <Label>Customer wants</Label>
        <p className="text-[13px] font-medium text-zinc-900">{verdict.customerGoal}</p>
      </div>
      <div>
        <Label>What happened</Label>
        <p className="text-[13px] leading-relaxed text-zinc-700">{verdict.summary}</p>
      </div>

      {verdict.evidence.length > 0 && (
        <div>
          <Label>Evidence</Label>
          <ul className="space-y-1">
            {verdict.evidence.map((e) => (
              <li key={`${e.id}-${e.note}`} className="flex items-start gap-1.5 text-xs text-zinc-700">
                <IdChip id={e.id} />
                <span className="leading-snug">{e.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {verdict.outcome === "need_more_info" && verdict.clarifyingQuestion && (
        <div>
          <Label>Ask the customer</Label>
          <p className="text-[13px] text-zinc-800 italic">“{verdict.clarifyingQuestion}”</p>
        </div>
      )}

      {verdict.outcome === "tech_team" && verdict.techIssue && (
        <div>
          <Label>Root cause</Label>
          <p className="text-[13px] font-medium text-zinc-900">{verdict.techIssue.title}</p>
          <p className="text-xs leading-relaxed text-zinc-600">{verdict.techIssue.rootCause}</p>
        </div>
      )}

      <VerdictActions caseId={caseId} verdict={verdict} onInsert={onInsert} onChanged={onChanged} />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-0.5 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">{children}</div>;
}

function instructionText(v: StoredVerdict): string {
  const steps = (v.instructionSteps ?? []).map((s, i) => `${i + 1}. ${s}`).join("\n");
  return steps ? `${v.replyDraft}\n\n${steps}` : v.replyDraft;
}

const SUPPORT_ACTION: Record<SupportAction["type"], { label: string; icon: LucideIcon }> = {
  restore_access: { label: "Restore access", icon: KeyRound },
  refund_payment: { label: "Refund payment", icon: Undo2 },
};

function VerdictActions({ caseId, verdict, onInsert, onChanged }: VerdictCardProps) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(req: ActionRequest, after?: () => void) {
    setPending(true);
    setError(null);
    try {
      const res = await api.action(caseId, req);
      setResult(res);
      if (res.status === "executed") after?.();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  switch (verdict.outcome) {
    case "user_can_fix":
      return <PrimaryButton onClick={() => onInsert(instructionText(verdict))}>Insert instruction</PrimaryButton>;
    case "need_more_info":
      return <PrimaryButton onClick={() => onInsert(verdict.replyDraft)}>Insert question</PrimaryButton>;
    case "suspicious":
      return (
        <div className="flex gap-2 rounded-md bg-red-600 p-2.5 text-xs text-white">
          <ShieldX className="size-4 shrink-0" />
          <div>
            <div className="font-semibold">Blocked — no action proposed</div>
            <div className="text-red-100">This message looks like an attempt to manipulate support. Do not act on it.</div>
          </div>
        </div>
      );
    case "support_can_fix": {
      const action = verdict.supportAction;
      if (!action) return <p className="text-xs text-zinc-500">No action proposed.</p>;
      const { label, icon: Icon } = SUPPORT_ACTION[action.type];
      return (
        <div className="space-y-2">
          <PrimaryButton disabled={pending || result?.status === "executed"} onClick={() => void run({ kind: "support_action", action })}>
            <Icon className="size-3.5" />
            {label}
          </PrimaryButton>
          <p className="text-[11px] text-zinc-500">
            {action.type === "restore_access" ? `Entitlement ${action.entitlementId}` : `Payment ${action.paymentId}`} ·{" "}
            {action.reason}
          </p>
          <ResultNotice result={result} error={error} />
          {result?.status === "executed" && (
            <button type="button" onClick={() => onInsert(verdict.replyDraft)} className="text-xs font-medium text-indigo-600 hover:underline">
              Insert reply to customer
            </button>
          )}
        </div>
      );
    }
    case "tech_team":
      return (
        <div className="space-y-2">
          <PrimaryButton
            disabled={pending || result?.status === "executed"}
            onClick={() => void run({ kind: "send_to_tech" }, () => onInsert(verdict.replyDraft))}
          >
            <Wrench className="size-3.5" />
            Send to tech board
          </PrimaryButton>
          <ResultNotice result={result} error={error} />
        </div>
      );
  }
}

function PrimaryButton(props: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 text-[13px] font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
    />
  );
}

function ResultNotice({ result, error }: { result: ActionResult | null; error: string | null }) {
  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!result) return null;
  const ok = result.status === "executed";
  return (
    <div
      className={cn(
        "flex gap-2 rounded-md border p-2 text-xs",
        ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900",
      )}
    >
      {ok ? <CircleCheck className="mt-px size-3.5 shrink-0" /> : <ShieldX className="mt-px size-3.5 shrink-0" />}
      <div>
        <div className="font-medium">
          {ok ? "Executed" : "Blocked by policy"} · {result.message}
        </div>
        <div className="mt-0.5 font-mono text-[10.5px] opacity-70">rule: {result.rule}</div>
      </div>
    </div>
  );
}
