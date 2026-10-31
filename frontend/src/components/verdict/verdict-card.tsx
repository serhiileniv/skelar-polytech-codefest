"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
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

import {
  confidencePct,
  nextStepActions,
  type PrimaryAction,
} from "./conversation-view";
import { useEvidenceFocus } from "./evidence-focus";
import { OUTCOME_META } from "./outcome";
import { IdChip } from "./outcome-badge";
import {
  GhostButton,
  PrimaryButton,
  RuleChip,
  SecondaryButton,
} from "./controls";
import { FixCapabilities, FixPanel } from "./fix-panel";
import {
  actionToastMessage,
  instructionText,
  splitRecordIds,
} from "./verdict-text";

export interface VerdictCardProps {
  caseId: string;
  /** Server-side status; keeps buttons disabled after a remount. */
  caseStatus: CaseStatus;
  verdict: Verdict;
  /** Shows the "Suggested reply" card above the composer; nothing is inserted without a click there. */
  onPropose: (text: string) => void;
  onChanged: () => void;
}

/** Outcome dot + label on the outcome tint, confidence on the right. */
export function VerdictHeader({
  verdict,
  prefix = "",
}: {
  verdict: Verdict;
  /** E.g. "My call: " in the conversation. */
  prefix?: string;
}) {
  const meta = OUTCOME_META[verdict.outcome];
  const pct = confidencePct(verdict);
  return (
    <header className={cn("flex items-center gap-2 px-4 py-3", meta.tint)}>
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", meta.dot)}
      />
      <span className="truncate text-[15px] leading-5 font-semibold tracking-[-0.01em] text-zinc-900">
        {prefix}
        {meta.label}
      </span>
      <span className="ml-auto shrink-0 text-[12px] leading-4 text-zinc-500 tabular-nums">
        {pct}% confident
      </span>
    </header>
  );
}

/** Summaries past this clamp to 2 lines; record ids inside become chips. */
const SUMMARY_CLAMP_CHARS = 140;

