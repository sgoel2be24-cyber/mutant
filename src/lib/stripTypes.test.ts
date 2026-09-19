import { describe, expect, it } from "vitest";
import { stripTypes } from "./stripTypes";
import { parse } from "acorn";

describe("stripTypes", () => {
  it("passes plain JavaScript through unchanged", () => {
    const src = "function f(a) { return a + 1; }";
    expect(stripTypes(src)).toBe(src);
  });

  it("removes parameter and return type annotations", () => {
    const out = stripTypes("function add(a: number, b: number): number { return a + b; }");
    expect(out).toBe("function add(a, b) { return a + b; }");
    expect(() => parse(out, { ecmaVersion: "latest" })).not.toThrow();
  });

  it("removes generics", () => {
    const out = stripTypes("function first<T>(xs: T[]): T | undefined { return xs[0]; }");
    expect(out).not.toContain("<T>");
    expect(() => parse(out, { ecmaVersion: "latest" })).not.toThrow();
  });

  it("removes as-casts but keeps the expression", () => {
    const out = stripTypes("function f(x: number): number { const v = x as number; return v * 2; }");
    expect(out).toContain("const v = x;");
    expect(out).not.toContain("as number");
    expect(() => parse(out, { ecmaVersion: "latest" })).not.toThrow();
  });

  it("removes interface declarations entirely", () => {
    const out = stripTypes("interface P { price: number } function total(p: P): number { return p.price; }");
    expect(out).not.toContain("interface");
    expect(() => parse(out, { ecmaVersion: "latest" })).not.toThrow();
  });

  it("removes non-null assertions", () => {
    const out = stripTypes("function f(x: number | undefined): number { return x! + 1; }");
    expect(out).toContain("return x + 1");
    expect(() => parse(out, { ecmaVersion: "latest" })).not.toThrow();
  });

  it("produces runnable JS for the GST typed example", () => {
    const ts = "function gstRate(amount: number): number { if (amount < 1000) return 0; if (amount <= 5000) return 5; return 18; }";
    const js = stripTypes(ts);
    const fn = new Function(js + "\n;return gstRate(20000);")();
    expect(fn).toBe(18);
  });
});
