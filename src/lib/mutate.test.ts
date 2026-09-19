import { describe, expect, it } from "vitest";
import { parse } from "acorn";
import { mutate, mutateReport, parseSource } from "./mutate";

/**
 * The engine's correctness contract:
 * 1. every mutant re-parses as valid JavaScript,
 * 2. every mutant differs from the original at exactly its declared span,
 * 3. discovery is deterministic,
 * 4. caps are honored via seeded selection.
 *
 * If these break, the product shows judges garbage instead of insight.
 */

const CASES: ReadonlyArray<{ name: string; src: string }> = [
  {
    name: "comparison + boundary (GST slab)",
    src: `function gstSlab(amount) {
  if (amount < 1000) return 0;
  if (amount <= 5000) return 5;
  if (amount > 50000) return 28;
  return 18;
}`,
  },
  {
    name: "arithmetic and compound assignment",
    src: `function lateFee(days) {
  let fee = 0;
  fee += 50;
  fee *= days;
  return fee % 1000;
}`,
  },
  {
    name: "logical + negation + ternary",
    src: `function eligible(age, verified) {
  if (age >= 18 && verified) return "ok";
  if (!verified) return "unverified";
  return age > 60 ? "senior" : "minor";
}`,
  },
  {
    name: "literals, strings, booleans",
    src: `function label(score) {
  if (score === 100) return "perfect";
  if (score >= 50) return true ? "pass" : "fail";
  return "";
}`,
  },
  {
    name: "update expressions",
    src: `function countdown(n) {
  let out = 0;
  for (let i = 0; i < n; i++) {
    out++;
  }
  return --out;
}`,
  },
];

describe("mutate — validity and precision", () => {
  for (const { name, src } of CASES) {
    it(`every mutant re-parses: ${name}`, () => {
      const mutants = mutate(src, { seed: 1 });
      expect(mutants.length).toBeGreaterThan(0);
      for (const m of mutants) {
        expect(() =>
          parse(m.code, { ecmaVersion: "latest" }),
        ).not.toThrow();
      }
    });

    it(`every mutant differs at exactly its span: ${name}`, () => {
      for (const m of mutate(src, { seed: 1 })) {
        expect(m.originalText).toBe(src.slice(m.span.start, m.span.end));
        expect(m.replacementText).not.toBe(m.originalText);
        expect(m.code).toBe(
          src.slice(0, m.span.start) +
            m.replacementText +
            src.slice(m.span.end),
        );
        // Same-length splices are legitimate (`++` -> `--`); content must differ.
        expect(m.code).not.toBe(src);
      }
    });
  }
});

describe("mutate — determinism", () => {
  it("same input + seed produces identical mutants", () => {
    const src = CASES[0]!.src;
    const a = mutate(src, { seed: 7 });
    const b = mutate(src, { seed: 7 });
    expect(a).toEqual(b);
  });

  it("different seeds diverge when over cap", () => {
    const src = CASES[0]!.src + CASES[1]!.src;
    const a = mutate(src, { cap: 2, seed: 1 });
    const b = mutate(src, { cap: 2, seed: 2 });
    expect(a.map((m) => m.id + m.operator)).not.toEqual(
      b.map((m) => m.id + m.operator),
    );
  });
});

describe("mutate — caps", () => {
  it("caps the mutant count and keeps a permutation of the found set", () => {
    const src = CASES[0]!.src + CASES[1]!.src;
    const all = mutate(src, { seed: 3 });
    const capped = mutate(src, { cap: 2, seed: 3 });
    expect(capped.length).toBe(2);
    const keys = new Set(all.map((m) => `${m.span.start}:${m.replacementText}`));
    for (const m of capped) {
      expect(keys.has(`${m.span.start}:${m.replacementText}`)).toBe(true);
    }
  });
});

describe("mutate — operator coverage", () => {
  it("produces comparison, arithmetic, logical, guard and literal mutants", () => {
    const combined = CASES.map((c) => c.src).join("\n");
    const seen = new Set(
      mutate(combined, { seed: 1 }).map((m) => m.operator),
    );
    for (const op of [
      "flip-operator",
      "drop-guard",
      "drop-negation",
      "drop-condition",
      "drop-return-value",
      "flip-update",
    ]) {
      expect(seen.has(op), `missing operator: ${op}`).toBe(true);
    }
  });

  it("wipes numeric literals toward a different value, not the same one", () => {
    const src = `function f(x) { return x * 3; }`;
    const mutants = mutate(src, { seed: 1 });
    const wipe = mutants.find((m) => m.operator === "wipe-number");
    expect(wipe).toBeDefined();
    expect(wipe!.replacementText).not.toBe(wipe!.originalText);
  });

  it("never emits an empty splice (span end > start is enforced)", () => {
    const src = `function f(x) { if (!x) return 1; return 2; }`;
    for (const m of mutate(src, { seed: 1 })) {
      expect(m.span.end).toBeGreaterThan(m.span.start);
    }
  });
});

