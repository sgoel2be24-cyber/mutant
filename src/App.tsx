import {
  enforceProvability,
  formatMeasurement,
  scorecard,
  type Claim,
  type EvidenceReport,
} from "./lib/evidence";

/**
 * Shell while the engine lands. The contract stays: every claim renders with
 * its measurement and artifacts, or renders as PENDING. Nothing looks proven
 * for free — the first deploy of the real engine replaces this report.
 */
const SHELL_REPORT: EvidenceReport = {
  generatedAt: new Date(0).toISOString(),
  claims: [
    {
      id: "claim-score-rises",
      statement:
        "Mutation score rises when generated tests are added — measured live, on this page.",
      state: "pending",
      artifacts: [
        { kind: "file", ref: "src/lib/evidence.test.ts" },
        { kind: "file", ref: "README.md#evidence" },
      ],
      demoStep: "the mutation engine and curated example land in the next deploy",
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
        Your tests are <span className="mark">lying to you</span>.
      </h1>
      <p className="lede">
        Mutant rewrites your function dozens of ways — flipped operators, nudged
        boundaries, dropped guards — and checks which mutations your suite
        actually catches. A mutation your tests survive is a bug they can never
        find. Live build during the 24-hour window; the engine lands next.
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
        for the production bundle.
      </p>
    </main>
  );
}
