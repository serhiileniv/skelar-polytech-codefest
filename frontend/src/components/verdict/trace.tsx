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
  MessageSquare,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

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

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | string;

interface ToolRowProps {
  name: string;
  state: ToolState;
  output?: unknown;
  errorText?: string;
}

export function ToolRow({ name, state, output, errorText }: ToolRowProps) {
  const meta = TOOLS[name] ?? {
    icon: Wrench,
    running: `Running ${name}`,
    done: name,
  };
  const Icon = meta.icon;
  const done = state === "output-available";
  const failed = state === "output-error";
  const count = done && meta.noun ? countOf(output, meta.keys) : null;

  return (
    <li className="flex items-center gap-2 py-1 text-xs">
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded",
          failed
            ? "bg-red-50 text-red-600"
            : done
              ? "bg-zinc-100 text-zinc-600"
              : "bg-indigo-50 text-indigo-600",
        )}
      >
        {failed ? (
          <CircleAlert className="size-3" />
        ) : (
          <Icon className="size-3" />
        )}
      </span>
      <span
        className={cn(
          "truncate",
          done ? "text-zinc-700" : failed ? "text-red-700" : "text-indigo-700",
        )}
      >
        {failed ? `${meta.done} failed` : done ? meta.done : `${meta.running}…`}
        {count !== null && meta.noun && (
          <span className="text-zinc-400"> · {plural(count, meta.noun)}</span>
        )}
        {failed && errorText && (
          <span className="text-red-500/80"> · {errorText}</span>
        )}
      </span>
      {!done && !failed && (
        <LoaderCircle className="ml-auto size-3 shrink-0 animate-spin text-indigo-400" />
      )}
    </li>
  );
}

interface ThoughtRowProps {
  text: string;
}

export function ThoughtRow({ text }: ThoughtRowProps) {
  return (
    <li className="border-l-2 border-zinc-200 py-0.5 pl-2.5 text-xs leading-snug text-zinc-500">
      {text}
    </li>
  );
}
