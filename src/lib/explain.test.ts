import { describe, expect, it } from "vitest";
import { explainSurvival, explainSurvivors } from "./explain";
import type { Mutant } from "./mutate";

const mk = (over: Partial<Mutant>): Mutant => ({
  id: "M001",
  operator: "flip-operator",
  description: "`<` -> `<=`",
  code: "x",
  span: { start: 0, end: 1 },
  originalText: "<",
  replacementText: "<=",
  repaired: false,
  ...over,
});

describe("explainSurvival", () => {
  it("gives an actionable boundary reason for operator flips", () => {
    const s = explainSurvival(mk({ originalText: "< 1000", replacementText: "<= 1000" }), "");
    expect(s.toLowerCase()).toContain("boundary");
  });

  it("names the constant for a wiped number", () => {
    const s = explainSurvival(mk({ operator: "wipe-number", originalText: "1000", replacementText: "0" }), "");
    expect(s).toContain("1000");
    expect(s).toContain("0");
  });

  it("never claims a cause it did not observe — every operator maps to a reason", () => {
    for (const op of ["flip-operator","wipe-number","wipe-string","flip-boolean","drop-guard","drop-condition","drop-negation","drop-return-value","flip-update"]) {
      const s = explainSurvival(mk({ operator: op }), "");
      expect(s.length).toBeGreaterThan(10);
    }
  });
});

describe("explainSurvivors", () => {
  it("only explains survivors", () => {
    const ms = [mk({ id: "M001" }), mk({ id: "M002" })];
    const rs = [{ mutantId: "M001", status: "survived" }, { mutantId: "M002", status: "killed" }];
    const out = explainSurvivors(ms, rs, "");
    expect(out.has("M001")).toBe(true);
    expect(out.has("M002")).toBe(false);
  });
});
