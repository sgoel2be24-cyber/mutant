import { describe, expect, it } from "vitest";
import { mulberry32, seededShuffle } from "./prng";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it("stays in [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("seededShuffle", () => {
  it("returns a permutation — same elements, possibly reordered", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = seededShuffle(items, 99);
    expect([...out].sort((x, y) => x - y)).toEqual(items);
  });

  it("never mutates the input", () => {
    const items = [1, 2, 3];
    seededShuffle(items, 5);
    expect(items).toEqual([1, 2, 3]);
  });

  it("is deterministic per seed", () => {
    expect(seededShuffle([1, 2, 3, 4, 5], 11)).toEqual(
      seededShuffle([1, 2, 3, 4, 5], 11),
    );
  });

  it("shuffles at least sometimes across seeds", () => {
    const items = [1, 2, 3, 4, 5, 6];
    const results = new Set(
      [1, 2, 3, 4, 5].map((s) => seededShuffle(items, s).join(",")),
    );
    expect(results.size).toBeGreaterThan(1);
  });

  it("handles the empty array", () => {
    expect(seededShuffle([], 3)).toEqual([]);
  });
});
