import { findBySignature } from "../domain/detectors";
import type { Db, TechIssue } from "../domain/types";

let seq = 0;

/**
 * Sends a case's tech_team verdict to the board. Same signature → same card (merged),
 * with affected customers computed by the deterministic detector, not by the model.
 */
export function sendToTech(db: Db, caseId: string): TechIssue {
  const kase = db.cases.find((c) => c.id === caseId);
  const issue = kase?.verdict?.techIssue;
  if (!kase || kase.verdict?.outcome !== "tech_team" || !issue) {
    throw new Error("Case has no tech_team verdict");
  }

  const affected = findBySignature(db, issue.signature);
  let card = db.techIssues.find((t) => t.signature === issue.signature && t.status !== "resolved");
  if (!card) {
    card = {
      id: `tech_${String(db.techIssues.length + 1).padStart(3, "0")}_${(++seq).toString(36)}`,
      signature: issue.signature,
      title: issue.title,
      rootCause: issue.rootCause,
      evidenceIds: [],
      caseIds: [],
      affectedCustomerIds: [],
      status: "new",
      createdAt: db.now,
    };
    db.techIssues.push(card);
  }

  card.caseIds = [...new Set([...card.caseIds, caseId])];
  card.evidenceIds = [...new Set([...card.evidenceIds, ...kase.verdict.evidence.map((e) => e.id)])];
  card.affectedCustomerIds = [...new Set([...card.affectedCustomerIds, kase.customerId, ...affected])];
  kase.status = "with_tech";
  return card;
}