describe("mutate — validity guarantee (audit regression)", () => {
  it("keeps a negative literal valid instead of producing `a--5`", () => {
    // The audit blocker: flipping `+` in `a + -5` must never yield `a--5`.
    const mutants = mutate("function f(a) { return a + -5; }", { seed: 1 });
    expect(mutants.length).toBeGreaterThan(0);
    for (const m of mutants) {
      expect(() => parse(m.code, { ecmaVersion: "latest" })).not.toThrow();
      expect(m.code).not.toContain("--5");
    }
  });

  it("repairs the unsafe splice rather than dropping the mutation", () => {
    const report = mutateReport("function f(a) { return a + -5; }", { seed: 1 });
    const flipped = report.mutants.find((m) => m.operator === "flip-operator");
    expect(flipped).toBeDefined();
    // The repair re-emits the operands parenthesised, so the flip survives.
    expect(flipped!.code).toContain("(a - -5)");
    expect(report.dropped).toBe(0);
  });

  it("never emits an unparseable mutant across a hostile syntactic corpus", () => {
    const corpus = [
      "function f(a) { return a + -5; }",
      "function f(a, b) { return a - -b; }",
      "function f(a) { return a * -1; }",
      "function f(a) { return a / -2.5; }",
      "function f(a) { return -a + -a; }",
      "function f(a) { return a % -3; }",
      "function f(a) { let x = 0; x += -1; return x; }",
      "function f(a) { let x = 1; x *= -2; return x; }",
      "const g = (x) => x * -2;",
      "function f(o) { return o?.a ?? -1; }",
      "function f(n) { return `v${n}` + -1; }",
      "function f(a) { return a >= 0 ? -1 : -2; }",
      "function f(a) { /* a >= b */ return a < -10; }",
      "function f(a) { if (a < -1) { return !a; } return -0; }",
      "class C { m(a) { return a * -3; } }",
    ];
    let total = 0;
    for (const src of corpus) {
      const report = mutateReport(src, { seed: 1 });
      total += report.mutants.length;
      for (const m of report.mutants) {
        expect(() => parse(m.code, { ecmaVersion: "latest" }), `invalid mutant for: ${src}`).not.toThrow();
      }
    }
    expect(total).toBeGreaterThan(20);
  });

  it("reports how many candidates it repaired or dropped", () => {
    const report = mutateReport("function f(a, b) { return a - -b; }", { seed: 1 });
    expect(report.repaired + report.dropped).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(report.repaired)).toBe(true);
    expect(Number.isInteger(report.dropped)).toBe(true);
  });
});

describe("mutate — TypeScript input (feature #4)", () => {
  const TS_CASES: ReadonlyArray<{ name: string; src: string }> = [
    { name: "typed params + return type", src: "function add(a: number, b: number): number { return a + b; }" },
    { name: "generic", src: "function first<T>(xs: T[]): T | undefined { return xs.length > 0 ? xs[0] : undefined; }" },
    { name: "as cast + optional", src: "function pct(x: number): number { const v = x as number; return v >= 1 ? 100 : v * 100; }" },
    { name: "interface + method", src: "interface P { price: number } function total(p: P): number { return p.price >= 100 ? p.price * 0.9 : p.price; }" },
    { name: "readonly array + union", src: "function pick(xs: readonly number[], i: number): number { return xs[i] ?? 0; }" },
    { name: "satisfies + enum-ish", src: "function lab(s: 'a' | 'b'): number { return s === 'a' ? 1 : 2; }" },
  ];

  for (const { name, src } of TS_CASES) {
    it(`parses and mutates TypeScript: ${name}`, () => {
      const report = mutateReport(src, { seed: 1 });
      expect(report.mutants.length).toBeGreaterThan(0);
      for (const m of report.mutants) {
        expect(() => parseSource(m.code), `invalid mutant for: ${name}`).not.toThrow();
      }
    });
  }

  it("mutates runtime syntax inside TypeScript (the type layer is untouched)", () => {
    const src = "function f(a: number): boolean { return a >= 18; }";
    const report = mutateReport(src, { seed: 1 });
    const ops = new Set(report.mutants.map((m) => m.operator));
    expect(ops.has("flip-operator")).toBe(true);
    expect(ops.has("wipe-number")).toBe(true);
  });

  it("still rejects true syntax errors with a thrown error", () => {
    expect(() => mutate("function f( {")).toThrow();
  });
});

describe("mutate — syntax errors surface as thrown errors", () => {
  it("throws on invalid input so the UI can show an inline error", () => {
    expect(() => mutate("function f( {")).toThrow();
  });
});
