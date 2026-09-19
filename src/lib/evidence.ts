/**
 * Evidence model.
 *
 * Every candidate design for this hackathon shares one shape: the product makes
 * a claim, and the demo PROVES the claim with a number the judge can watch move.
 * This module is that shared spine — a claim is only "proven" when it carries a
 * measured before/after pair and the artifacts that produced them.
 *
 * Design rule: a Claim may never render as passing without a measurement.
 * `unmeasured` is a first-class state so the UI can never imply proof it lacks.
 */

export type EvidenceState = "pending" | "unmeasured" | "pass" | "fail";

export interface Measurement {
  /** Human label for the axis being measured, e.g. "mutation score". */
  readonly label: string;
  readonly before: number;
  readonly after: number;
  /** Optional unit; "" renders bare numbers. */
  readonly unit?: string;
}

export interface Artifact {
  readonly kind: "file" | "url" | "log";
  readonly ref: string;
}

export interface Claim {
  readonly id: string;
  readonly statement: string;
  readonly state: EvidenceState;
  readonly measurement?: Measurement;
  readonly artifacts: readonly Artifact[];
  /** Where in the product this claim is demonstrable, for the demo script. */
  readonly demoStep?: string;
}

export interface EvidenceReport {
  readonly claims: readonly Claim[];
  readonly generatedAt: string;
}

/** A claim is only provable when it has a measurement AND at least one artifact. */
export function isProvable(claim: Claim): boolean {
  return claim.measurement !== undefined && claim.artifacts.length > 0;
}

/**
 * Downgrade any claim that claims to pass but cannot prove it.
 * This is the guard that keeps a demo honest under time pressure.
 */
export function enforceProvability(report: EvidenceReport): EvidenceReport {
  return {
    ...report,
    claims: report.claims.map((claim) =>
      (claim.state === "pass" || claim.state === "fail") && !isProvable(claim)
        ? { ...claim, state: "unmeasured" as const }
        : claim,
    ),
  };
}

export interface Scorecard {
  readonly proven: number;
  readonly total: number;
  /** 0..1, or 0 when there is nothing to prove. */
  readonly ratio: number;
}

export function scorecard(report: EvidenceReport): Scorecard {
  const total = report.claims.length;
  const proven = report.claims.filter(
    (c) => c.state === "pass" && isProvable(c),
  ).length;
  return { proven, total, ratio: total === 0 ? 0 : proven / total };
}

/** Delta as a percentage change, guarded against a zero baseline. */
export function percentDelta(m: Measurement): number | null {
  if (m.before === 0) return null;
  return ((m.after - m.before) / Math.abs(m.before)) * 100;
}

export function formatMeasurement(m: Measurement): string {
  const unit = m.unit ?? "";
  const delta = percentDelta(m);
  const arrow = m.after === m.before ? "=" : m.after > m.before ? "+" : "";
  const tail =
    delta === null
      ? ""
      : ` (${arrow}${delta.toFixed(1)}% from baseline)`;
  return `${m.label}: ${m.before}${unit} → ${m.after}${unit}${tail}`;
}

/** The first clean run of a given piece of code — what "the suite as written" means. */
export interface Baseline {
  /** The exact source this baseline measured. A baseline never transfers to other code. */
  readonly code: string;
  readonly score: number;
  readonly survivors: number;
  readonly total: number;
}

/** The baseline that applies to `code`, or null when none was measured for it. */
export function baselineFor(baseline: Baseline | null, code: string): Baseline | null {
  return baseline !== null && baseline.code === code ? baseline : null;
}

/**
 * "Generated tests measurably improve the score" is proven only when the
 * baseline measured THIS code, tests were actually generated for it, and the
 * score rose. Switching examples or hand-editing tests must never render as
 * a model-driven improvement.
 */
export function claimStrong(
  current: number,
  baseline: Baseline,
  code: string,
  generated: boolean,
): Claim {
  const base: Claim = {
    id: "claim-strong",
    statement: "Generated tests measurably improve the mutation score.",
    state: "pending",
    artifacts: [{ kind: "log", ref: "live run on this page" }],
    demoStep: "beat 4 — score after Generate + re-Run",
  };
  if (baseline.code !== code || !generated || current <= baseline.score) return base;
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
