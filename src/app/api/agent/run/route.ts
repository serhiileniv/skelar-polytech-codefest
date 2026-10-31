import { anthropic } from "@ai-sdk/anthropic";
import { createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream } from "ai";
import { z } from "zod";
import { INSTRUCTIONS, ticketPrompt } from "@/lib/agent/prompt";
import { getDb } from "@/lib/domain/store";
import { createTools } from "@/lib/tools/tools";

export const maxDuration = 120;

const bodySchema = z.object({ ticketId: z.string().min(1).max(64) });

export async function POST(req: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "ticketId required" }, { status: 400 });

  const db = getDb();
  const ticket = db.tickets.find((t) => t.id === parsed.data.ticketId);
  if (!ticket) return Response.json({ error: "ticket not found" }, { status: 404 });
  const customer = db.customers.find((c) => c.id === ticket.customerId);

  const result = streamText({
    model: anthropic(process.env.CLOSER_MODEL ?? "claude-sonnet-5-5"),
    instructions: INSTRUCTIONS,
    prompt: ticketPrompt(ticket, customer),
    tools: createTools(db, ticket),
    stopWhen: isStepCount(16),
  });

  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
}
