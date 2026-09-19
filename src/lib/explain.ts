import type { Mutant } from "./mutate";

/**
 * Turn "this mutant survived" into a one-line reason a judge (or a developer)
 * can act on. The insight is computed from data we already have — the operator
 * and the diff — not from another model call, so it is instant, offline, and
 * cannot hallucinate a cause the run did not observe.
 *
 * The pattern is always the same shape: the suite never exercises the code path
 * this mutation affects, so the change is invisible to every test.
 */
export function explainSurvival(mutant: Mutant, _originalCode: string): string {
  switch (mutant.operator) {
    case "flip-operator": {
      const boundary = /^\d+(?:\.\d+)?$/.test(mutant.replacementText)
        ? ` around the value ${mutant.replacementText}`
        : "";
      return (
        `Your tests never exercise the comparison boundary${boundary}, so ` +
        `flipping \`${mutant.originalText.trim()}\` to \`${mutant.replacementText.trim()}\` changes nothing they check.`
      );
    }
    case "wipe-number":
      return (
        `No test distinguishes the constant \`${mutant.originalText.trim()}\` ` +
        `from \`${mutant.replacementText.trim()}\` — add a probe at that value.`
      );
    case "wipe-string":
      return (
        `No test checks the exact string returned here, so emptying it is invisible.`
      );
    case "flip-boolean":
      return (
        `No test's outcome depends on this flag being \`${mutant.originalText.trim()}\`, ` +
        `so flipping it changes nothing observable.`
      );
    case "drop-guard":
      return (
        `This guard always passes in every test you run, so your suite cannot ` +
        `tell it was removed.`
      );
    case "drop-condition":
      return (
        `The true branch and the guard are never separated by a test, so forcing ` +
        `the condition true is undetectable to your suite.`
      );
    case "drop-negation":
      return (
        `No test covers the case this negation handles, so dropping \`!\` is invisible.`
      );
    case "drop-return-value":
      return (
        `No test reads this return value on the path this mutation affects, so ` +
        `returning nothing goes unnoticed.`
      );
    case "flip-update":
      return (
        `Your tests never isolate this counter's direction, so \`++\` vs \`--\` ` +
        `makes no observable difference.`
      );
    default:
      return `This change is on a code path your tests never reach.`;
  }
}

export function explainSurvivors(
  mutants: readonly Mutant[],
  results: readonly { mutantId: string; status: string }[],
  originalCode: string,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const statusById = new Map(results.map((r) => [r.mutantId, r.status]));
  for (const m of mutants) {
    if (statusById.get(m.id) === "survived") {
      out.set(m.id, explainSurvival(m, originalCode));
    }
  }
  return out;
}
