"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { GhostButton, PrimaryButton, SecondaryButton } from "./controls";
import { insertMode } from "./suggested-reply";

export interface Proposal {
  text: string;
  /** Bumped on every re-propose so the card re-enters. */
  nonce: number;
}

interface SuggestedReplyCardProps {
  proposal: Proposal;
  draft: string;
  lastSuggestion: string | undefined;
  onInsert: (text: string, how: "replace" | "append") => void;
  onDismiss: () => void;
}

/** Text over this many chars gets an expand toggle (preview is clamped to 3 lines). */
const PREVIEW_CLAMP_CHARS = 180;

/** Proposed reply above the composer: the agent decides; Insert never overwrites their text silently. */
export function SuggestedReplyCard({
  proposal,
  draft,
  lastSuggestion,
  onInsert,
  onDismiss,
}: SuggestedReplyCardProps) {
  return (
    <SuggestedReplyBody
      // Fresh proposal → fresh card state and entrance.
      key={proposal.nonce}
      proposal={proposal}
      draft={draft}
      lastSuggestion={lastSuggestion}
      onInsert={onInsert}
      onDismiss={onDismiss}
    />
  );
}

function SuggestedReplyBody({
  proposal,
  draft,
  lastSuggestion,
  onInsert,
  onDismiss,
}: SuggestedReplyCardProps) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const long = proposal.text.length > PREVIEW_CLAMP_CHARS;

  function insert() {
    if (insertMode(draft, lastSuggestion) === "confirm") setConfirming(true);
    else onInsert(proposal.text, "replace");
  }

  return (
    <section
      aria-label="Suggested reply"
      className="animate-in fade-in-0 slide-in-from-bottom-1 mb-3 rounded-lg border border-zinc-200 bg-white duration-200 ease-[cubic-bezier(.25,.46,.45,.94)] motion-reduce:animate-none"
    >
      <div className="px-3 pt-2.5">
        <div className="text-[12px] leading-4 font-medium text-indigo-700">
          Suggested reply
        </div>
        <p
          className={cn(
            "mt-1 text-[13px] leading-5 whitespace-pre-wrap text-zinc-700",
            !open && "line-clamp-3",
          )}
        >
          {proposal.text}
        </p>
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        {confirming ? (
          <>
            <span className="text-[13px] font-medium text-zinc-900">
              Replace your draft?
            </span>
            <PrimaryButton onClick={() => onInsert(proposal.text, "replace")}>
              Replace
            </PrimaryButton>
            <SecondaryButton onClick={() => onInsert(proposal.text, "append")}>
              Append
            </SecondaryButton>
            <GhostButton
              className="ml-auto"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </GhostButton>
          </>
        ) : (
          <>
            <PrimaryButton onClick={insert}>Insert</PrimaryButton>
            <GhostButton onClick={onDismiss}>Dismiss</GhostButton>
            {long && (
              <GhostButton className="ml-auto" onClick={() => setOpen(!open)}>
                {open ? "Show less" : "Show more"}
              </GhostButton>
            )}
          </>
        )}
      </div>
    </section>
  );
}
