"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CaseDetail, CaseListItem } from "@/lib/api-contract";

import { api } from "./api";
import { CaseList } from "./case-list";
import { ChatThread } from "./chat-thread";
import { CustomerCard } from "./customer-card";
import { InvestigatePanel } from "./investigate-panel";

const POLL_MS = 3000;

export function Inbox() {
  const [cases, setCases] = useState<CaseListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  const refreshList = useCallback(
    () =>
      api.listCases().then(
        (list) => {
          setCases(list);
          setLoadError(null);
          setSelectedId((cur) => cur ?? list[0]?.id ?? null);
        },
        (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
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

  async function send(body: string) {
    if (!selectedId) return;
    const d = await api.reply(selectedId, body);
    setDetail(d);
    setDraft("");
    void refreshList();
  }

  return (
    <div className="flex min-h-0 flex-1">
      <CaseList cases={cases} selectedId={selectedId} onSelect={setSelectedId} />
      {loadError && !cases ? (
        <Empty>Could not load cases ({loadError}).</Empty>
      ) : !current ? (
        <Empty>{selectedId ? "Loading case…" : "Select a conversation."}</Empty>
      ) : (
        <>
          <ChatThread detail={current} draft={draft} onDraftChange={setDraft} onSend={send} />
          <aside className="min-h-0 w-[380px] shrink-0 overflow-y-auto border-l border-zinc-200 bg-white">
            <CustomerCard detail={current} />
            <InvestigatePanel
              key={current.case.id}
              caseId={current.case.id}
              storedVerdict={current.case.verdict}
              onInsert={setDraft}
              onChanged={refreshAll}
            />
          </aside>
        </>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">{children}</div>;
}
