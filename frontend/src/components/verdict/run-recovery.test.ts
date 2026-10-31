import { describe, expect, test } from "vitest";

import { ApiRequestError } from "@/api";

import { serverMayStillRun } from "./run-recovery";

describe("serverMayStillRun", () => {
  test.each([
    [
      "409 already running → keep waiting",
      new ApiRequestError(409, { code: "conflict", message: "running" }),
      true,
    ],
    [
      "network drop (fetch TypeError) → keep waiting",
      new TypeError("network error"),
      true,
    ],
    [
      "502 llm unavailable → real failure",
      new ApiRequestError(502, { code: "llm_unavailable", message: "x" }),
      false,
    ],
    [
      "404 → real failure",
      new ApiRequestError(404, { code: "not_found", message: "x" }),
      false,
    ],
    ["plain Error → real failure", new Error("boom"), false],
  ])("%s", (_name, error, want) => {
    expect(serverMayStillRun(error)).toBe(want);
  });
});
