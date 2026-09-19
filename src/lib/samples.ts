/**
 * Curated examples. Each ships a deliberately WEAK seed suite, so the first
 * run exposes survivors (that's the product's point), and a pre-baked STRONG
 * fallback suite so the full loop — weak score, better tests, score rise —
 * demos end-to-end with zero API calls. The LLM path replaces the fallback
 * when the key is live.
 */

export interface Example {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly code: string;
  /** Weak seed suite: passes on the original, but leaves mutants alive. */
  readonly seedTests: readonly string[];
  /** Pre-baked strong suite: kills the survivors the seed misses. */
  readonly strongTests: readonly string[];
}

export const EXAMPLES: readonly Example[] = [
  {
    id: "gst",
    title: "GST slab calculator",
    blurb:
      "Classic boundary logic: four slabs, off-by-one bugs hide exactly at the edges.",
    code: `function gstRate(amount) {
  if (amount < 1000) return 0;
  if (amount <= 5000) return 5;
  if (amount > 50000) return 28;
  return 18;
}`,
    seedTests: [
      "gstRate(20000) === 18",
    ],
    strongTests: [
      "gstRate(500) === 0",
      "gstRate(2000) === 5",
      "gstRate(20000) === 18",
      "gstRate(100000) === 28",
      // boundary probes the seed suite never checks
      "gstRate(999) === 0 && gstRate(1000) === 5",
      "gstRate(5000) === 5 && gstRate(5001) === 18",
      "gstRate(50000) === 18 && gstRate(50001) === 28",
      "gstRate(0) === 0",
    ],
  },
  {
    id: "latefee",
    title: "Library late fee",
    blurb:
      "Compounding fees with a cap and a waiver — arithmetic flips gut it silently.",
    code: `function lateFee(daysLate, isStudent) {
  let fee = 0;
  fee += 10 * daysLate;
  if (isStudent) {
    fee = fee / 2;
  }
  if (fee > 500) {
    fee = 500;
  }
  if (daysLate < 0) {
    return 0;
  }
  return fee;
}`,
    seedTests: [
      "lateFee(3, false) === 30",
    ],
    strongTests: [
      "lateFee(3, false) === 30",
      "lateFee(10, true) === 50",
      "lateFee(100, false) === 500",
      // cap boundary and the student discount actually halving
      "lateFee(50, false) === 500",
      "lateFee(4, true) === 20",
      "lateFee(0, true) === 0",
      "lateFee(1, false) === 10",
      "lateFee(25, true) === 125",
      // cap boundary exactness, negative-day waiver, and the fractional-day
      // probe that kills the `daysLate < 1` mutant (equivalent for integers)
      "lateFee(49, false) === 490 && lateFee(50, false) === 500",
      "lateFee(-1, false) === 0 && lateFee(-3, true) === 0",
      "lateFee(0.5, false) === 5",
    ],
  },
];

export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}
