"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { RotateCcw, Scale } from "lucide-react";

import { cn } from "@/lib/utils";

import { api } from "@/api";

const NAV = [
  { href: "/", label: "Inbox" },
  { href: "/board", label: "Tech board" },
] as const;

export function TopBar() {
  const pathname = usePathname();
  const [resetting, setResetting] = useState(false);

  async function reset() {
    setResetting(true);
    try {
      await api.reset();
      window.location.reload();
    } finally {
      setResetting(false);
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-6 border-b border-zinc-200 bg-white px-4">
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-indigo-600 text-white">
          <Scale className="size-3.5" />
        </span>
        <span className="text-sm font-semibold tracking-tight">Verdict</span>
        <span className="text-xs text-zinc-400">for PawPlan support</span>
      </div>
      <nav className="flex items-center gap-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
              pathname === item.href
                ? "bg-zinc-100 text-zinc-900"
                : "text-zinc-500 hover:text-zinc-900",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <button
        type="button"
        onClick={reset}
        disabled={resetting}
        className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50"
      >
        <RotateCcw className={cn("size-3", resetting && "animate-spin")} />
        Reset demo
      </button>
    </header>
  );
}
