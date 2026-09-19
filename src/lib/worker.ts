/// <reference lib="webworker" />
import { stripTypes } from "./stripTypes";
/**
 * Disposable sandbox worker. Receives one request per mutant (or the original
 * code, for the validation gate), evaluates code + tests inside a fresh
 * function scope, and posts per-test outcomes back to the page.
 *
 * A Web Worker is same-origin, has no DOM access, and is the standard
 * browser-side isolation boundary for running untrusted code from a
 * code-editor app. The parent enforces per-mutant timeouts by terminating this
 * worker, so an infinite-loop mutant cannot freeze the page.
 */

type TestOutcome = {
  name: string;
  passed: boolean;
  error?: string | undefined;
  syntaxError?: boolean | undefined;
};

interface RunRequest {
  kind: "run";
  runId: number;
  code: string;
  tests: string[];
}

declare const self: DedicatedWorkerGlobalScope;

/**
 * Each test runs in its OWN fresh scope: the user code is re-evaluated per
 * test, so a test that throws (or a mutant that corrupts state) cannot leak
 * into the next test's outcome. Slower, but correct — and correctness of the
 * kill/survive verdict is the entire product.
 */
function runSuite(code: string, tests: string[]): TestOutcome[] {
  // TypeScript is stripped to runtime JS before evaluation — `new Function`
  // only understands JS, and the engine now accepts typed input.
  let js = code;
  try {
    js = stripTypes(code);
  } catch (e) {
    return tests.map((t) => ({
      name: t.length > 80 ? t.slice(0, 77) + "..." : t,
      passed: false,
      error: e instanceof Error ? e.message : String(e),
      syntaxError: true,
    }));
  }
  const outcomes: TestOutcome[] = [];
  for (const test of tests) {
    const name = test.length > 80 ? test.slice(0, 77) + "..." : test;
    let fn: () => unknown;
    try {
      // Constructing the function is where a syntax error in the code or in the
      // test expression surfaces. That is NOT an assertion failure — the mutant
      // is unparseable, or the test is malformed, and neither is evidence about
      // the suite. Flag it so the caller can exclude it from scoring.
      fn = new Function(
        "\"use strict\";\n" +
          js +
          "\n;const result = (" + test + ");\n" +
          "return result;",
      ) as () => unknown;
    } catch (e) {
      outcomes.push({
        name,
        passed: false,
        error: e instanceof Error ? e.message : String(e),
        syntaxError: true,
      });
      continue;
    }
    try {
      // Invoking it is where a runtime failure (assertion, throw, TypeError)
      // surfaces: a genuine kill.
      if (fn()) {
        outcomes.push({ name, passed: true });
      } else {
        outcomes.push({ name, passed: false, error: "expression was falsy" });
      }
    } catch (e) {
      outcomes.push({ name, passed: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return outcomes;
}

self.addEventListener("message", (event: MessageEvent<RunRequest>) => {
  const { kind, runId, code, tests } = event.data;
  if (kind !== "run") return;
  try {
    const outcomes = runSuite(code, tests);
    self.postMessage({
      kind: "result",
      runId,
      suiteRun: { code, tests, outcomes, allPassed: outcomes.every((o) => o.passed) },
    });
  } catch (e) {
    self.postMessage({
      kind: "error",
      runId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
});

export {};
