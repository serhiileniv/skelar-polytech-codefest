"use client";

import { useMemo, useState } from "react";

import type { CaseDetail } from "@/api";
import { cn } from "@/lib/utils";

import { VerdictMark } from "./avatar";
import { customerRecordIds } from "./conversation-view";
import { CustomerCard } from "./customer-card";
import { useEvidenceFocus } from "./evidence-focus";
import { InvestigatePanel } from "./investigate-panel";

type Tab = "copilot" | "customer";

interface CopilotPaneProps {
  detail: CaseDetail;
  onPropose: (text: string) => void;
  onChanged: () => void;
}

/** Right pane: Copilot (investigation → verdict → next step → Ask) and the customer's records. */
export function CopilotPane({
  detail,
  onPropose,
  onChanged,
}: CopilotPaneProps) {
  const [tab, setTab] = useState<Tab>("copilot");
  const recordIds = useMemo(() => customerRecordIds(detail), [detail]);

  // An evidence click on a customer record opens the Customer tab (derived during render,
  // so the record is in the DOM when the focus provider scrolls to it next frame).
  const { focusedId, seq } = useEvidenceFocus();
  const [seenSeq, setSeenSeq] = useState(seq);
  if (seq !== seenSeq) {
    setSeenSeq(seq);
    if (focusedId && recordIds.has(focusedId)) setTab("customer");
  }

  return (
    <aside className="bg-copilot border-t-copilot-line flex min-h-0 w-[440px] shrink-0 flex-col rounded-lg border border-t-2 border-zinc-200">
      <header
        role="tablist"
        aria-label="Copilot pane"
        className="flex h-11 shrink-0 items-end gap-4 border-b border-zinc-200 px-4"
      >
        <TabButton active={tab === "copilot"} onClick={() => setTab("copilot")}>
          <VerdictMark />
          Copilot
        </TabButton>
        <TabButton
          active={tab === "customer"}
          onClick={() => setTab("customer")}
        >
          Customer
        </TabButton>
      </header>

      {/* Kept mounted while hidden: a running investigation must survive a tab switch. */}
      <div
        role="tabpanel"
        className={cn(
          "min-h-0 flex-1 flex-col",
          tab === "copilot" ? "flex" : "hidden",
        )}
      >
        <InvestigatePanel
          caseId={detail.case.id}
          caseStatus={detail.case.status}
          storedVerdict={detail.case.verdict}
          onPropose={onPropose}
          onChanged={onChanged}
        />
      </div>
      {tab === "customer" && (
        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4">
          <CustomerCard detail={detail} />
        </div>
      )}
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "-mb-px flex h-11 items-center gap-2 border-b-2 text-[13px] leading-[18px] font-semibold transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none motion-reduce:transition-none",
        active
          ? "border-copilot-line text-zinc-900"
          : "border-transparent text-zinc-500 hover:text-zinc-900",
      )}
    >
      {children}
    </button>
  );
}
