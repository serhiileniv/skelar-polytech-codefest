import { describe, expect, it } from "vitest";
import { createSeed } from "../domain/seed";
import type { Db } from "../domain/types";
import type { Verdict } from "../verdict/schema";
import { validateVerdict } from "../verdict/validate";
import { sendToTech } from "./board";

function withTechVerdict(db: Db, caseId: string): void {
  const kase = db.cases.find((c) => c.id === caseId)!;
  const err = db.errors.find((e) => e.customerId === kase.customerId)!;
  const v: Verdict = {
    outcome: "tech_team",
    confidence: 0.9,
    customerGoal: "Stop charges after cancelling",
    summary: "Web cancel not propagated to App Store subscription.",
    evidence: [{ id: err.id, note: "sync timeout" }],
    techIssue: { signature: "cancel_not_synced", title: "Web cancel not synced to App Store", rootCause: "CANCEL_SYNC_TIMEOUT" },
    replyDraft: "We found the issue and our team is on it.",
  };
  kase.verdict = validateVerdict(v, { seenIds: new Set([err.id]), db, caseId, stepsUsed: 5 });
}

describe("tech board", () => {
  it("creates one card with every affected customer from the detector", () => {
    const db = createSeed();
    withTechVerdict(db, "case_104");
    const card = sendToTech(db, "case_104");
    expect(card.affectedCustomerIds).toHaveLength(38);
    expect(card.caseIds).toEqual(["case_104"]);
    expect(db.cases.find((c) => c.id === "case_104")?.status).toBe("with_tech");
  });

  it("merges a second case with the same root cause into the same card", () => {
    const db = createSeed();
    withTechVerdict(db, "case_104");
    sendToTech(db, "case_104");
    sendToTech(db, "case_104");
    expect(db.techIssues).toHaveLength(1);
    expect(db.techIssues[0].affectedCustomerIds).toHaveLength(38);
  });

  it("refuses cases without a tech_team verdict", () => {
    const db = createSeed();
    expect(() => sendToTech(db, "case_101")).toThrow();
  });
});
