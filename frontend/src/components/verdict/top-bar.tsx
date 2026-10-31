"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { RotateCcw, Scale } from "lucide-react";

import { cn } from "@/lib/utils";

import { toast } from "sonner";

import { api, errorMessage } from "@/api";

const POLL_MS = 3000;

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

  async function reset() {
    setResetting(true);
    try {
      await api.reset();
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
    <header className="flex h-14 shrink-0 items-center gap-8 border-b border-zinc-200 bg-white px-5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
          <Scale className="size-4" />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Verdict</span>
          <span className="text-[11px] text-zinc-500">Support copilot</span>
        </div>
      </div>
      <nav className="flex items-center gap-1">
        {nav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors",
                active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
              )}
            >
              {item.label}
              {item.badge !== null && (
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold tabular-nums",
                    active
                      ? "bg-indigo-600 text-white"
                      : "bg-zinc-200 text-zinc-700",
                  )}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset",
            api.mode === "http"
              ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
              : "bg-zinc-50 text-zinc-600 ring-zinc-300",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              api.mode === "http" ? "bg-emerald-500" : "bg-zinc-400",
            )}
          />
          {MODE_LABEL[api.mode]}
        </span>
        <button
          type="button"
          onClick={reset}
          disabled={resetting}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50"
        >
          <RotateCcw className={cn("size-3.5", resetting && "animate-spin")} />
          Reset demo
        </button>
      </div>
    </header>
  );
}
