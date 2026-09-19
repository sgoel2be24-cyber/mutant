/// <reference lib="webworker" />
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

type TestOutcome = { name: string; passed: boolean; error?: string | undefined };

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
  const outcomes: TestOutcome[] = [];
  for (const test of tests) {
    const name = test.length > 80 ? test.slice(0, 77) + "..." : test;
    try {
      // The test expression is evaluated with `result` bound to the value of
      // the test expression itself; truthy = pass, falsy or throw = fail.
      const fn = new Function(
        "\"use strict\";\n" +
          code +
          "\n;const result = (" + test + ");\n" +
          "return result;",
      )();
      if (fn) {
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
