/**
 * Client side of the sandbox. Runs a code+tests suite against the ORIGINAL
 * code (validation gate) and then against every mutant, using one disposable
 * Web Worker per run with a hard timeout. Timeout terminates the worker and
 * counts as a KILL (Stryker semantics).
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
      worker.terminate();
      resolve(suiteRun);
    };
    const timer = setTimeout(() => {
      // Timeout: every test is marked failed (the suite distinguished the
      // mutant by hanging). Caller interprets all-fail as killed-by-timeout.
      finish({
        code,
        tests,
        allPassed: false,
        outcomes: tests.map((t) => ({
          name: t.length >  outcome_name_max ? t.slice(0, outcome_name_max - 3) + "..." : t,
          passed: false,
          error: "timeout",
        })),
      });
    }, timeoutMs);
    worker.addEventListener("message", (event: MessageEvent) => {
      clearTimeout(timer);
      const res = decodeResponse(JSON.stringify(event.data));
      if (res.kind === "result" && res.suiteRun) finish(res.suiteRun);
      else if (res.kind === "error") {
        // Syntax/eval error in sandbox: tests cannot pass, counts as killed.
        finish({
          code,
          tests,
          allPassed: false,
          outcomes: tests.map((t) => ({ name: t, passed: false, error: res.message })),
        });
      }
    });
    const req: WorkerRequest = { kind: "run", runId, code, tests: [...tests] };
    worker.postMessage(req);
  });
}

const outcome_name_max = 80;

/**
 * Full mutation run: validation gate on the original code, then every mutant.
 * Tests that fail on the ORIGINAL are reported back — the UI refuses to score
 * them, because a test that fails before any mutation is broken, not useful.
 */
export async function runMutationCampaign(
  originalCode: string,
  tests: readonly string[],
  mutants: readonly { id: string; code: string }[],
  config: RunConfig = {},
): Promise<{
  gate: SuiteRun;
  results: readonly MutantResult[];
}> {
  const timeoutMs = config.perRunTimeoutMs ?? 2500;
  let counter = 0;

  const gate = await runOnce(originalCode, tests, counter++, timeoutMs);

  const results: MutantResult[] = [];
  for (const mutant of mutants) {
    const run = await runOnce(mutant.code, tests, counter++, timeoutMs);
    const killer = run.outcomes.find((o) => !o.passed);
    const timedOut = run.outcomes.some((o) => o.error === "timeout");
    const status: "killed" | "survived" | "timeout" = timedOut
      ? "timeout"
      : run.allPassed
        ? "survived"
        : "killed";
    const killedBy =
      status === "survived" || killer === undefined ? undefined : killer.name;
    results.push({ mutantId: mutant.id, status, killedBy, durationMs: 0 });
    config.onProgress?.(results.length, mutants.length);
  }

  return { gate, results };
}
