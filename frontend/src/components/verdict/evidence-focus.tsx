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
    const sel = `[data-evidence~="${CSS.escape(id)}"]`;
    // Prefer the record itself over a trace row that merely mentions it.
    const target =
      document.querySelector(`${sel}:not([data-evidence-ref])`) ??
      document.querySelector(sel);
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

interface EvidenceTarget {
  attrs: { "data-evidence": string; "data-evidence-ref"?: "" };
  highlighted: boolean;
}

/**
 * Marks an element as the home of these record ids; `highlighted` is true while one is focused.
 * `reference: true` (e.g. a trace row) is only scrolled to when no record element has the id.
 */
export function useEvidenceTarget(
  ids: readonly string[],
  { reference = false }: { reference?: boolean } = {},
): EvidenceTarget {
  const { focusedId } = useEvidenceFocus();
  const base = { "data-evidence": ids.join(" ") };
  return {
    attrs: reference ? { ...base, "data-evidence-ref": "" } : base,
    highlighted: focusedId !== null && ids.includes(focusedId),
  };
}
