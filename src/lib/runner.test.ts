import { describe, expect, it } from "vitest";
import {
  decodeResponse,
  encodeRequest,
  summarize,
  selectScoredTests,
  type MutantResult,
} from "./runner";

describe("summarize (Stryker-style scoring)", () => {
  it("counts killed + timeout as kills; survivors dilute the score", () => {
    const results: MutantResult[] = [
      { mutantId: "M001", status: "killed", killedBy: "t1", durationMs: 1 },
      { mutantId: "M002", status: "timeout", durationMs: 2500 },
      { mutantId: "M003", status: "survived", durationMs: 1 },
      { mutantId: "M004", status: "killed", killedBy: "t2", durationMs: 1 },
      { mutantId: "M005", status: "survived", durationMs: 1 },
      { mutantId: "M006", status: "survived", durationMs: 1 },
    ];
    expect(summarize(results)).toEqual({
      total: 6,
      killed: 2,
      survived: 3,
      timeout: 1,
      invalid: 0,
      // (2 killed + 1 timeout) / 6 = 50%
      score: 0.5,
    });
  });

  it("reports 0, not NaN, on an empty run", () => {
    expect(summarize([])).toEqual({
      total: 0,
      killed: 0,
      survived: 0,
      timeout: 0,
      invalid: 0,
      score: 0,
    });
  });

  it("EXCLUDES unparseable mutants from the score instead of counting them as kills", () => {
    // Audit finding: an invalid mutant used to raise the score. It must not
    // appear in either the numerator or the denominator.
    const withInvalid: MutantResult[] = [
      { mutantId: "M001", status: "killed", killedBy: "t", durationMs: 0 },
      { mutantId: "M002", status: "invalid", durationMs: 0 },
      { mutantId: "M003", status: "survived", durationMs: 0 },
    ];
    const s = summarize(withInvalid);
    expect(s.invalid).toBe(1);
    expect(s.total).toBe(2); // M002 not counted
    expect(s.killed).toBe(1);
    expect(s.score).toBe(0.5); // 1/2, NOT 2/3
  });

  it("a perfect suite scores 1", () => {
    const results: MutantResult[] = [
      { mutantId: "M001", status: "killed", killedBy: "t1", durationMs: 1 },
      { mutantId: "M002", status: "timeout", durationMs: 2500 },
    ];
    expect(summarize(results).score).toBe(1);
  });
});

describe("worker protocol", () => {
  it("round-trips a run request", () => {
    const req = { kind: "run" as const, runId: 3, code: "function f(){}", tests: ["f() === 1"] };
    expect(decodeResponse(JSON.stringify({ kind: "result", runId: 3, suiteRun: { code: "function f(){}", tests: ["f() === 1"], outcomes: [], allPassed: true } }))).toBeTruthy();
    expect(encodeRequest(req)).toBe(JSON.stringify(req));
  });

  it("rejects malformed responses instead of trusting them", () => {
    expect(() => decodeResponse("{}")).toThrow();
    expect(() => decodeResponse(JSON.stringify({ kind: "nope", runId: 1 }))).toThrow();
    expect(() => decodeResponse(JSON.stringify({ kind: "result" }))).toThrow();
  });
});

describe("selectScoredTests (gate enforcement)", () => {
  it("regression: two long tests sharing an 80-char prefix do not collide", () => {
    const prefix = "calculateGst(1000, 'standard', 'intra-state', true, false, 'retail', 'FY26') === 1180 ";
    const good = prefix + "&& true";
    const bad = prefix + "&& false";
    const trunc = (t: string) => t.slice(0, 77) + "...";
    expect(trunc(good)).toBe(trunc(bad));
    const kept = selectScoredTests([good, bad], [
      { name: trunc(good), passed: true },
      { name: trunc(bad), passed: false },
    ]);
    expect(kept).toEqual([good]);
  });
});
