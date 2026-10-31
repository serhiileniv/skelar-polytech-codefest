import { z } from "zod";

export const OUTCOMES = ["user_can_fix", "support_can_fix", "tech_team", "need_more_info", "suspicious"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Known root-cause detectors; used to find similar customers and to merge board cards. */
export const SIGNATURES = ["cancel_not_synced", "entitlement_grant_failed", "duplicate_charge"] as const;
export type Signature = (typeof SIGNATURES)[number];

const id = z.string().min(1).max(64);

export const supportActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("restore_access"), entitlementId: id, reason: z.string().min(3).max(300) }),
  z.object({ type: z.literal("refund_payment"), paymentId: id, reason: z.string().min(3).max(300) }),
]);
export type SupportAction = z.infer<typeof supportActionSchema>;

/** What the model submits via the final `submitVerdict` tool. */
export const verdictSchema = z.object({
  outcome: z.enum(OUTCOMES),
  confidence: z.number().min(0).max(1),
  customerGoal: z.string().min(3).max(300).describe("What the customer actually needs, in one sentence."),
  summary: z.string().min(3).max(800).describe("For the support member: what happened, citing evidence ids."),
  evidence: z
    .array(z.object({ id, note: z.string().min(3).max(200) }))
    .max(12)
    .describe("Record ids returned by tools that prove the outcome."),
  instructionSteps: z.array(z.string().min(3).max(200)).max(10).optional().describe("user_can_fix only."),
  helpArticleId: id.optional(),
  supportAction: supportActionSchema.optional().describe("support_can_fix only."),
  techIssue: z
    .object({ signature: z.enum(SIGNATURES), title: z.string().min(5).max(120), rootCause: z.string().min(5).max(500) })
    .optional()
    .describe("tech_team only."),
  clarifyingQuestion: z.string().min(5).max(300).optional().describe("need_more_info only."),
  replyDraft: z.string().min(10).max(1500).describe("Message the support member can send to the customer."),
});
export type Verdict = z.infer<typeof verdictSchema>;

/** Verdict after code validation, as stored on the case. */
export interface StoredVerdict extends Verdict {
  /** True when the validator changed the model's outcome. */
  downgraded: boolean;
  validationNotes: string[];
  modelOutcome: Outcome;
  stepsUsed: number;
  createdAt: string;
}
