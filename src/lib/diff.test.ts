import { describe, expect, it } from "vitest";
import { diffSource, diffTokens, tokenize } from "./diff";

describe("tokenize", () => {
  it("keeps multi-char operators as single tokens", () => {
    const tokens = tokenize("if (a >= 1000) return 5;");
    expect(tokens).toContain(">=");
    expect(tokens).not.toContain(">");
    expect(tokens.filter((t) => t === "=")).toHaveLength(0);
    expect(tokens).toEqual([
      "if", " ", "(", "a", " ", ">=", " ", "1000", ")", " ", "return", " ", "5", ";",
    ]);
  });

  it("handles === and !== without splitting", () => {
    const tokens = tokenize("x === 1 && y !== 2");
    expect(tokens).toContain("===");
    expect(tokens).toContain("!==");
    expect(tokens).toContain("&&");
  });

  it("returns an empty list for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("diffTokens", () => {
  it("marks a single token change as del+add, with context", () => {
    const parts = diffTokens(["a", " ", ">=", " ", "b"], ["a", " ", ">", " ", "b"]);
    expect(parts).toEqual([
      { kind: "same", text: "a " },
      { kind: "del", text: ">=" },
      { kind: "add", text: ">" },
      { kind: "same", text: " b" },
    ]);
  });

  it("returns a single same-run for identical sequences", () => {
    expect(diffTokens(["x", " ", "y"], ["x", " ", "y"])).toEqual([
      { kind: "same", text: "x y" },
    ]);
  });
});

describe("diffSource", () => {
  it("localizes the exact operator flip between original and mutant", () => {
    const original = "function f(a) {\n  if (a < 1000) return 0;\n  return 1;\n}";
    const mutant = "function f(a) {\n  if (a <= 1000) return 0;\n  return 1;\n}";
    const parts = diffSource(original, mutant);
    expect(parts.some((p) => p.kind === "del" && p.text.includes("<"))).toBe(true);
    expect(parts.some((p) => p.kind === "add" && p.text.includes("<="))).toBe(true);
    expect(parts.filter((p) => p.kind !== "same")).toHaveLength(2);
  });

  it("produces only same-parts when sources are equal", () => {
    const src = "function f() { return 42; }";
    expect(diffSource(src, src).every((p) => p.kind === "same")).toBe(true);
  });
});
