/**
 * Sandboxed mutant runner — the second half of the engine.
 *
 * A mutation run is: for each mutant, run the user's test suite against the
 * mutated function and record whether any test FAILED (mutant killed) or all
 * passed (mutant survived). Timeouts and throws inside the sandbox count as a
 * KILL — Stryker semantics — because a test suite that hangs or explodes on
 * changed behavior is still distinguishing mutant from original.
 *
 * This module defines the pure scoring/protocol layer. Execution happens in a
 * disposable Web Worker (see worker.ts and the App wiring) so an infinite-loop
 * mutant can never freeze the page: the worker is terminated and the mutant is
 * marked killed-by-timeout.
 */

export type MutantStatus = "killed" | "survived" | "timeout" | "invalid";

export interface MutantResult {
  readonly mutantId: string;
  readonly status: MutantStatus;
  /** Test name that killed the mutant, when known. */
  readonly killedBy?: string | undefined;
  /** Wall-clock ms the suite took against this mutant. */
  readonly durationMs: number;
}

export interface TestOutcome {
  readonly name: string;
  readonly passed: boolean;
  readonly error?: string | undefined;
  /**
   * True when the failure came from parsing/evaluating the code or expression
   * itself (a SyntaxError), not from an assertion failing. An unparseable
   * mutant must never be scored as a kill — it says nothing about the tests.
   */
  readonly syntaxError?: boolean | undefined;
}

export interface SuiteRun {
  readonly code: string;
  readonly tests: readonly string[];
  readonly outcomes: readonly TestOutcome[];
  readonly allPassed: boolean;
}

export interface ScoreSummary {
  readonly total: number;
  readonly killed: number;
  readonly survived: number;
  readonly timeout: number;
  /** Mutants excluded from the denominator because they could not be parsed. */
  readonly invalid: number;
  /** Stryker-style mutation score: (killed + timeout) / total. */
  readonly score: number;
}

/**
 * Combine per-mutant results into the headline number.
 * Timeout counts as killed (Stryker semantics): a suite that hangs on the
 * mutant distinguished it from the original.
 */
export function summarize(results: readonly MutantResult[]): ScoreSummary {
  // `invalid` mutants are excluded from both numerator and denominator: a
  // mutant that could not be parsed is not evidence about the test suite, and
  // counting it as killed would inflate the score.
  const scored = results.filter((r) => r.status !== "invalid");
  const total = scored.length;
  const killed = scored.filter((r) => r.status === "killed").length;
  const timeout = scored.filter((r) => r.status === "timeout").length;
  const survived = scored.filter((r) => r.status === "survived").length;
  const invalid = results.length - total;
  return {
    total,
    killed,
    survived,
    timeout,
    invalid,
    score: total === 0 ? 0 : (killed + timeout) / total,
  };
}

/**
 * Protocol for the worker: run a suite of `assert(expr)` / assert.equal calls
 * against a piece of code. Tests are expressions that must evaluate truthy OR
 * throw-free equal-checks; any throw marks that test failed.
 */
export interface WorkerRequest {
  readonly kind: "run";
  readonly runId: number;
  readonly code: string;
  readonly tests: readonly string[];
}

export interface WorkerResponse {
  readonly kind: "result" | "error";
  readonly runId: number;
  readonly suiteRun?: SuiteRun;
  readonly message?: string;
}

export function encodeRequest(req: WorkerRequest): string {
  return JSON.stringify(req);
}

export function decodeResponse(raw: string): WorkerResponse {
  const v: unknown = JSON.parse(raw);
  if (typeof v !== "object" || v === null) throw new Error("bad worker response");
  const rec = v as Record<string, unknown>;
  if (rec["kind"] !== "result" && rec["kind"] !== "error") {
    throw new Error("bad worker response kind");
  }
  if (typeof rec["runId"] !== "number") throw new Error("bad worker runId");
  return v as WorkerResponse;
}

/**
 * Enforce the gate: keep exactly the tests that passed on the original code.
 * Matched by POSITION, not by display name — names are truncated to 80 chars,
 * so two long tests sharing a prefix would otherwise collide and a test that
 * fails on the original could slip into scoring and "kill" every mutant.
 */
export function selectScoredTests(
  tests: readonly string[],
  gateOutcomes: readonly TestOutcome[],
): string[] {
  return tests.filter((_, i) => gateOutcomes[i]?.passed === true);
}
