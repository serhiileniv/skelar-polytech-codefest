import { createUIMessageStream, type UIMessageChunk } from "ai";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "../domain/types";
import { verdictSchema } from "../verdict/schema";
import { createInvestigationTools, TOOL_NAMES, type ToolName } from "./tools";

export interface Recording {
  caseId: string;
  recordedAt: string;
  model: string;
  chunks: UIMessageChunk[];
}

const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function replayPath(caseId: string): string {
  if (!SAFE_ID.test(caseId)) throw new Error(`Bad case id ${caseId}`);
  return path.join(process.cwd(), ".replay", `${caseId}.json`);
}

export function hasRecording(caseId: string): boolean {
  return existsSync(replayPath(caseId));
}

export function loadRecording(caseId: string): Recording {
  return JSON.parse(readFileSync(replayPath(caseId), "utf8")) as Recording;
}

/** Replay when forced, or when there is no API key and a recording exists. */
export function shouldReplay(caseId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!hasRecording(caseId)) return false;
  return env.VERDICT_REPLAY === "1" || !env.ANTHROPIC_API_KEY;
}

/**
 * Pass-through that buffers UI chunks and writes `.replay/<caseId>.json` when the stream ends.
 * Only runs that produced a submitVerdict result are saved.
 */
export function recordTo(caseId: string, model: string): TransformStream<UIMessageChunk, UIMessageChunk> {
  const chunks: UIMessageChunk[] = [];
  return new TransformStream({
    transform(chunk, controller) {
      chunks.push(chunk);
      controller.enqueue(chunk);
    },
    flush() {
      const verdictCall = chunks.find((c) => c.type === "tool-input-available" && c.toolName === "submitVerdict");
      const done =
        verdictCall?.type === "tool-input-available" &&
        chunks.some((c) => c.type === "tool-output-available" && c.toolCallId === verdictCall.toolCallId);
      if (!done) return;
      const file = replayPath(caseId);
      mkdirSync(path.dirname(file), { recursive: true });
      const rec: Recording = { caseId, recordedAt: new Date().toISOString(), model, chunks };
      writeFileSync(file, JSON.stringify(rec, null, 1));
    },
  });
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function delayFor(c: UIMessageChunk): number {
  if (c.type === "text-delta" || c.type === "tool-input-delta") return 12;
  if (c.type === "tool-input-available") return 350;
  if (c.type === "tool-output-available") return 250;
  return 20;
}

const isToolName = (n: string): n is ToolName => (TOOL_NAMES as readonly string[]).includes(n);

/**
 * Streams a recording back and re-applies it to `db`: read tools re-run (rebuilding seenIds and audit),
 * submitVerdict re-runs validation and stores the verdict, and its output chunk carries the fresh result.
 */
export function replayInvestigation(db: Db, caseId: string, opts: { speed?: number } = {}) {
  const rec = loadRecording(caseId);
  const speed = opts.speed ?? 1;
  const { runRead, applyVerdict } = createInvestigationTools(db, caseId);

  return createUIMessageStream({
    execute: async ({ writer }) => {
      const names = new Map<string, ToolName>();
      const outputs = new Map<string, unknown>();
      let steps = 0;
      for (const chunk of rec.chunks) {
        await sleep(delayFor(chunk) * speed);
        if (chunk.type === "start-step") steps++;
        if (chunk.type === "tool-input-available" && isToolName(chunk.toolName)) {
          names.set(chunk.toolCallId, chunk.toolName);
          outputs.set(
            chunk.toolCallId,
            chunk.toolName === "submitVerdict"
              ? applyVerdict(verdictSchema.parse(chunk.input), Math.max(steps, 1))
              : runRead(chunk.toolName, chunk.input),
          );
        }
        if (chunk.type === "tool-output-available" && outputs.has(chunk.toolCallId)) {
          writer.write({ ...chunk, output: outputs.get(chunk.toolCallId) });
          continue;
        }
        writer.write(chunk);
      }
    },
  });
}
