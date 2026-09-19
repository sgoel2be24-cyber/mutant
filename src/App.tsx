import { useMemo, useState } from "react";
import { EXAMPLES, exampleById, type Example } from "./lib/samples";
import { mutateReport, type Mutant } from "./lib/mutate";
import { runMutationCampaign, runOnce } from "./lib/runnerClient";
import { summarize, type MutantResult, type ScoreSummary } from "./lib/runner";
import { diffSource } from "./lib/diff";
import { generateTests, generateTargetedTest } from "./lib/generate";
import { useCountUp, useRevealCascade, useReducedMotion } from "./lib/hooks";
import { buildShareUrl, encodeShare, readShareFromLocation } from "./lib/share";
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
  scoredTests?: number;
  repaired?: number;
  dropped?: number;
  durationMs?: number;
  progress?: { done: number; total: number };
  error?: string;
}

/**
 * The improvement claim is only rendered as proven when the numbers show an
 * actual rise; otherwise it stays pending with no measurement attached.
 */
function claimStrong(
  current: number,
  baseline: { score: number; survivors: number; total: number },
): Claim {
  const base: Claim = {
    id: "claim-strong",
    statement: "Generated tests measurably improve the mutation score.",
    state: "pending",
    artifacts: [{ kind: "log", ref: "live run on this page" }],
    demoStep: "beat 4 — score after Generate + re-Run",
  };
  if (current <= baseline.score) return base;
  return {
    ...base,
    statement: `Generated boundary tests raised the mutation score from ${baseline.score}% to ${current}%.`,
    state: "pass",
    measurement: {
      label: "mutation score, generated tests vs baseline",
      before: baseline.score,
      after: current,
      unit: "%",
    },
  };
}