export function SummaryText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const { focus } = useEvidenceFocus();
  const long = text.length > SUMMARY_CLAMP_CHARS;
  return (
    <div>
      <p
        className={cn(
          "text-[13px] leading-5 text-zinc-700",
          long && !open && "line-clamp-2",
        )}
      >
        {splitRecordIds(text).map((part, i) =>
          "id" in part ? (
            <IdChip key={i} id={part.id} onClick={() => focus(part.id)} />
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </p>
      {long && (
        <GhostButton className="mt-0.5 -ml-2" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show more"}
        </GhostButton>
      )}
    </div>
  );
}

/** Left-rule callout shared by suspicious / downgraded / policy result. */
const CALLOUT = "border-l-2 py-1.5 pl-3 text-[13px] leading-5";

export function DowngradedNotice({ verdict }: { verdict: Verdict }) {
  return (
    <div className={cn(CALLOUT, "border-amber-500 text-zinc-700")}>
      <div className="font-medium text-zinc-900">
        Downgraded by validator (model said “
        {OUTCOME_META[verdict.modelOutcome].label}”)
      </div>
      {verdict.validationNotes.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] leading-4 text-zinc-600">
          {verdict.validationNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SuspiciousBanner() {
  return (
    <div className={cn(CALLOUT, "border-[#b42318] text-zinc-900")}>
      <div className="font-medium text-[#b42318]">
        Prompt injection blocked — no action proposed
      </div>
      <div className="mt-0.5 text-zinc-700">
        The message tries to make support act outside policy. Review the
        evidence; do not act on it.
      </div>
    </div>
  );
}

export { instructionText };

const SUPPORT_ACTION_LABEL: Record<SupportAction["type"], string> = {
  restore_access: "Restore access",
  refund_payment: "Refund payment",
  cancel_subscription: "Cancel subscription",
  send_magic_link: "Send login link",
};

function actionTarget(action: SupportAction): string {
  switch (action.type) {
    case "restore_access":
      return action.entitlementId;
    case "refund_payment":
      return action.paymentId;
    case "cancel_subscription":
      return action.subscriptionId;
    case "send_magic_link":
      return "magic_link";
  }
}

/** Done state per action, shown instead of the disabled button. */
const SUPPORT_ACTION_DONE: Record<SupportAction["type"], string> = {
  restore_access: "Restored",
  refund_payment: "Refunded",
  cancel_subscription: "Canceled",
  send_magic_link: "Login link sent",
};

/** ONE primary action per outcome, then the reply, Mark resolved and "Other actions". Fix-it replaces it all while active. */
export function NextStep({
  caseId,
  caseStatus,
  verdict,
  onPropose,
  onChanged,
}: VerdictCardProps) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);

  const closed = caseStatus === "resolved";
  const executed = result?.status === "executed";
  const actions = nextStepActions(verdict);
  const suspicious = verdict.outcome === "suspicious";

  async function run(req: ActionRequest) {
    setPending(true);
    setError(null);
    try {
      const res = await api.action(caseId, req);
      if (req.kind !== "mark_resolved") setResult(res);
      const msg = actionToastMessage(res.message, res.rule);
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

  const secondary = actions.reply && (
    <GhostButton
      className="text-indigo-700 hover:text-indigo-800"
      onClick={() => onPropose(verdict.replyDraft)}
    >
      Use suggested reply
    </GhostButton>
  );
  const hasOther = actions.other.length > 0 || actions.primary === "fix";
  const markResolved = !suspicious && (
    <GhostButton
      className="-mr-2 ml-auto"
      disabled={pending || closed}
      onClick={() => void run({ kind: "mark_resolved" })}
    >
      {closed ? "Resolved" : "Mark resolved"}
    </GhostButton>
  );

  // Direct children are staggered in by `.copilot-proposal-in` (label, actions, detail…).
  return (
    <section className="space-y-2.5">
      <div className="-my-1 flex h-7 items-center text-[12px] leading-4 font-medium text-zinc-500">
        {fixing ? "Fix-it" : "Next step"}
        {!fixing && markResolved}
      </div>
      {actions.primary === "fix" ? (
        <FixPanel
          caseId={caseId}
          closed={closed}
          onChanged={onChanged}
          onActiveChange={setFixing}
        >
          {secondary}
        </FixPanel>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {actions.primary && primary(actions.primary)}
          {secondary}
        </div>
      )}
      {!fixing && detail(actions.primary)}
      {!fixing && hasOther && (
        <div className="flex items-start gap-2">
          <details className="group min-w-0 flex-1 text-[12px] leading-4">
            <summary className="flex h-7 w-fit cursor-pointer list-none items-center font-medium text-zinc-500 hover:text-zinc-900">
              Other actions
              <span className="ml-1 text-zinc-400 group-open:hidden">
                · Show
              </span>
              <span className="ml-1 hidden text-zinc-400 group-open:inline">
                · Hide
              </span>
            </summary>
            <div className="mt-1.5 space-y-2.5 border-l-2 border-zinc-200 py-1 pl-3">
              {actions.other.map((a) => (
                <div key={a} className="space-y-1.5">
                  {primary(a)}
                  {detail(a)}
                </div>
              ))}
              {actions.primary === "fix" && <FixCapabilities />}
            </div>
          </details>
        </div>
      )}
      {!fixing && (
        <PolicyResult result={executed ? null : result} error={error} />
      )}
      {verdict.outcome === "tech_team" && executed && result.techIssue && (
        <ImpactCallout count={result.techIssue.affectedCustomerIds.length} />
      )}
    </section>
  );

  function primary(kind: PrimaryAction) {
    // A manual action behind "Other actions" is secondary; the visible one is primary.
    const Button = actions.primary === kind ? PrimaryButton : SecondaryButton;
    switch (kind) {
      case "insert_instruction":
        return (
          <Button onClick={() => onPropose(instructionText(verdict))}>
            Insert instruction
          </Button>
        );
      case "ask_clarifying":
        return (
          <PrimaryButton onClick={() => onPropose(verdict.replyDraft)}>
            Ask clarifying question
          </PrimaryButton>
        );
      case "support_action": {
        const action = verdict.supportAction;
        if (!action) return null;
        if (executed)
          return (
            <DoneLine text={SUPPORT_ACTION_DONE[action.type]} result={result} />
          );
        // Closed with the result lost on remount: the ghost "Resolved" already says it.
        if (closed) return null;
        return (
          <Button
            disabled={pending}
            onClick={() => void run({ kind: "support_action", action })}
          >
            {SUPPORT_ACTION_LABEL[action.type]}
          </Button>
        );
      }
      case "send_to_tech":
        if (executed)
          return <DoneLine text="Sent to tech board" result={result} />;
        if (caseStatus === "with_tech")
          return <DoneLine text="Already on tech board" result={null} />;
        if (closed) return null;
        return (
          <PrimaryButton
            disabled={pending}
            onClick={() => void run({ kind: "send_to_tech" })}
          >
            Send to tech board
          </PrimaryButton>
        );
      case "fix":
        return null;
    }
  }

  function detail(kind: PrimaryAction | null) {
    switch (kind) {
      case "ask_clarifying":
        return verdict.clarifyingQuestion ? (
          <p className="text-[13px] leading-5 text-zinc-700">
            “{verdict.clarifyingQuestion}”
          </p>
        ) : null;
      case "support_action": {
        const action = verdict.supportAction;
        if (!action) return null;
        return (
          <p className="text-[12px] leading-5 text-zinc-500">
            <IdChip id={actionTarget(action)} /> · {action.reason}
          </p>
        );
      }
      default:
        return null;
    }
  }
}

/** Executed (or already-done) action: green status line + the rule that allowed it. */
function DoneLine({
  text,
  result,
}: {
  text: string;
  result: ActionResult | null;
}) {
  return (
    <span
      role="status"
      title={result?.message}
      className="inline-flex h-8 items-center gap-1.5 text-[13px] font-medium text-[#2f7d55]"
    >
      {text}
      {result && result.rule !== "-" && (
        <>
          <span className="text-zinc-300">·</span>
          <RuleChip rule={result.rule} ok />
        </>
      )}
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
  if (error)
    return <p className="text-[13px] leading-5 text-[#b42318]">{error}</p>;
  if (!result) return null;
  const ok = result.status === "executed";
  return (
    <div
      className={cn(
        CALLOUT,
        "flex items-start gap-2 text-zinc-700",
        ok ? "border-[#2f7d55]" : "border-[#b42318]",
      )}
    >
      <div className="min-w-0 flex-1">
        <span
          className={cn(
            "font-medium",
            ok ? "text-[#2f7d55]" : "text-[#b42318]",
          )}
        >
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
      className={cn(
        CALLOUT,
        "group flex items-center gap-3 border-[#b4532a] text-zinc-700 transition-colors duration-100 hover:text-zinc-900 motion-reduce:transition-none",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="text-[15px] font-semibold text-zinc-900 tabular-nums">
          {count}
        </span>{" "}
        {count === 1 ? "customer" : "customers"} affected
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-indigo-700">
        View on tech board
        <ArrowRight
          aria-hidden
          strokeWidth={1.5}
          className="size-3.5 transition-transform duration-100 group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </span>
    </Link>
  );
}
