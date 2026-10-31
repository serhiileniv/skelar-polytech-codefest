/** Mock `POST /api/cases/{id}/ask`: canned, evidence-grounded answers built from the stored verdict. */
import { ApiRequestError } from "../errors";
import type { AskResult, Case, Outcome, Verdict } from "../types";

export const MAX_QUESTION_CHARS = 500;

const OUTCOME_LABEL: Record<Outcome, string> = {
  user_can_fix: "Customer can fix it",
  support_can_fix: "Support can fix it",
  tech_team: "Tech team",
  need_more_info: "Need more info",
  suspicious: "Suspicious — blocked",
};

const badRequest = (message: string) =>
  new ApiRequestError(400, { code: "bad_request", message });

/** Same checks as the Go handler: 400 on empty / too long, 409 when the case has no verdict. */
export function assertAskable(kase: Case, question: string): Verdict {
  const q = question.trim();
  if (q === "") throw badRequest("question is required");
  if (q.length > MAX_QUESTION_CHARS)
    throw badRequest(`question is longer than ${MAX_QUESTION_CHARS} chars`);
  if (!kase.verdict)
    throw new ApiRequestError(409, {
      code: "conflict",
      message: `Case ${kase.id} has no verdict yet; investigate first`,
    });
  return kase.verdict;
}

const pct = (v: Verdict) => Math.round(v.confidence * 100);
const ids = (v: Verdict) => v.evidence.map((e) => e.id);

function whyAnswer(v: Verdict): AskResult {
  return {
    answer: `My call is "${OUTCOME_LABEL[v.outcome]}" at ${pct(v)}%. ${v.summary}`,
    evidence: ids(v),
  };
}

function evidenceAnswer(v: Verdict): AskResult {
  if (v.evidence.length === 0)
    return {
      answer: "I did not cite any records for this case.",
      evidence: [],
    };
  const lines = v.evidence.map((e) => `${e.id}: ${e.note}`).join("; ");
  return {
    answer: `I relied on ${v.evidence.length} records — ${lines}.`,
    evidence: ids(v),
  };
}

function refundAnswer(v: Verdict): AskResult {
  const action = v.supportAction;
  if (v.outcome === "suspicious")
    return {
      answer:
        "I would not refund: the message tries to make support act outside policy, so every action is blocked (rule S1).",
      evidence: ids(v),
    };
  if (action?.type === "refund_payment")
    return {
      answer: `A refund of ${action.paymentId} is exactly what I propose: ${action.reason}. It still goes through the policy gate when you click.`,
      evidence: ids(v),
    };
  return {
    answer: `A refund does not fix what the evidence shows. ${v.summary}`,
    evidence: ids(v),
  };
}

/** Picks a canned answer by keyword; anything else gets the verdict summary. */
export function askAnswer(v: Verdict, question: string): AskResult {
  const q = question.toLowerCase();
  if (q.includes("refund")) return refundAnswer(v);
  if (q.includes("evidence") || q.includes("record")) return evidenceAnswer(v);
  if (q.includes("why") || q.includes("outcome")) return whyAnswer(v);
  return { answer: `From the evidence: ${v.summary}`, evidence: ids(v) };
}
