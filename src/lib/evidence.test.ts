import { describe, expect, it } from "vitest";
import {
  enforceProvability,
  formatMeasurement,
  isProvable,
  percentDelta,
  scorecard,
  type Artifact,
  type Claim,
  type EvidenceReport,
  type Measurement,
} from "./evidence";

const DEFAULT_ARTIFACT: Artifact = { kind: "log", ref: "artifacts/mutation.log" };

type Overrides = Partial<Omit<Claim, "measurement" | "artifacts">> & {
  measurement?: Measurement | undefined;
  artifacts?: readonly Artifact[] | undefined;
};

/**
 * Built field by field rather than by spreading, because
 * exactOptionalPropertyTypes forbids assigning an explicit undefined to an
 * optional property — and "no measurement" is a state these tests must cover.
 */
const claim = (over: Overrides = {}): Claim => {
  const { measurement, artifacts, ...rest } = over;
  const base: Claim = {
    id: "c1",
    statement: "the suite catches real bugs",
    state: "pass",
    artifacts: artifacts ?? [DEFAULT_ARTIFACT],
    ...rest,
  };
  return measurement === undefined ? base : { ...base, measurement };
};

const measured = (over: Overrides = {}): Claim =>
  claim({
    measurement: { label: "mutation score", before: 0, after: 92, unit: "%" },
    ...over,
  });

const report = (claims: Claim[]): EvidenceReport => ({
  claims,
  generatedAt: "2026-09-19T00:00:00.000Z",
});

describe("isProvable", () => {
  it("requires both a measurement and an artifact", () => {
    expect(isProvable(measured())).toBe(true);
    expect(isProvable(measured({ measurement: undefined }))).toBe(false);
    expect(isProvable(measured({ artifacts: [] }))).toBe(false);
  });
});

describe("enforceProvability", () => {
  it("downgrades a passing claim that cannot prove itself", () => {
    const out = enforceProvability(report([measured({ artifacts: [] })]));
    expect(out.claims[0]?.state).toBe("unmeasured");
  });

  it("downgrades a failing claim it cannot prove either", () => {
    const out = enforceProvability(report([measured({ state: "fail", artifacts: [] })]));
    expect(out.claims[0]?.state).toBe("unmeasured");
  });

  it("leaves a provable claim alone", () => {
    const out = enforceProvability(report([measured()]));
    expect(out.claims[0]?.state).toBe("pass");
  });

  it("does not touch claims that were never asserted", () => {
    const out = enforceProvability(report([measured({ state: "pending", measurement: undefined })]));
    expect(out.claims[0]?.state).toBe("pending");
  });

  it("is idempotent", () => {
    const once = enforceProvability(report([measured({ artifacts: [] })]));
    expect(enforceProvability(once)).toEqual(once);
  });
});

describe("scorecard", () => {
  it("counts only provable passing claims", () => {
    const s = scorecard(
      report([
        measured(),
        measured({ id: "c2", state: "fail" }),
        measured({ id: "c3", artifacts: [] }),
      ]),
    );
    expect(s).toEqual({ proven: 1, total: 3, ratio: 1 / 3 });
  });

  it("reports zero rather than NaN when there is nothing to prove", () => {
    expect(scorecard(report([])).ratio).toBe(0);
  });
});

describe("percentDelta", () => {
  it("returns null for a zero baseline instead of Infinity", () => {
    expect(percentDelta({ label: "mutation score", before: 0, after: 92 })).toBeNull();
  });

  it("computes the signed delta from a real baseline", () => {
    expect(percentDelta({ label: "axe score", before: 50, after: 98 })).toBeCloseTo(96);
  });

  it("handles regression", () => {
    expect(percentDelta({ label: "latency", before: 200, after: 100 })).toBe(-50);
  });
});

describe("formatMeasurement", () => {
  it("renders before and after with the unit", () => {
    expect(formatMeasurement({ label: "axe score", before: 42, after: 98 })).toBe(
      "axe score: 42 → 98 (+133.3% from baseline)",
    );
  });

  it("marks an unchanged measurement rather than inventing a delta", () => {
    expect(formatMeasurement({ label: "attacks blocked", before: 7, after: 7 })).toBe(
      "attacks blocked: 7 → 7 (=0.0% from baseline)",
    );
  });
});
