import { describe, expect, it } from "vitest";

import { ApiRequestError } from "../errors";
import { createMockClient } from "./client";

const fresh = () => createMockClient({ delayMs: 0 });

const investigated = async (id: string) => {
  const client = fresh();
  await client.investigate(id, () => undefined);
  return client;
};

const statusOf = async (p: Promise<unknown>): Promise<number | null> => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ApiRequestError ? e.status : -1;
  }
};

describe("mock client ask", () => {
  it("returns 409 before the case has a verdict", async () => {
    expect(await statusOf(fresh().ask("case_104", "Why this outcome?"))).toBe(
      409,
    );
  });

  it.each([
    ["empty", "   "],
    ["over 500 chars", "x".repeat(501)],
  ])("returns 400 for an %s question", async (_, question) => {
    const client = await investigated("case_104");
    expect(await statusOf(client.ask("case_104", question))).toBe(400);
  });

  it("returns 404 for an unknown case", async () => {
    expect(await statusOf(fresh().ask("case_999", "Why?"))).toBe(404);
  });

  it.each([
    ["case_104", "Why this outcome?", /Tech team/, "err_0002"],
    ["case_103", "What evidence?", /3 records/, "pay_0003"],
    ["case_105", "What if I refund?", /exactly what I propose/, "pay_"],
    ["case_103", "What if I refund?", /does not fix/, "err_0001"],
    ["case_107", "What if I refund?", /S1/, ""],
  ])(
    "%s · %s answers from the verdict",
    async (id, question, answer, cited) => {
      const client = await investigated(id);
      const verdict = (await client.getCase(id)).case.verdict;

      const res = await client.ask(id, question);

      expect(res.answer).toMatch(answer);
      const known = new Set(verdict?.evidence.map((e) => e.id));
      expect(res.evidence.every((e) => known.has(e))).toBe(true);
      if (cited)
        expect(res.evidence.some((e) => e.startsWith(cited))).toBe(true);
    },
  );
});
