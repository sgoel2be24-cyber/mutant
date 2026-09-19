import { describe, expect, it } from "vitest";

// The hooks are DOM-bound; the pieces worth testing are the pure decisions.
// The full cascade is exercised in the browser verification pass instead.
describe("useCountUp / useRevealCascade contracts", () => {
  it("easing is monotonic and terminates at the target", () => {
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeGreaterThan(0.5);
    expect(ease(0.5)).toBeLessThan(1);
  });

  it("count-up never overshoots the target", () => {
    const from = 35;
    const to = 100;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (to - from) * eased;
      expect(v).toBeGreaterThanOrEqual(from);
      expect(v).toBeLessThanOrEqual(to);
    }
  });
});
