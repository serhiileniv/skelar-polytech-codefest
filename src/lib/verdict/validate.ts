import type { Db } from "../domain/types";
import type { StoredVerdict, Verdict } from "./schema";

export interface ValidationContext {
  /** Every record id the agent's tools actually returned during this run. */
  seenIds: ReadonlySet<string>;
  db: Readonly<Db>;
  caseId: string;
  stepsUsed: number;
}

/**
 * Code-side check of the model's verdict. The model proposes; this decides whether to trust it.
 * Any inconsistency downgrades to `need_more_info` so a support member looks before acting.
 */
export function validateVerdict(v: Verdict, ctx: ValidationContext): StoredVerdict {
  const notes: string[] = [];
  const unseen = v.evidence.filter((e) => !ctx.seenIds.has(e.id)).map((e) => e.id);
  if (unseen.length) notes.push(`Evidence not returned by any tool: ${unseen.join(", ")}`);

  const customerId = ctx.db.cases.find((c) => c.id === ctx.caseId)?.customerId;
  const cited = new Set(v.evidence.map((e) => e.id));

  switch (v.outcome) {
    case "user_can_fix":
      if (!v.instructionSteps?.length) notes.push("user_can_fix needs instruction steps");
      if (v.evidence.length === 0) notes.push("user_can_fix needs evidence");
      break;
    case "support_can_fix": {
      const a = v.supportAction;
      if (!a) {
        notes.push("support_can_fix needs a support action");
        break;
      }
      const targetId = a.type === "restore_access" ? a.entitlementId : a.paymentId;
      const owned =
        a.type === "restore_access"
          ? ctx.db.entitlements.some((e) => e.id === targetId && e.customerId === customerId)
          : ctx.db.payments.some((p) => p.id === targetId && p.customerId === customerId);
      if (!owned) notes.push(`Action target ${targetId} does not belong to this customer`);
      if (!cited.has(targetId) && !ctx.seenIds.has(targetId)) notes.push(`Action target ${targetId} was never inspected`);
      break;
    }
    case "tech_team":
      if (!v.techIssue) notes.push("tech_team needs a tech issue");
      if (!ctx.db.errors.some((e) => cited.has(e.id)) && !ctx.db.payments.some((p) => cited.has(p.id))) {
        notes.push("tech_team needs an error log or payment as evidence");
      }
      break;
    case "need_more_info":
      if (!v.clarifyingQuestion) notes.push("need_more_info needs a clarifying question");
      break;
    case "suspicious":
      break;
  }

  // A suspicious verdict must never carry an executable action.
  const supportAction = v.outcome === "suspicious" ? undefined : v.supportAction;
  const downgraded = notes.length > 0 && v.outcome !== "need_more_info" && v.outcome !== "suspicious";

  return {
    ...v,
    supportAction: downgraded ? undefined : supportAction,
    outcome: downgraded ? "need_more_info" : v.outcome,
    clarifyingQuestion:
      v.clarifyingQuestion ?? (downgraded ? "Could you share more details so we can check this properly?" : undefined),
    downgraded,
    validationNotes: notes,
    modelOutcome: v.outcome,
    stepsUsed: ctx.stepsUsed,
    createdAt: ctx.db.now,
  };
}
