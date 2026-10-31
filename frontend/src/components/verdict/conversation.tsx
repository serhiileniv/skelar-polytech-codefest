"use client";

import { useEffect, useState } from "react";

import type { Verdict } from "@/api";
import { cn } from "@/lib/utils";

import { shortGoal } from "./conversation-view";
import { useEvidenceFocus } from "./evidence-focus";
import { VerdictMark } from "./avatar";
import { IdChip } from "./outcome-badge";
import {
  DowngradedNotice,
  NextStep,
  SummaryText,
  SuspiciousNotice,
  TechNotice,
  VerdictHeader,
  type VerdictCardProps,
} from "./verdict-card";

/** How long the proposal keeps its entrance classes; later elements appear without animation. */
const PROPOSAL_ANIMATION_MS = 1600;

/** Left-aligned copilot message. */
export function AgentBubble({
  children,
  className,
  ...rest
}: React.ComponentProps<"div">) {
  return (
    <div className="copilot-bubble-in flex items-start justify-start gap-2">
      <span className="mt-1.5">
        <VerdictMark size={16} />
      </span>
      <div
        {...rest}
        className={cn(
          "max-w-[90%] min-w-0 rounded-lg bg-zinc-100/80 px-3 py-2 text-[13px] leading-5 text-zinc-800",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Right-aligned support message. */
export function SupportBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="copilot-bubble-in flex justify-end">
      <div className="max-w-[85%] rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap text-zinc-900">
        {children}
      </div>
    </div>
  );
}

export function TypingDots({
  label = "Resolly is typing",
}: {
  label?: string;
}) {
  return (
    <span role="status" aria-label={label} className="inline-flex gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className="copilot-dot size-1.5 rounded-full bg-zinc-400"
        />
      ))}
    </span>
  );
}

/** Final call: "Finding: Tech team · 91% confidence", one summary, evidence on demand, then the next step. */
export function VerdictBubble({
  verdict,
  affectedCount = null,
  injectionQuote = null,
  children,
}: {
  verdict: Verdict;
  /** Tech-team headline number. */
  affectedCount?: number | null;
  /** Suspicious: the injected text, already clamped. */
  injectionQuote?: string | null;
  /** The next step, rendered as the card's last section. */
  children?: React.ReactNode;
}) {
  const { focus } = useEvidenceFocus();
  const goal = shortGoal(verdict);
  const n = verdict.evidence.length;
  return (
    <article className="copilot-bubble-in overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <VerdictHeader verdict={verdict} prefix="Finding: " />
      <div className="divide-y divide-zinc-100 [&>*]:px-4 [&>*]:py-3">
        {verdict.downgraded && (
          <div>
            <DowngradedNotice verdict={verdict} />
          </div>
        )}
        <div className="space-y-1.5">
          <SummaryText text={verdict.summary} />
          {goal && (
            <p className="truncate text-[12px] leading-4 text-zinc-500">
              Wants: {goal}
            </p>
          )}
          {verdict.outcome === "tech_team" && verdict.techIssue && (
            <p
              title={verdict.techIssue.rootCause}
              className="truncate text-[12px] leading-4 text-zinc-500"
            >
              Root cause: {verdict.techIssue.title}
            </p>
          )}
          {n > 0 && (
            <details className="group pt-0.5">
              <summary className="w-fit cursor-pointer list-none text-[12px] leading-4 font-medium text-indigo-700 hover:text-indigo-800">
                Evidence ({n})
                <span className="ml-1 text-zinc-400 group-open:hidden">
                  · Show
                </span>
                <span className="ml-1 hidden text-zinc-400 group-open:inline">
                  · Hide
                </span>
              </summary>
              <ul className="mt-2 space-y-1">
                {verdict.evidence.map((e) => (
                  <li
                    key={`${e.id}-${e.note}`}
                    className="flex items-start gap-2 text-[12px] leading-5 text-zinc-600"
                  >
                    <IdChip id={e.id} onClick={() => focus(e.id)} />
                    <span className="min-w-0 flex-1">{e.note}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        {verdict.outcome === "suspicious" && (
          <div>
            <SuspiciousNotice quote={injectionQuote} />
          </div>
        )}
        {verdict.outcome === "tech_team" && verdict.techIssue && (
          <div>
            <TechNotice
              count={affectedCount}
              signature={verdict.techIssue.signature}
            />
          </div>
        )}
        {children}
      </div>
    </article>
  );
}

interface ProposalProps extends VerdictCardProps {
  /** Stagger the buttons in and pulse the primary action once (fresh verdict only). */
  animate: boolean;
}

/** What the agent proposes: the gated action buttons + suggested reply (Next step). */
export function Proposal({ animate, ...props }: ProposalProps) {
  const [entering, setEntering] = useState(animate);
  useEffect(() => {
    if (!animate) return;
    const t = setTimeout(() => setEntering(false), PROPOSAL_ANIMATION_MS);
    return () => clearTimeout(t);
  }, [animate]);

  return (
    <div className={cn(entering && "copilot-proposal-in")}>
      <NextStep {...props} />
    </div>
  );
}
