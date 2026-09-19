/**
 * Client side of the sandbox. Runs a code+tests suite against the ORIGINAL code
 * (the validation gate) and then against every mutant, using one disposable Web
 * Worker per run with a hard timeout. Timeout terminates the worker and counts
 * as a KILL (Stryker semantics).
 *
 * THE GATE IS ENFORCED, NOT MERELY REPORTED: tests that fail on the original
 * code are dropped from the scoring run entirely. A test that fails before any
 * mutation is broken, and scoring it would attribute a "kill" to a test that
 * proves nothing. `gateFailures` is returned so the UI can say what was removed.
 */

import MutantWorker from "./worker.ts?worker";
import {
  decodeResponse,
  type MutantResult,
  type SuiteRun,
  type WorkerRequest,
} from "./runner";

export interface RunConfig {
  readonly perRunTimeoutMs?: number;
  readonly onProgress?: (done: number, total: number) => void;
}

function truncateName(t: string, max: number): string {
  return t.length > max ? t.slice(0, max - 3) + "..." : t;
}

/** Run the suite against one piece of code, with a hard timeout. */
function runOnce(
  code: string,
  tests: readonly string[],
  runId: number,
  timeoutMs: number,
): Promise<SuiteRun> {
  return new Promise((resolve) => {
    const worker = new MutantWorker();
    let settled = false;
    const finish = (suiteRun: SuiteRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(suiteRun);
    };
    const timer = setTimeout(() => {
      // Timeout: every test is marked failed (the suite distinguished the
      // mutant by hanging). The caller maps this to the `timeout` status.
      finish({
        code,
        tests,
        allPassed: false,
        outcomes: tests.map((t) => ({
          name: truncateName(t, 80),
          passed: false,
          error: "timeout",
        })),
      });
    }, timeoutMs);
    worker.addEventListener("message", (event: MessageEvent) => {
      const res = decodeResponse(JSON.stringify(event.data));
      if (res.kind === "result" && res.suiteRun) finish(res.suiteRun);
      else if (res.kind === "error") {
        finish({
          code,
          tests,
          allPassed: false,
          outcomes: tests.map((t) => ({
            name: truncateName(t, 80),
            passed: false,
            error: res.message,
            syntaxError: true,
          })),
        });
      }
    });
    const req: WorkerRequest = { kind: "run", runId, code, tests: [...tests] };
    worker.postMessage(req);
  });
}

export interface CampaignResult {
  /** The gate run against the original code, with every supplied test. */
  readonly gate: SuiteRun;
  /** Tests that failed on the original code and were removed from scoring. */
  readonly gateFailures: readonly string[];
  /** The tests actually used to score mutants. */
  readonly scoredTests: readonly string[];
  readonly results: readonly MutantResult[];
  readonly durationMs: number;
}

/**
 * Full mutation run: gate on the original code, then every mutant against the
 * surviving tests only.
 */
export async function runMutationCampaign(
  originalCode: string,
  tests: readonly string[],
  mutants: readonly { id: string; code: string }[],
  config: RunConfig = {},
): Promise<CampaignResult> {
  const timeoutMs = config.perRunTimeoutMs ?? 2500;
  const started = performance.now();
  let counter = 0;

  const gate = await runOnce(originalCode, tests, counter++, timeoutMs);
  const gateFailures = gate.outcomes.filter((o) => !o.passed).map((o) => o.name);
  const passingSet = new Set(
    gate.outcomes.filter((o) => o.passed).map((o) => o.name),
  );
  const scoredTests = tests.filter((t) => passingSet.has(truncateName(t, 80)));

  const results: MutantResult[] = [];
  for (const mutant of mutants) {
    const run = await runOnce(mutant.code, scoredTests, counter++, timeoutMs);
    const killer = run.outcomes.find((o) => !o.passed);
    // An unparseable mutant/expression is not a kill; it is excluded entirely.
    const invalid = run.outcomes.some((o) => o.syntaxError === true);
    const timedOut = run.outcomes.some((o) => o.error === "timeout");
    const status: MutantResult["status"] = invalid
      ? "invalid"
      : timedOut
        ? "timeout"
        : run.allPassed
          ? "survived"
          : "killed";
    const killedBy =
      status === "survived" || status === "invalid" || killer === undefined
        ? undefined
        : killer.name;
    results.push({ mutantId: mutant.id, status, killedBy, durationMs: 0 });
    config.onProgress?.(results.length, mutants.length);
  }

  return {
    gate,
    gateFailures,
    scoredTests,
    results,
    durationMs: performance.now() - started,
  };
}
