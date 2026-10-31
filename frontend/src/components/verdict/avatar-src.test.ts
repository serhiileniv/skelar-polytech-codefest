import { describe, expect, it } from "vitest";

import { avatarSrc, initials } from "./avatar-src";

describe("avatarSrc", () => {
  it.each([
    [{ id: "cust_007", name: "Marcus Webb" }, "/avatars/cust_007.jpg"],
    [{ name: "Sofia Rossi" }, "/avatars/cust_003.jpg"],
    [{ id: "cust_001", name: "Renamed" }, "/avatars/cust_001.jpg"],
    [{ id: "cust_099", name: "Emma Carter" }, "/avatars/cust_001.jpg"],
    [{ id: "cust_099", name: "Stranger" }, null],
    [{ name: "" }, null],
  ])("%o -> %s", (person, want) => {
    expect(avatarSrc(person)).toBe(want);
  });
});

describe("initials", () => {
  it.each([
    ["Marcus Webb", "MW"],
    ["Ava Maria Lindqvist", "AL"],
    ["cher", "C"],
    ["  ", "?"],
  ])("%s -> %s", (name, want) => {
    expect(initials(name)).toBe(want);
  });
});
