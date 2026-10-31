import type { InvestigateEvent, InvestigateEventName } from "./types";

const EVENT_NAMES: readonly InvestigateEventName[] = [
  "start",
  "step",
  "text",
  "tool_call",
  "tool_result",
  "verdict",
  "error",
  "done",
];

const isEventName = (name: string): name is InvestigateEventName =>
  (EVENT_NAMES as readonly string[]).includes(name);

/**
 * Incremental SSE parser: feed text chunks as they arrive, get one callback per complete event.
 * Unknown event names and non-JSON data are skipped, so a newer backend cannot crash the UI.
 */
export function createSseParser(onEvent: (e: InvestigateEvent) => void): {
  push: (chunk: string) => void;
} {
  let buffer = "";

  const emit = (block: string) => {
    let name = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:"))
        data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!isEventName(name) || data.length === 0) return;
    try {
      onEvent({
        event: name,
        data: JSON.parse(data.join("\n")),
      } as InvestigateEvent);
    } catch {
      // Malformed JSON: drop this event, keep the stream going.
    }
  };

  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n?/g, "\n");
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        emit(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\n\n");
      }
    },
  };
}

/** Reads a `text/event-stream` body to the end. */
export async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: InvestigateEvent) => void,
): Promise<void> {
  const parser = createSseParser(onEvent);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(`${decoder.decode()}\n\n`);
}
