"use client";

import {
  Activity,
  BookOpen,
  Bug,
  CircleAlert,
  CreditCard,
  Gavel,
  KeyRound,
  LoaderCircle,
  Mail,
  Sparkle,
  MessageSquare,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import {
  HIGHLIGHT_CLASS,
  useEvidenceFocus,
  useEvidenceTarget,
} from "./evidence-focus";
import type { TraceNode } from "./investigate-trace";
import { IdChip } from "./outcome-badge";

interface ToolMeta {
  icon: LucideIcon;
  running: string;
  done: string;
  /** Noun for the count suffix, e.g. "payment" → "3 payments". */
  noun?: string;
  /** Keys to look for the counted array in an object output. */
  keys?: string[];
}

const TOOLS: Record<string, ToolMeta> = {
  getChat: {
    icon: MessageSquare,
    running: "Reading chat",
    done: "Read chat",
    noun: "message",
    keys: ["messages"],
  },
  getCustomer: {
    icon: UserRound,
    running: "Looking up customer",
    done: "Looked up customer",
  },
  getBilling: {
    icon: CreditCard,
    running: "Checking billing",
    done: "Checked billing",
    noun: "payment",
    keys: ["payments"],
  },
  getEntitlements: {
    icon: KeyRound,
    running: "Checking access",
    done: "Checked access",
    noun: "entitlement",
    keys: ["entitlements"],
  },
  getSessionEvents: {
    icon: Activity,
    running: "Reading session events",
    done: "Read session events",
    noun: "event",
    keys: ["events"],
  },
  getErrorLogs: {
    icon: Bug,
    running: "Reading error logs",
    done: "Read error logs",
    noun: "error",
    keys: ["errors", "logs"],
  },
  getEmailLog: {
    icon: Mail,
    running: "Checking email log",
    done: "Checked email log",
    noun: "email",
    keys: ["emails"],
  },
  searchHelp: {
    icon: BookOpen,
    running: "Searching help center",
    done: "Searched help center",
    noun: "article",
    keys: ["articles", "results"],
  },
  findSimilarCustomers: {
    icon: Users,
    running: "Looking for similar customers",
    done: "Found similar customers",
    noun: "customer",
    keys: ["customers", "customerIds", "matches"],
  },
  submitVerdict: {
    icon: Gavel,
    running: "Writing verdict",
    done: "Submitted verdict",
  },
};

function countOf(output: unknown, keys: string[] = []): number | null {
  if (Array.isArray(output)) return output.length;
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  for (const key of keys) {
    const v = record[key];
    if (Array.isArray(v)) return v.length;
  }
  if (typeof record.count === "number") return record.count;
  const firstArray = Object.values(record).find(Array.isArray);
  return firstArray ? firstArray.length : null;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Chips shown per tool row before collapsing the rest into "+N". */
const MAX_ID_CHIPS = 4;

const NO_IDS: string[] = [];

interface TimelineNodeProps {
  node: TraceNode;
  last: boolean;
}

/** One agent step: muted thought, then the tool it called with the record ids it returned. */
export function TimelineNode({ node, last }: TimelineNodeProps) {
  const { tool, thought } = node;
  const ids =
    tool && tool.name !== "submitVerdict" ? (tool.ids ?? NO_IDS) : NO_IDS;
  const { attrs, highlighted } = useEvidenceTarget(ids, { reference: true });
  const meta = tool ? metaOf(tool.name) : null;
  const done = tool?.state === "output-available";
  const failed = tool?.state === "output-error";
  const running = !!tool && !done && !failed;
  const count = done && meta?.noun ? countOf(tool.output, meta.keys) : null;

  return (
    <li className="relative flex gap-3">
      {!last && (
        <span
          aria-hidden
          className="absolute top-7 bottom-0 left-[11px] w-px bg-zinc-200"
        />
      )}
      <NodeIcon
        icon={meta?.icon ?? Sparkle}
        tone={
          failed ? "failed" : running ? "running" : tool ? "done" : "thinking"
        }
      />
      <div
        {...attrs}
        className={cn(
          "-mx-1 min-w-0 flex-1 px-1 pb-3",
          highlighted && HIGHLIGHT_CLASS,
        )}
      >
        {thought && (
          <p className="pt-1 text-xs leading-snug whitespace-pre-line text-zinc-500 italic">
            {thought}
          </p>
        )}
        {tool && meta && (
          <div
            className={cn(
              "flex items-center gap-1.5 pt-1 text-[13px]",
              thought && "pt-1.5",
            )}
          >
            <span
              className={cn(
                "truncate font-medium",
                failed
                  ? "text-red-700"
                  : running
                    ? "animate-pulse text-indigo-700"
                    : "text-zinc-800",
              )}
            >
              {failed
                ? `${meta.done} failed`
                : done
                  ? meta.done
                  : `${meta.running}…`}
            </span>
            {count !== null && meta.noun && (
              <span className="shrink-0 text-xs text-zinc-400">
                · {plural(count, meta.noun)}
              </span>
            )}
          </div>
        )}
        {failed && tool?.errorText && (
          <p className="text-xs text-red-600">{tool.errorText}</p>
        )}
        {done && ids.length > 0 && <IdChips ids={ids} />}
      </div>
    </li>
  );
}

function metaOf(name: string): ToolMeta {
  return (
    TOOLS[name] ?? { icon: Wrench, running: `Running ${name}`, done: name }
  );
}

type NodeTone = "running" | "done" | "failed" | "thinking";

const NODE_TONE: Record<NodeTone, string> = {
  running: "border-indigo-200 bg-indigo-50 text-indigo-600",
  done: "border-zinc-200 bg-white text-zinc-500",
  failed: "border-red-200 bg-red-50 text-red-600",
  thinking: "border-zinc-200 bg-zinc-50 text-zinc-400",
};

function NodeIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: NodeTone }) {
  return (
    <span
      className={cn(
        "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border",
        NODE_TONE[tone],
      )}
    >
      {tone === "running" ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : tone === "failed" ? (
        <CircleAlert className="size-3.5" />
      ) : (
        <Icon className="size-3.5" />
      )}
    </span>
  );
}

function IdChips({ ids }: { ids: readonly string[] }) {
  const { focus } = useEvidenceFocus();
  const shown = ids.slice(0, MAX_ID_CHIPS);
  const rest = ids.length - shown.length;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {shown.map((id) => (
        <IdChip key={id} id={id} onClick={() => focus(id)} />
      ))}
      {rest > 0 && (
        <span
          title={ids.slice(MAX_ID_CHIPS).join(", ")}
          className="text-[10.5px] text-zinc-400 tabular-nums"
        >
          +{rest}
        </span>
      )}
    </div>
  );
}
