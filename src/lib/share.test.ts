import { describe, expect, it } from "vitest";
import { decodeShare, encodeShare, buildShareUrl } from "./share";

const state = {
  code: "function f(a) { return a + -5; }",
  tests: ["f(1) === -4", "f(0) === -5"],
  exampleId: "custom",
  scorePercent: 100,
};

describe("share codec", () => {
  it("round-trips a run through the hash", () => {
    const encoded = encodeShare(state);
    const decoded = decodeShare("#run=" + encoded);
    expect(decoded).toEqual(state);
  });

  it("survives URL-unsafe characters in code", () => {
    const tricky = { ...state, code: "function f(s) { return `v=${s}` && s === 'a/b+c?d'; }" };
    const decoded = decodeShare("#run=" + encodeShare(tricky));
    expect(decoded?.code).toBe(tricky.code);
  });

  it("rejects junk and wrong prefixes", () => {
    expect(decodeShare("")).toBeNull();
    expect(decodeShare("#nope")).toBeNull();
    expect(decodeShare("#run=!!!")).toBeNull();
    expect(decodeShare("#run=" + btoa('{"code":1}'))).toBeNull();
  });

  it("builds a URL, or null when the state is too large to be a good artifact", () => {
    const url = buildShareUrl(state, "https://mutant-omega.vercel.app/");
    expect(url).toMatch(/^https:\/\/mutant-omega\.vercel\.app\/#run=/);
    const huge = { ...state, code: "x".repeat(20000) };
    expect(buildShareUrl(huge, "https://mutant-omega.vercel.app/")).toBeNull();
  });
});
