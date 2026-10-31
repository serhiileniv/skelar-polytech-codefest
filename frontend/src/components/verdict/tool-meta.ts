/** Display copy for agent tools (Investigate + Fix-it), shared by the timeline and the conversation. */

export interface ToolMeta {
  running: string;
  done: string;
  /** Noun for the count suffix, e.g. "payment" → "3 payments". */
  noun?: string;
  /** Keys to look for the counted array in an object output. */
  keys?: string[];
}

const TOOLS: Record<string, ToolMeta> = {
  getChat: {
    running: "Reading chat",
    done: "Read chat",
    noun: "message",
    keys: ["messages"],
  },
  getCustomer: {
    running: "Looking up customer",
    done: "Looked up customer",
  },
  getBilling: {
    running: "Checking billing",
    done: "Checked billing",
    noun: "payment",
    keys: ["payments"],
  },
  getEntitlements: {
    running: "Checking access",
    done: "Checked access",
    noun: "entitlement",
    keys: ["entitlements"],
  },
  getSessionEvents: {
    running: "Reading session events",
    done: "Read session events",
    noun: "event",
    keys: ["events"],
  },
  getErrorLogs: {
    running: "Reading error logs",
    done: "Read error logs",
    noun: "error",
    keys: ["errors", "logs"],
  },
  getEmailLog: {
    running: "Checking email log",
    done: "Checked email log",
    noun: "email",
    keys: ["emails"],
  },
  searchHelp: {
    running: "Searching help center",
    done: "Searched help center",
    noun: "article",
    keys: ["articles", "results"],
  },
  findSimilarCustomers: {
    running: "Looking for similar customers",
    done: "Found similar customers",
    noun: "customer",
    keys: ["customers", "customerIds", "matches"],
  },
  submitVerdict: {
    running: "Writing verdict",
    done: "Submitted verdict",
  },
  getCase: { running: "Reading case", done: "Read case" },
  cancelSubscription: {
    running: "Proposing subscription cancel",
    done: "Proposed subscription cancel",
  },
  sendMagicLink: {
    running: "Proposing login link",
    done: "Proposed login link",
  },
  restoreAccess: {
    running: "Proposing access restore",
    done: "Proposed access restore",
  },
  refundPayment: {
    running: "Proposing refund",
    done: "Proposed refund",
  },
  noteManualStep: {
    running: "Noting a step for a person",
    done: "Noted a step for a person",
  },
  submitFixPlan: {
    running: "Writing fix plan",
    done: "Submitted fix plan",
  },
};

/** Final tools whose ids are not evidence. */
export const FINAL_TOOLS = new Set(["submitVerdict", "submitFixPlan"]);

export function countOf(output: unknown, keys: string[] = []): number | null {
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

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function metaOf(name: string): ToolMeta {
  return TOOLS[name] ?? { running: `Running ${name}`, done: name };
}
