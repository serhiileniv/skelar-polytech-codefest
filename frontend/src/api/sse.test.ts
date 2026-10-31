import { describe, expect, it } from "vitest";
import { createSseParser, readSse } from "./sse";
import type { InvestigateEvent } from "./types";

const collect = () => {
  const events: InvestigateEvent[] = [];
  return { events, parser: createSseParser((e) => events.push(e)) };
};

const ev = (name: string, data: unknown) =>
  `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

describe("createSseParser", () => {
  it("emits one event when it is split across chunks mid-event and mid-line", () => {
    const { events, parser } = collect();
    const raw = ev("step", { n: 1 });

    parser.push(raw.slice(0, 5));
    parser.push(raw.slice(5, 22));
    expect(events).toHaveLength(0);
    parser.push(raw.slice(22));

    expect(events).toEqual([{ event: "step", data: { n: 1 } }]);
  });

  it("parses CRLF line endings", () => {
    const { events, parser } = collect();

    parser.push('event: text\r\ndata: {"delta":"hi"}\r\n\r\n');

    expect(events).toEqual([{ event: "text", data: { delta: "hi" } }]);
  });

  it("skips unknown event names", () => {
    const { events, parser } = collect();

    parser.push(ev("mystery", { a: 1 }) + ev("step", { n: 2 }));

    expect(events).toEqual([{ event: "step", data: { n: 2 } }]);
  });

  it("skips bad JSON but still delivers later events", () => {
    const { events, parser } = collect();

    parser.push("event: step\ndata: {not json\n\n" + ev("done", {}));

    expect(events).toEqual([{ event: "done", data: {} }]);
  });

  it("joins multi-line data with newlines before parsing", () => {
    const { events, parser } = collect();

    parser.push('event: text\ndata: {"delta":\ndata: "a b"}\n\n');

    expect(events).toEqual([{ event: "text", data: { delta: "a b" } }]);
  });
});

describe("readSse", () => {
  it("flushes the last event when the stream has no trailing blank line", async () => {
    const enc = new TextEncoder();
    const chunks = [ev("step", { n: 1 }), "event: done\ndata: {}\n"];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((s) => c.enqueue(enc.encode(s)));
        c.close();
      },
    });
    const events: InvestigateEvent[] = [];

    await readSse(body, (e) => events.push(e));

    expect(events.map((e) => e.event)).toEqual(["step", "done"]);
  });
});
