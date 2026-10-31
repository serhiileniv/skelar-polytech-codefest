"use client";

import { useEffect, useState } from "react";

import type { Verdict } from "@/api";
import { cn } from "@/lib/utils";

import {
  awaitingAgent,
  toBubbles,
  verdictReasons,
  type StepBubble,
} from "./conversation-view";
import {
  HIGHLIGHT_CLASS,
  useEvidenceFocus,
  useEvidenceTarget,
} from "./evidence-focus";
import { VerdictMark } from "./avatar";
import { IdChip } from "./outcome-badge";
import type { TraceState } from "./investigate-trace";
import { IdChips, TraceHeader } from "./trace";
import { SecondaryButton } from "./controls";
import {
  DowngradedNotice,
  NextStep,
  SummaryText,
  SuspiciousBanner,
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
  label = "Verdict is typing",
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

const NO_IDS: string[] = [];

/** One agent step: first-person sentence + "Checked billing → 2 payments" with evidence chips. */
function StepBubbleView({ bubble }: { bubble: StepBubble }) {
  const { text, tool } = bubble;
  const ids = tool?.ids ?? NO_IDS;
  const { attrs, highlighted } = useEvidenceTarget(ids, { reference: true });
  return (
    <AgentBubble {...attrs} className={cn(highlighted && HIGHLIGHT_CLASS)}>
      {text && <p className="whitespace-pre-line">{text}</p>}
      {tool && (
        <div
          className={cn("text-[12px] leading-4 text-zinc-500", text && "mt-1")}
        >
          {tool.state === "running" ? (
            <span className="inline-flex items-center gap-1.5 text-zinc-900">
              {tool.label}
              <TypingDots label={tool.label} />
            </span>
          ) : tool.state === "failed" ? (
            <span className="text-[#b42318]">
              {tool.label} failed
              {tool.errorText ? ` · ${tool.errorText}` : ""}
            </span>
          ) : (
            <span>
              <span className="font-medium text-zinc-700">{tool.label}</span>
              {tool.count && <> → {tool.count}</>}
            </span>
          )}
          {ids.length > 0 && <IdChips ids={ids} />}
        </div>
      )}
    </AgentBubble>
  );
}

/** The agent's steps as bubbles under the run status ("Step n of 8" / "Done · n steps"). */
export function ConversationSteps({
  trace,
  running,
}: {
  trace: TraceState;
  running: boolean;
}) {
  const bubbles = toBubbles(trace.items);
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <TraceHeader trace={trace} running={running} />
      <div className="space-y-2 p-3">
        {bubbles.map((b) => (
          <StepBubbleView key={b.key} bubble={b} />
        ))}
        {awaitingAgent(bubbles, running) && (
          <AgentBubble>
            <TypingDots />
          </AgentBubble>
        )}
      </div>
    </section>
  );
}

/** Final call: "My call: Tech team · 91% confident" + Because bullets, each tied to its records. */
export function VerdictBubble({ verdict }: { verdict: Verdict }) {
  const reasons = verdictReasons(verdict);
  const { focus } = useEvidenceFocus();
  return (
    <article className="copilot-bubble-in overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <VerdictHeader verdict={verdict} prefix="My call: " />
      <div className="divide-y divide-zinc-100 [&>*]:px-4 [&>*]:py-3">
        {(verdict.downgraded || verdict.outcome === "suspicious") && (
          <div className="space-y-2">
            {verdict.downgraded && <DowngradedNotice verdict={verdict} />}
            {verdict.outcome === "suspicious" && <SuspiciousBanner />}
          </div>
        )}
        <SummaryText text={verdict.summary} />
        <section>
          <div className="mb-1.5 text-[12px] leading-4 font-medium text-zinc-500">
            Because
          </div>
          <ul className="space-y-1.5">
            {reasons.map((r) => (
              <li
                key={`${r.ids.join(" ")}-${r.text}`}
                className="flex items-start gap-2 text-[13px] leading-5 text-zinc-700"
              >
                {r.ids.length > 0 ? (
                  r.ids.map((id) => (
                    <IdChip key={id} id={id} onClick={() => focus(id)} />
                  ))
                ) : (
                  <span
                    aria-hidden
                    className="mt-2 size-1 shrink-0 rounded-full bg-zinc-400"
                  />
                )}
                <span className="min-w-0 flex-1">{r.text}</span>
              </li>
            ))}
          </ul>
        </section>
        <div className="space-y-1 text-[13px] leading-5 text-zinc-700">
          <p>
            <span className="font-medium text-zinc-900">Customer wants:</span>{" "}
            {verdict.customerGoal}
          </p>
          {verdict.outcome === "tech_team" && verdict.techIssue && (
            <p>
              <span className="font-medium text-zinc-900">Root cause:</span>{" "}
              {verdict.techIssue.title} — {verdict.techIssue.rootCause}
            </p>
          )}
        </div>
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

  const { verdict, onPropose } = props;
  return (
    <div className={cn(entering && "copilot-proposal-in")}>
      {verdict.outcome === "suspicious" ? (
        verdict.replyDraft.trim() !== "" && (
          <section className="space-y-2">
            <SecondaryButton onClick={() => onPropose(verdict.replyDraft)}>
              Use suggested reply
            </SecondaryButton>
          </section>
        )
      ) : (
        <NextStep {...props} />
      )}
    </div>
  );
}
