"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** How long a focused record stays highlighted. */
const HIGHLIGHT_MS = 2500;

/** Classes for a highlighted record; shared so every target looks the same. */
export const HIGHLIGHT_CLASS =
  "rounded-md bg-amber-100 ring-2 ring-amber-400 transition-colors";

interface EvidenceFocus {
  focusedId: string | null;
  focus: (id: string) => void;
}

const NO_FOCUS: EvidenceFocus = { focusedId: null, focus: () => undefined };

const EvidenceFocusContext = createContext<EvidenceFocus>(NO_FOCUS);

/**
 * Click an evidence id → the record with that id (customer card row, chat message, trace row) is
 * highlighted and scrolled into view. Targets opt in with `useEvidenceTarget(ids)`.
 */
export function EvidenceFocusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focus = useCallback((id: string) => {
    setFocusedId(id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFocusedId(null), HIGHLIGHT_MS);
    const target = document.querySelector(
      `[data-evidence~="${CSS.escape(id)}"]`,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const value = useMemo(() => ({ focusedId, focus }), [focusedId, focus]);
  return (
    <EvidenceFocusContext.Provider value={value}>
      {children}
    </EvidenceFocusContext.Provider>
  );
}

export function useEvidenceFocus(): EvidenceFocus {
  return useContext(EvidenceFocusContext);
}

/** Marks an element as the home of these record ids; `highlighted` is true while one is focused. */
export function useEvidenceTarget(ids: readonly string[]): {
  attrs: { "data-evidence": string };
  highlighted: boolean;
} {
  const { focusedId } = useEvidenceFocus();
  return {
    attrs: { "data-evidence": ids.join(" ") },
    highlighted: focusedId !== null && ids.includes(focusedId),
  };
}
