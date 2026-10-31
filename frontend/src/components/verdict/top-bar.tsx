"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { toast } from "sonner";

import { api, errorMessage } from "@/api";

import { VerdictMark } from "./avatar";
import { GhostButton } from "./controls";

const POLL_MS = 3000;
/** Reset reloads the page, so its toast is handed over via sessionStorage. */
const RESET_FLAG = "verdict:demo-reset";

const MODE_LABEL: Record<typeof api.mode, string> = {
  mock: "Demo data",
  http: "Live",
};

/** Open tech-board cards; null until the first poll lands (or while it fails). */
function useOpenBoardCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.board().then(
        (issues) => {
          if (alive)
            setCount(issues.filter((i) => i.status !== "resolved").length);
        },
        () => undefined,
      );
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return count;
}

export function TopBar() {
  const pathname = usePathname();
  const [resetting, setResetting] = useState(false);
  const boardCount = useOpenBoardCount();

  useEffect(() => {
    try {
      if (sessionStorage.getItem(RESET_FLAG) === null) return;
      sessionStorage.removeItem(RESET_FLAG);
      toast.success("Demo reset");
    } catch {
      // Storage blocked: the reset still happened, only the toast is lost.
    }
  }, []);

  async function reset() {
    setResetting(true);
    try {
      await api.reset();
      try {
        sessionStorage.setItem(RESET_FLAG, "1");
      } catch {
        toast.success("Demo reset");
      }
      window.location.reload();
    } catch (e) {
      toast.error(`Reset failed: ${errorMessage(e)}`);
    } finally {
      setResetting(false);
    }
  }

  const nav = [
    { href: "/", label: "Inbox", badge: null },
    { href: "/board", label: "Tech board", badge: boardCount || null },
  ] as const;

  return (
    <header className="flex h-12 shrink-0 items-center gap-6 border-b border-zinc-200 bg-white px-4">
      <span className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em] text-zinc-900">
        <VerdictMark />
        Resolly
        <span className="text-[12px] font-normal tracking-normal text-zinc-500">
          Cases resolved, with receipts
        </span>
      </span>
      <nav className="flex items-center gap-0.5">
        {nav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none motion-reduce:transition-none",
                active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
              )}
            >
              {item.label}
              {item.badge !== null && (
                <span className="rounded-full bg-[#b4532a]/10 px-1.5 text-[11px] leading-4 text-[#b4532a] tabular-nums">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500">
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              api.mode === "http" ? "bg-emerald-500" : "bg-zinc-400",
            )}
          />
          {MODE_LABEL[api.mode]}
        </span>
        <GhostButton onClick={reset} disabled={resetting}>
          {resetting ? "Resetting…" : "Reset demo"}
        </GhostButton>
      </div>
    </header>
  );
}
