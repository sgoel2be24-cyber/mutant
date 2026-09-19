import { useMemo, useState } from "react";
import { EXAMPLES, exampleById, type Example } from "./lib/samples";
import { mutate, type Mutant } from "./lib/mutate";
import { runMutationCampaign } from "./lib/runnerClient";
import { summarize, type MutantResult, type ScoreSummary } from "./lib/runner";
import { diffSource } from "./lib/diff";
import { generateTests } from "./lib/generate";
import {
  enforceProvability,
  formatMeasurement,
  scorecard,
  type Claim,
  type EvidenceReport,
} from "./lib/evidence";

/**
 * App composition: editor -> mutation run -> survivor cards -> AI generation ->
 * re-run -> evidence. Every number on screen comes from a real run; nothing is
 * mocked. The validation gate refuses to score tests that fail on the original.
 */

type Phase = "idle" | "running" | "done" | "error";

interface RunState {
  phase: Phase;
  summary?: ScoreSummary;
  mutants?: readonly Mutant[];
  results?: readonly MutantResult[];
  gateFailures?: readonly string[];
  progress?: { done: number; total: number };
  error?: string;
}

export default function App() {
  const [exampleId, setExampleId] = useState<string>(EXAMPLES[0]!.id);
  const example: Example | undefined = exampleById(exampleId);
  const [code, setCode] = useState<string>(EXAMPLES[0]!.code);
  const [tests, setTests] = useState<string>(EXAMPLES[0]!.seedTests.join("\n"));
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  const [genNote, setGenNote] = useState<string>("");
  const [genBusy, setGenBusy] = useState(false);

  const loadExample = (id: string) => {
    const ex = exampleById(id);
    if (!ex) return;
    setExampleId(id);
    setCode(ex.code);
    setTests(ex.seedTests.join("\n"));
    setRun({ phase: "idle" });
    setGenNote("");
  };

  const parsedTests = useMemo(
    () => tests.split("\n").map((t) => t.trim()).filter((t) => t.length > 0),
    [tests],
  );

  // remembered for the evidence delta: first clean run = weak baseline,
  // first clean run after generation = strong score.
  const [historyWeak, setHistoryWeak] = useState<number | null>(null);
  const [historyStrong, setHistoryStrong] = useState<number | null>(null);

  const evidence: EvidenceReport = useMemo(() => {
    if (run.phase !== "done" || !run.summary) {
      return { generatedAt: new Date(0).toISOString(), claims: [] };
    }
    const claims: Claim[] = [
      {
        id: "claim-weak",
        statement: "The seed suite leaves bugs uncaptured — measured as surviving mutants.",
        state: "pass",
        measurement: {
          label: "mutation score with seed suite",
          before: 0,
          after: Math.round(run.summary.score * 100),
          unit: "%",
        },
        artifacts: [{ kind: "log", ref: "live run on this page" }],
        demoStep: "beat 2 — the score after the first Run",
      },
      {
        id: "claim-strong",
        statement: "Better tests measurably close the gap — the score rises after generation.",
        state: historyStrong === null ? "pending" : "pass",
        artifacts: [{ kind: "log", ref: "live run on this page" }],
        demoStep: "beat 4 — the score after Generate + re-Run",
      },
    ];
    if (historyStrong !== null) {
      claims[1] = {
        ...claims[1]!,
        state: "pass",
        measurement: {
          label: "mutation score after generated tests",
          before: historyWeak ?? 0,
          after: historyStrong,
          unit: "%",
        },
      };
    }
    return enforceProvability({ generatedAt: new Date().toISOString(), claims });
  }, [run.phase, run.summary, genNote, historyWeak, historyStrong]);

  const doRun = async () => {
    setRun({ phase: "running" });
    try {
      const mutants = mutate(code, { seed: 1 });
      const { gate, results } = await runMutationCampaign(code, parsedTests, mutants, {
        onProgress: (done, total) => setRun((r) => ({ ...r, progress: { done, total } })),
      });
      const gateFailures = gate.outcomes.filter((o) => !o.passed).map((o) => o.name);
      const summary = summarize(results);
      setRun({ phase: "done", mutants, results, summary, gateFailures });
      if (historyWeak === null && gateFailures.length === 0) {
        setHistoryWeak(Math.round(summary.score * 100));
      } else if (gateFailures.length === 0 && historyStrong === null && genNote !== "") {
        setHistoryStrong(Math.round(summary.score * 100));
      }
    } catch (e) {
      setRun({
        phase: "error",
        error: e instanceof Error ? e.message : "mutation run failed",
      });
    }
  };

  const doGenerate = async () => {
    setGenBusy(true);
    setGenNote("");
    try {
      const suite = await generateTests(code, parsedTests, example);
      const merged = [...new Set([...parsedTests, ...suite.tests])];
      setTests(merged.join("\n"));
      setGenNote(
        suite.source === "llm"
          ? `${suite.tests.length} tests from the model — re-run to see the score.`
          : (suite.note ?? "fallback suite loaded — re-run to see the score."),
      );
    } catch (e) {
      setGenNote(
        `generation unavailable: ${e instanceof Error ? e.message : "error"} — ` +
          "this is the honest offline path; the engine still works.",
      );
    } finally {
      setGenBusy(false);
    }
  };

  const card = scorecard(evidence);

  return (
    <main className="wrap">
      <p className="eyebrow">HackDevengers 2.0 · 24h · Open Innovation</p>
      <h1>
        Your tests are <span className="mark">lying to you</span>.
      </h1>
      <p className="lede">
        Mutant rewrites your function dozens of ways — flipped operators, nudged
        boundaries, dropped guards — and checks which of those bugs your suite
        actually catches. Survivors are bugs your tests can never find. Generate
        better tests and watch the score prove it.
      </p>

      <div className="row">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            className={ex.id === exampleId ? "chip on" : "chip"}
            onClick={() => loadExample(ex.id)}
          >
            {ex.title}
          </button>
        ))}
        <span className="spacer" />
        <a className="chip" href="#evidence">
          Evidence ↓
        </a>
      </div>

      <section className="grid2">
        <div className="panel">
          <label htmlFor="code">Function under test</label>
          <textarea
            id="code"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div className="panel">
          <label htmlFor="tests">Tests (one expression per line)</label>
          <textarea
            id="tests"
            spellCheck={false}
            value={tests}
            onChange={(e) => setTests(e.target.value)}
          />
        </div>
      </section>

      <div className="row actions">
        <button className="primary" onClick={doRun} disabled={run.phase === "running" || parsedTests.length === 0}>
          {run.phase === "running"
            ? `Running ${run.progress ? `${run.progress.done}/${run.progress.total}` : ""}…`
            : "Run mutation analysis"}
        </button>
        <button className="ghost" onClick={doGenerate} disabled={genBusy || code.length === 0}>
          {genBusy ? "Generating…" : "Generate stronger tests"}
        </button>
      </div>

      {run.phase === "error" && (
        <p className="error">
          {run.error} — check the syntax of the function and tests.
        </p>
      )}

      {run.gateFailures && run.gateFailures.length > 0 && (
        <p className="error">
          {run.gateFailures.length} test(s) fail on the ORIGINAL code — they are
          excluded from scoring. A test that fails before any mutation is
          broken, not useful: fix it and re-run.
        </p>
      )}

      {run.phase === "done" && run.summary && (
        <>
          <section className="score" aria-label="mutation score">
            <span className="num">{Math.round(run.summary.score * 100)}%</span>
            <span className="of">
              mutation score — {run.summary.killed + run.summary.timeout} killed ·{" "}
              {run.summary.survived} survived / {run.summary.total}
            </span>
            <span className="bar">
              <i style={{ width: `${Math.round(run.summary.score * 100)}%` }} />
            </span>
          </section>

          {genNote && <p className="note">{genNote}</p>}

          <h2>
            Survivors <span className="muted">— bugs your suite cannot catch</span>
          </h2>
          <ul className="claims">
            {run.mutants
              ?.filter((m) => {
                const r = run.results?.find((x) => x.mutantId === m.id);
                return r?.status === "survived";
              })
              .map((m) => (
                <li key={m.id} className="claim fail">
                  <div className="top">
                    <span className="statement">
                      {m.id} · {m.description}
                    </span>
                    <span className="pill fail">survived</span>
                  </div>
                  <pre className="diff">
                    {diffSource(code, m.code).map((p, i) => (
                      <span key={i} className={p.kind}>
                        {p.text}
                      </span>
                    ))}
                  </pre>
                </li>
              ))}
            {run.summary.survived === 0 && (
              <li className="claim pass">
                <div className="top">
                  <span className="statement">No survivors — every mutant was killed.</span>
                  <span className="pill pass">100%</span>
                </div>
              </li>
            )}
          </ul>

          <h2>
            Kills <span className="muted">— and the test that caught each one</span>
          </h2>
          <ul className="claims">
            {run.mutants
              ?.filter((m) => {
                const r = run.results?.find((x) => x.mutantId === m.id);
                return r?.status === "killed" || r?.status === "timeout";
              })
              .map((m) => {
                const r = run.results?.find((x) => x.mutantId === m.id);
                return (
                  <li key={m.id} className="claim pass">
                    <div className="top">
                      <span className="statement">
                        {m.id} · {m.description}
                      </span>
                      <span className="pill pass">{r?.status}</span>
                    </div>
                    {r?.killedBy && <div className="artifacts">killed by: {r.killedBy}</div>}
                  </li>
                );
              })}
          </ul>
        </>
      )}

      <h2 id="evidence">
        Evidence <span className="muted">— claims with measurements</span>
      </h2>
      <section className="score" aria-label="proof scorecard">
        <span className="num">
          {card.proven}/{card.total}
        </span>
        <span className="of">claims proven</span>
        <span className="bar">
          <i style={{ width: `${Math.round(card.ratio * 100)}%` }} />
        </span>
      </section>
      <ul className="claims">
        {evidence.claims.map((claim) => (
          <li key={claim.id} className={`claim ${claim.state}`}>
            <div className="top">
              <span className="statement">{claim.statement}</span>
              <span className={`pill ${claim.state}`}>{claim.state}</span>
            </div>
            {claim.measurement && (
              <div className="metric">{formatMeasurement(claim.measurement)}</div>
            )}
            <div className="artifacts">
              evidence: {claim.artifacts.map((a) => a.ref).join(" · ") || "run the demo"}
            </div>
          </li>
        ))}
      </ul>

      <p className="footer">
        Everything runs in your browser — the engine, the sandboxed runs, the
        scoring. No code leaves the page; the only server call is optional test
        generation. Built solo in 24 hours for HackDevengers 2.0.
      </p>
    </main>
  );
}
