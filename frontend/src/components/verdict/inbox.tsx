"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { toast } from "sonner";

import { api, errorMessage, type CaseDetail, type CaseListItem } from "@/api";
import { CaseList } from "./case-list";
import { ChatThread } from "./chat-thread";
import { CustomerCard } from "./customer-card";
import { appendDraft } from "./suggested-reply";
import type { Proposal } from "./suggested-reply-card";
import { InvestigatePanel } from "./investigate-panel";

const POLL_MS = 3000;
const CASE_PARAM = "case";

export function Inbox() {
  const [cases, setCases] = useState<CaseListItem[] | null>(null);
  // Selection lives in ?case= so it survives reload; unknown ids fall back to the first case.
  const urlCaseId = useSearchParams().get(CASE_PARAM);
  const selectedId = !cases
    ? urlCaseId
    : cases.some((c) => c.id === urlCaseId)
      ? urlCaseId
      : (cases[0]?.id ?? null);
  const setSelectedId = (id: string) =>
    window.history.replaceState(
      null,
      "",
      `?${new URLSearchParams({ [CASE_PARAM]: id }).toString()}`,
    );
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** Last text inserted from a proposal per case; drives the "Suggested by Verdict" badge. */
  const [suggestions, setSuggestions] = useState<Record<string, string>>({});
  /** Suggested reply waiting for a click per case; nothing reaches the composer without one. */
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  const refreshList = useCallback(
    () =>
      api.listCases().then(
        (list) => {
          setCases(list);
          setLoadError(null);
        },
        (e: unknown) => setLoadError(errorMessage(e)),
      ),
    [],
  );

  // On failure keep the last good detail; the list poll surfaces connectivity errors.
  const refreshDetail = useCallback(
    (id: string) =>
      api.getCase(id).then(
        (d) => {
          if (selectedIdRef.current === id) setDetail(d);
        },
        () => undefined,
      ),
    [],
  );

  useEffect(() => {
    void refreshList();
    const t = setInterval(() => void refreshList(), POLL_MS);
    return () => clearInterval(t);
  }, [refreshList]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (!selectedId) return;
    void refreshDetail(selectedId);
    const t = setInterval(() => void refreshDetail(selectedId), POLL_MS);
    return () => clearInterval(t);
  }, [selectedId, refreshDetail]);

  const refreshAll = useCallback(() => {
    void refreshList();
    if (selectedIdRef.current) void refreshDetail(selectedIdRef.current);
  }, [refreshList, refreshDetail]);

  const current = detail && detail.case.id === selectedId ? detail : null;
  const draft = selectedId ? (drafts[selectedId] ?? "") : "";
  const setDraft = (value: string) => {
    if (selectedId) setDrafts((d) => ({ ...d, [selectedId]: value }));
  };
  const propose = useCallback((caseId: string, text: string) => {
    if (text.trim() === "") return;
    setProposals((p) => ({
      ...p,
      [caseId]: { text, nonce: (p[caseId]?.nonce ?? 0) + 1 },
    }));
  }, []);
  const dismissProposal = () => {
    if (!selectedId) return;
    setProposals((p) =>
      Object.fromEntries(Object.entries(p).filter(([id]) => id !== selectedId)),
    );
  };
  const insertProposal = (text: string, how: "replace" | "append") => {
    if (!selectedId) return;
    if (how === "replace") {
      setSuggestions((s) => ({ ...s, [selectedId]: text }));
      setDraft(text);
    } else {
      setDraft(appendDraft(draft, text));
    }
    dismissProposal();
  };
  const suggested =
    selectedId !== null && draft !== "" && draft === suggestions[selectedId];

  async function send(body: string) {
    if (!selectedId) return;
    try {
      const d = await api.reply(selectedId, body);
      setDetail(d);
      setDraft("");
      void refreshList();
      toast.success("Reply sent");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 bg-white">
      <CaseList
        cases={cases}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      {loadError && !cases ? (
        <Empty>Could not load cases ({loadError}).</Empty>
      ) : !current ? (
        <Empty>{selectedId ? "Loading case…" : "Select a conversation."}</Empty>
      ) : (
        <>
          <ChatThread
            detail={current}
            draft={draft}
            suggested={suggested}
            lastSuggestion={suggestions[current.case.id]}
            proposal={proposals[current.case.id] ?? null}
            onProposalInsert={insertProposal}
            onProposalDismiss={dismissProposal}
            onDraftChange={setDraft}
            onSend={send}
          />
          <aside className="flex min-h-0 w-[440px] shrink-0 flex-col overflow-y-auto border-l border-zinc-200 bg-white">
            <InvestigatePanel
              key={current.case.id}
              caseId={current.case.id}
              caseStatus={current.case.status}
              storedVerdict={current.case.verdict}
              onPropose={(text) => propose(current.case.id, text)}
              onChanged={refreshAll}
            />
            <CustomerCard detail={current} />
          </aside>
        </>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-white text-[13px] text-zinc-500">
      {children}
    </div>
  );
}
