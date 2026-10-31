import { anthropic } from "@ai-sdk/anthropic";
import { createUIMessageStreamResponse, toUIMessageStream } from "ai";
import { z } from "zod";
import { recordTo, replayInvestigation, shouldReplay } from "@/lib/agent/replay";
import { runInvestigation } from "@/lib/agent/run";
import { getDb } from "@/lib/domain/store";

export const maxDuration = 120;

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const parsed = idSchema.safeParse((await ctx.params).id);
  if (!parsed.success) return Response.json({ error: "Invalid case id" }, { status: 400 });
  const caseId = parsed.data;

  const db = getDb();
  if (!db.cases.some((c) => c.id === caseId)) return Response.json({ error: "Case not found" }, { status: 404 });

  if (shouldReplay(caseId)) {
    return createUIMessageStreamResponse({ stream: replayInvestigation(db, caseId), headers: { "x-replay": "1" } });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "No ANTHROPIC_API_KEY and no recording for this case" }, { status: 503 });
  }

  const modelId = process.env.VERDICT_MODEL ?? "claude-sonnet-5-5";
  const result = runInvestigation(db, caseId, anthropic(modelId));
  const stream = toUIMessageStream({ stream: result.stream }).pipeThrough(recordTo(caseId, modelId));
  return createUIMessageStreamResponse({ stream });
}
