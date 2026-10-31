"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { typewriterLength } from "./conversation-view";

interface Typewriter {
  /** What to render now: a prefix of `text` while typing, else `text`. */
  value: string;
  typing: boolean;
  /** Stop and show the full text. */
  skip: () => void;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Types `text` in when it changes while `enabled` (a fresh copilot suggestion).
 * A change of `resetKey` (another case) or the first render shows the text at once.
 */
export function useTypewriter(
  text: string,
  enabled: boolean,
  resetKey: string,
): Typewriter {
  const [shown, setShown] = useState<{ text: string; n: number } | null>(null);
  const seen = useRef({ key: resetKey, text });
  const frame = useRef(0);

  useEffect(() => {
    const prev = seen.current;
    seen.current = { key: resetKey, text };
    const fresh = enabled && prev.key === resetKey && prev.text !== text;
    if (!fresh || text === "" || prefersReducedMotion()) return;
    const start = performance.now();
    frame.current = requestAnimationFrame(function tick(now) {
      const n = typewriterLength(text.length, now - start);
      setShown(n >= text.length ? null : { text, n });
      if (n < text.length) frame.current = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame.current);
      setShown(null);
    };
  }, [text, enabled, resetKey]);

  const skip = useCallback(() => {
    cancelAnimationFrame(frame.current);
    setShown(null);
  }, []);
  const typing = shown !== null && shown.text === text;
  return { value: typing ? text.slice(0, shown.n) : text, typing, skip };
}
