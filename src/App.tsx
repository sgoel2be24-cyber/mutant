import {
  enforceProvability,
  formatMeasurement,
  scorecard,
  type Claim,
  type EvidenceReport,
} from "./lib/evidence";

/**
 * Shell only. The winning design replaces this report with the real one and
 * keeps the same contract: every claim renders with its measurement and its
 * artifacts, or it renders as UNMEASURED. Nothing gets to look proven for free.
 */
const SHELL_REPORT: EvidenceReport = {
  generatedAt: new Date(0).toISOString(),
  claims: [
    {
      id: "claim-shape",
      statement:
        "The product's core claim is provable from a number that moves during the demo.",
      state: "pass",
      measurement: { label: "proof coverage", before: 0, after: 3, unit: " claims" },
      artifacts: [
        { kind: "file", ref: "src/lib/evidence.test.ts" },
        { kind: "file", ref: "README.md#evidence" },
      ],
      demoStep: "step 1 — open the deployed link, the scorecard is the first thing on screen",
    } satisfies Claim,
  ],
};

const report = enforceProvability(SHELL_REPORT);
const card = scorecard(report);

export default function App() {
  return (
    <main className="wrap">
      <p className="eyebrow">HackDevengers 2.0 · 24h · Open Innovation</p>
      <h1>
        Replace this shell with the <span className="mark">one mechanism</span>{" "}
        that wins.
      </h1>
      <p className="lede">
        Scaffold verified green. Every candidate design on the shortlist keeps
        this contract: a claim is only shown as proven when it carries a
        measured before/after pair and the artifacts that produced it.
      </p>

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
        {report.claims.map((claim) => (
          <li key={claim.id} className={`claim ${claim.state}`}>
            <div className="top">
              <span className="statement">{claim.statement}</span>
              <span className={`pill ${claim.state}`}>{claim.state}</span>
            </div>
            {claim.measurement && (
              <div className="metric">{formatMeasurement(claim.measurement)}</div>
            )}
            <div className="artifacts">
              evidence: {claim.artifacts.map((a) => a.ref).join(" · ") || "none"}
            </div>
            {claim.demoStep && <div className="step">{claim.demoStep}</div>}
          </li>
        ))}
      </ul>

      <p className="footer">
        Run <code>pnpm test</code> for the guard tests, <code>pnpm build</code>{" "}
        for the production bundle. Deploy target: Vercel (CLI already authed).
      </p>
    </main>
  );
}