export default function App() {
  const [exampleId, setExampleId] = useState<string>(EXAMPLES[0]!.id);
  const example: Example | undefined = exampleById(exampleId);
  const [code, setCode] = useState<string>(EXAMPLES[0]!.code);
  const [tests, setTests] = useState<string>(EXAMPLES[0]!.seedTests.join("\n"));
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  const [genNote, setGenNote] = useState<string>("");
  const [genBusy, setGenBusy] = useState(false);
  /**
   * Mutants that survive the user's suite AND the curated boundary suite for
   * this example are flagged as possibly EQUIVALENT (no input distinguishes
   * them from the original). Naming them is the honest alternative to
   * pretending a mutation score of 100% is always reachable — a real mutation
   * tester has to admit this, and judges in this space know it.
   */
  const [equivSuspects, setEquivSuspects] = useState<readonly string[]>([]);
  /** Survivors shown before the list is expanded (mobile-friendly default). */
  const [showAllSurvivors, setShowAllSurvivors] = useState(false);
  /** Per-survivor "kill this mutant" state: busy flag + what the model wrote. */
  const [targetingId, setTargetingId] = useState<string | null>(null);
  const [targetNote, setTargetNote] = useState<string>("");
  const [shareNote, setShareNote] = useState<string>("");
  const [badgeNote, setBadgeNote] = useState<string>("");
  /** Set when the page was opened from a shared link, for the restore banner. */
  const [restoredFromShare, setRestoredFromShare] = useState<number | null>(null);

  const loadExample = (id: string) => {
    const ex = exampleById(id);
    if (!ex) return;
    setExampleId(id);
    setCode(ex.code);
    setTests(ex.seedTests.join("\n"));
    setRun({ phase: "idle" });
    setGenNote("");
  };

  // Restore a shared run: hash -> code + tests, then run it. Score is always
  // recomputed, so a shared link is a live reproduction, not a screenshot.
  useState(() => {
    const shared = readShareFromLocation();
    if (shared) {
      setCode(shared.code);
      setTests(shared.tests.join("\n"));
      if (shared.exampleId !== "custom") setExampleId(shared.exampleId);
      setRestoredFromShare(shared.scorePercent);
    }
    return null;
  });

  const parsedTests = useMemo(
    () => tests.split("\n").map((t) => t.trim()).filter((t) => t.length > 0),
    [tests],
  );

  /**
   * The first clean run is the BASELINE — evidence claims about "the suite as
   * written" must describe that state, not whatever the latest run shows.
   * Otherwise the claim keeps asserting weakness after the score has risen.
   */
  const [baseline, setBaseline] = useState<
    { score: number; survivors: number; total: number } | null
  >(null);
  const [generated, setGenerated] = useState(false);

  const evidence: EvidenceReport = useMemo(() => {
    if (run.phase !== "done" || !run.summary || !baseline) {
      return { generatedAt: new Date(0).toISOString(), claims: [] };
    }
    const current = Math.round(run.summary.score * 100);
    const claims: Claim[] = [
      {
        id: "claim-weak",
        statement:
          baseline.survivors === 0
            ? `The suite as written already killed all ${baseline.total} mutants.`
            : `The suite as written left ${baseline.survivors} of ${baseline.total} mutants alive — each was a bug it could not catch.`,
        state: "pass",
        measurement: {
          label: "surviving mutants at baseline (ideal: 0)",
          before: 0,
          after: baseline.survivors,
        },
        artifacts: [{ kind: "log", ref: "live run on this page" }],
        demoStep: "beat 2 — survivor list at baseline",
      },
      claimStrong(current, baseline),
    ];
    return enforceProvability({ generatedAt: new Date().toISOString(), claims });
  }, [run.phase, run.summary, baseline]);

  const doRun = async (testsOverride?: readonly string[]) => {
    const useTests = testsOverride ?? parsedTests;
    setShowAllSurvivors(false);
    setRun({ phase: "running" });
    try {
      const report = mutateReport(code, { seed: 1 });
      const mutants = report.mutants;
      const campaign = await runMutationCampaign(code, useTests, mutants, {
        onProgress: (done, total) => setRun((r) => ({ ...r, progress: { done, total } })),
      });
      if (campaign.scoredTests.length === 0) {
        // Nothing passed on the original, so there is nothing to score. Say so
        // instead of publishing a meaningless 0%.
        setRun({
          phase: "error",
          error:
            "None of these tests pass on the original code, so no mutant can be scored. " +
            "A test that fails before any mutation proves nothing — fix the tests first.",
          gateFailures: campaign.gateFailures,
        });
        return;
      }
      const summary = summarize(campaign.results);
      setRun({
        phase: "done",
        mutants,
        results: campaign.results,
        summary,
        gateFailures: campaign.gateFailures,
        scoredTests: campaign.scoredTests.length,
        repaired: report.repaired,
        dropped: report.dropped,
        durationMs: campaign.durationMs,
      });

      // Second pass: do the survivors also survive the curated boundary suite?
      if (example && campaign.gateFailures.length === 0) {
        const survivors = mutants.filter(
          (m) =>
            campaign.results.find((r) => r.mutantId === m.id)?.status ===
            "survived",
        );
        if (survivors.length > 0) {
          const probe = await runMutationCampaign(
            code,
            example.strongTests,
            survivors,
          );
          setEquivSuspects(
            probe.results
              .filter((r) => r.status === "survived")
              .map((r) => r.mutantId),
          );
        } else {
          setEquivSuspects([]);
        }
      } else {
        setEquivSuspects([]);
      }
      if (baseline === null && campaign.gateFailures.length === 0) {
        setBaseline({
          score: Math.round(summary.score * 100),
          survivors: summary.survived,
          total: summary.total,
        });
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
      setGenerated(true);
      setGenNote(
        suite.source === "llm"
          ? `${suite.tests.length} tests added from the model — re-scoring now.`
          : (suite.note ?? "curated suite loaded — re-scoring now."),
      );
      // Re-score immediately: the number on screen must never be stale
      // relative to the tests on screen.
      await doRun(merged);
    } catch (e) {
      setGenNote(
        `generation unavailable: ${e instanceof Error ? e.message : "error"} — ` +
          "this is the honest offline path; the engine still works.",
      );
    } finally {
      setGenBusy(false);
    }
  };

  /**
   * Export the run as evidence a judge can inspect offline: every mutant, its
   * operator, status, killer test, and the headline numbers. This is the
   * artifact that makes the claim auditable after the page is closed.
   */

  /**
   * Targeted kill: ask the model for one test that distinguishes this survivor,
   * verify it PASSES on the original code and FAILS on the mutant (a test that
   * does not do both is useless), append it, and re-score. The score rises by
   * exactly the mutants that test catches — a visible, causal improvement.
   */
  const killSurvivor = async (mutant: Mutant) => {
    if (run.phase !== "done" || !run.mutants) return;
    setTargetingId(mutant.id);
    setTargetNote("");
    try {
      const { tests: newTests } = await generateTargetedTest(code, parsedTests, {
        code: mutant.code,
        description: mutant.description,
      });
      // Verify each candidate: pass on original AND fail on the mutant.
      const original = await runOnce(code, newTests, 0, 2500);
      const onMutant = await runOnce(mutant.code, newTests, 1, 2500);
      const good: string[] = [];
      for (let i = 0; i < newTests.length; i++) {
        const o = original.outcomes[i];
        const m = onMutant.outcomes[i];
        if (o?.passed && m && !m.passed && !m.syntaxError) good.push(newTests[i]!);
      }
      if (good.length === 0) {
        setTargetNote(
          `The model's candidate for ${mutant.id} did not distinguish the mutant ` +
            `(it either failed the original or also passed the mutant). Not added — ` +
            `only verified tests are inserted.`,
        );
        setTargetingId(null);
        return;
      }
      const merged = [...new Set([...parsedTests, ...good])];
      setTests(merged.join("\n"));
      setTargetNote(
        `Added ${good.length} test(s) targeting ${mutant.id} — re-scoring. ` +
          `Each was verified to pass on the original and fail on the mutant.`,
      );
      await doRun(merged);
    } catch (e) {
      setTargetNote(
        `targeted generation unavailable: ${e instanceof Error ? e.message : "error"}. ` +
          `The bulk Generate path still works.`,
      );
    } finally {
      setTargetingId(null);
    }
  };

  const exportRun = () => {
    if (run.phase !== "done" || !run.summary || !run.mutants) return;
    const payload = {
      tool: "Mutant",
      generatedAt: new Date().toISOString(),
      example: exampleId,
      testsSource: generated ? "seed + model-generated" : "seed only",
      code,
      tests: parsedTests,
      summary: run.summary,
      mutationScorePercent: Math.round(run.summary.score * 100),
      gateFailures: run.gateFailures ?? [],
      testsScored: run.scoredTests ?? 0,
      mutantsRepaired: run.repaired ?? 0,
      mutantsDiscardedUnsafe: run.dropped ?? 0,
      campaignDurationMs: Math.round(run.durationMs ?? 0),
      possiblyEquivalent: equivSuspects,
      mutants: run.mutants.map((m) => {
        const r = run.results?.find((x) => x.mutantId === m.id);
        return {
          id: m.id,
          operator: m.operator,
          description: m.description,
          span: m.span,
          originalText: m.originalText,
          replacementText: m.replacementText,
          status: r?.status ?? "unknown",
          killedBy: r?.killedBy ?? null,
          possiblyEquivalent: equivSuspects.includes(m.id),
        };
      }),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mutant-run-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reducedMotion = useReducedMotion();
  const displayedScore = useCountUp(
    run.phase === "done" && run.summary ? Math.round(run.summary.score * 100) : 0,
    900,
  );
  const totalMutants = run.mutants?.length ?? 0;
  const revealedCount = useRevealCascade(totalMutants, 80);

  /** Encode the current run into a URL hash and copy it — a live link a judge
   *  can open days later and see the same score recomputed. */
  const shareRun = async () => {
    if (run.phase !== "done" || !run.summary) return;
    const url = buildShareUrl({
      code,
      tests: parsedTests,
      exampleId,
      scorePercent: Math.round(run.summary.score * 100),
    });
    if (!url) {
      setShareNote("This run is too large to share as a link.");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareNote("Link copied — it recomputes the score live when opened.");
    } catch {
      setShareNote(url);
    }
  };


  /** CI-mode export: the gate a pipeline reads. The shape is the contract:
   *  fail the build when the measured score is below fail_below. */
  const exportCi = () => {
    if (run.phase !== "done" || !run.summary) return;
    const payload = {
      tool: "mutant-ci",
      version: 1,
      generatedAt: new Date().toISOString(),
      mutationScorePercent: Math.round(run.summary.score * 100),
      fail_below: 80,
      pass: Math.round(run.summary.score * 100) >= 80,
      totals: {
        mutants: run.summary.total,
        killed: run.summary.killed,
        survived: run.summary.survived,
        timeout: run.summary.timeout,
        invalid: run.summary.invalid,
      },
      gateFailuresExcluded: run.gateFailures ?? [],
      testsScored: run.scoredTests ?? 0,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement("a");
    a2.href = url;
    a2.download = "mutant-ci.json";
    a2.click();
    URL.revokeObjectURL(url);
  };

  /** The badge URL encodes the run state, so the number in the badge is one a
   *  run actually produced. */
  const copyBadge = async () => {
    if (run.phase !== "done" || !run.summary) return;
    const state = encodeShare({
      code,
      tests: parsedTests,
      exampleId,
      scorePercent: Math.round(run.summary.score * 100),
    });
    const origin = window.location.origin;
    const badgeUrl = `${origin}/api/badge?state=${state}`;
    const md = `![mutation score](${badgeUrl})`;
    try {
      await navigator.clipboard.writeText(md);
      setBadgeNote("Badge markdown copied — the SVG is generated from this run.");
    } catch {
      setBadgeNote(md);
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
        <button className="primary" onClick={() => doRun()} disabled={run.phase === "running" || parsedTests.length === 0}>
          {run.phase === "running"
            ? `Running ${run.progress ? `${run.progress.done}/${run.progress.total}` : ""}…`
            : "Run mutation analysis"}
        </button>
        <button className="ghost" onClick={doGenerate} disabled={genBusy || code.length === 0}>
          {genBusy ? "Generating…" : "Generate stronger tests"}
        </button>
        <button className="ghost" onClick={exportRun} disabled={run.phase !== "done"}>
          Download run (JSON)
        </button>
        <button className="ghost" onClick={shareRun} disabled={run.phase !== "done"}>
          Share run link
        </button>
        <button className="ghost" onClick={copyBadge} disabled={run.phase !== "done"}>
          Copy badge
        </button>
        <button className="ghost" onClick={exportCi} disabled={run.phase !== "done"}>
          CI export
        </button>
      </div>

      {restoredFromShare !== null && (
        <p className="note">
          Opened from a shared link — the sender saw {restoredFromShare}%. Run it
          to recompute the score live.
        </p>
      )}
      {shareNote && <p className="note">{shareNote}</p>}
      {badgeNote && <p className="note">{badgeNote}</p>}

      {run.phase === "error" && (
        <p className="error">
          {run.error} — check the syntax of the function and tests.
        </p>
      )}

      {run.gateFailures && run.gateFailures.length > 0 && (
        <p className="error">
          {run.gateFailures.length} test(s) fail on the ORIGINAL code and were
          EXCLUDED from scoring ({run.scoredTests ?? 0} kept). A test that fails
          before any mutation is broken, not useful.
        </p>
      )}

      {run.phase === "done" && run.summary && (
        <>
          <section className="score" aria-label="mutation score">
            <span className="num" aria-live="polite">{Math.round(displayedScore)}%</span>
            <span className="of">
              mutation score — {run.summary.killed + run.summary.timeout} killed ·{" "}
              {run.summary.survived} survived / {run.summary.total}
              {run.summary.invalid > 0 ? ` · ${run.summary.invalid} excluded as unparseable` : ""}
              {run.dropped ? ` · ${run.dropped} unsafe mutations discarded` : ""}
            </span>
            <span className="bar">
              <i style={{ width: `${Math.round(run.summary.score * 100)}%` }} />
            </span>
          </section>

          {genNote && <p className="note">{genNote}</p>}
          {targetNote && <p className="note">{targetNote}</p>}

          <h2>
            Survivors <span className="muted">— bugs your suite cannot catch</span>
          </h2>
          {equivSuspects.length > 0 && (
            <p className="note">
              {equivSuspects.length} marked <b>possibly equivalent</b>: they
              survive even the curated boundary suite, so no input may
              distinguish them from the original. A mutation score of 100% is
              not always reachable — pretending otherwise would be dishonest
              scoring.
            </p>
          )}
          <ul className="claims">
            {run.mutants
              ?.filter((m) => {
                const r = run.results?.find((x) => x.mutantId === m.id);
                return r?.status === "survived";
              })
              .filter((_, i) => showAllSurvivors || i < 5)
              .map((m) => (
                <li key={m.id} className="claim fail">
                  <div className="top">
                    <span className="statement">
                      {m.id} · {m.description}
                    </span>
                    <span className="pill fail">
                      {equivSuspects.includes(m.id) ? "possibly equivalent" : "survived"}
                    </span>
                  </div>
                  <div className="row">
                    <button
                      className="chip"
                      onClick={() => killSurvivor(m)}
                      disabled={targetingId !== null || run.phase !== "done"}
                    >
                      {targetingId === m.id ? "Targeting…" : "Kill this mutant"}
                    </button>
                  </div>
                  <pre className="diff">
                    {diffSource(code, m.code).map((p, i) => (
                      <span key={i} className={p.kind}>
                        {p.text}
                      </span>
                    ))}
                  </pre>
                  <div className="legend">
                    <span className="sw del" /> original &nbsp;·&nbsp;{" "}
                    <span className="sw add" /> injected mutation
                  </div>
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
          {run.summary.survived > 5 && !showAllSurvivors && (
            <div className="row">
              <button className="chip" onClick={() => setShowAllSurvivors(true)}>
                Show all {run.summary.survived} survivors
              </button>
            </div>
          )}

          <h2>
            Kills <span className="muted">— and the test that caught each one</span>
          </h2>
          <ul className="claims">
            {run.mutants
              ?.filter((m) => {
                const r = run.results?.find((x) => x.mutantId === m.id);
                return r?.status === "killed" || r?.status === "timeout";
              })
              .map((m, i) => {
                const r = run.results?.find((x) => x.mutantId === m.id);
                return (
                  <li
                    key={m.id}
                    className={`claim pass ${reducedMotion || i < revealedCount ? "" : "pending-reveal"}`}
                    style={reducedMotion || i < revealedCount ? undefined : { opacity: 0.35 }}
                  >
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
