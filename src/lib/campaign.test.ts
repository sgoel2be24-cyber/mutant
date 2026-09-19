import { describe, expect, it } from "vitest";
import { mutate } from "./mutate";
import { summarize, type MutantResult } from "./runner";
import { EXAMPLES } from "./samples";

/**
 * End-to-end semantics check (the pivot-checkpoint): the real engine, the real
 * evaluation semantics (fresh scope per test, truthy = pass), the real scoring.
 * These numbers are the demo narrative — if the seed suite accidentally kills
 * everything or the strong suite leaves survivors, the story breaks and this
 * test fails before a judge ever sees it.
 */

function runSuite(code: string, tests: readonly string[]): { name: string; passed: boolean }[] {
  const outcomes: { name: string; passed: boolean }[] = [];
  for (const test of tests) {
    try {
      const v = new Function(
        "\"use strict\";\n" + code + "\n;return (" + test + ");",
      )();
      outcomes.push({ name: test, passed: Boolean(v) });
    } catch {
      outcomes.push({ name: test, passed: false });
    }
  }
  return outcomes;
}

function scoreWith(tests: readonly string[], mutants: ReturnType<typeof mutate>): number {
  const results: MutantResult[] = mutants.map((m) => {
    const outcomes = runSuite(m.code, tests);
    return {
      mutantId: m.id,
      status: outcomes.every((o) => o.passed) ? ("survived" as const) : ("killed" as const),
      durationMs: 0,
    };
  });
  return summarize(results).score;
}

describe("curated examples produce the demo narrative", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.id}: seed suite passes on the original (gate)`, () => {
      const outcomes = runSuite(ex.code, ex.seedTests);
      const failed = outcomes.filter((o) => !o.passed);
      expect(failed, `seed tests failing on original: ${failed.map((f) => f.name).join("; ")}`).toEqual([]);
    });

    it(`${ex.id}: strong suite passes on the original (gate)`, () => {
      const outcomes = runSuite(ex.code, ex.strongTests);
      const failed = outcomes.filter((o) => !o.passed);
      expect(failed, `strong tests failing on original: ${failed.map((f) => f.name).join("; ")}`).toEqual([]);
    });

    it(`${ex.id}: seed suite is weak (score < 0.6), strong suite is strong (>= 0.85)`, () => {
      const mutants = mutate(ex.code, { seed: 1 });
      expect(mutants.length).toBeGreaterThan(3);
      const weak = scoreWith(ex.seedTests, mutants);
      const strong = scoreWith(ex.strongTests, mutants);
      expect(weak, `seed suite too strong already: ${weak}`).toBeLessThan(0.6);
      expect(strong, `strong suite leaves too many survivors: ${strong}`).toBeGreaterThanOrEqual(0.85);
      expect(strong).toBeGreaterThan(weak);
    });
  }
});
