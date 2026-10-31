import { hasToolCall, isStepCount, streamText, type LanguageModel } from "ai";
import type { Db } from "../domain/types";
import { casePrompt, INSTRUCTIONS } from "./prompt";
import { createInvestigationTools } from "./tools";

export const MAX_STEPS = 8;

export function runInvestigation(db: Db, caseId: string, model: LanguageModel) {
  const kase = db.cases.find((c) => c.id === caseId);
  if (!kase) throw new Error(`Unknown case ${caseId}`);
  const customer = db.customers.find((c) => c.id === kase.customerId);
  if (!customer) throw new Error(`Case ${caseId} has no customer`);

  const { tools } = createInvestigationTools(db, caseId);
  return streamText({
    model,
    instructions: INSTRUCTIONS,
    prompt: casePrompt(kase, customer),
    tools,
    stopWhen: [isStepCount(MAX_STEPS), hasToolCall("submitVerdict")],
    // Last step must produce a verdict so the panel never ends empty.
    prepareStep: ({ stepNumber }) =>
      stepNumber >= MAX_STEPS - 1 ? { toolChoice: { type: "tool", toolName: "submitVerdict" } } : {},
  });
}
