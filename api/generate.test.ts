import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { clientIp, extractTests, normalizeKey } from "./generate";

const req = (headers: Record<string, string | string[]>): IncomingMessage =>
  ({ headers }) as unknown as IncomingMessage;

describe("clientIp — rate-limit identity is not attacker-controlled", () => {
  it("prefers the platform-set x-real-ip", () => {
    expect(
      clientIp(req({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" })),
    ).toBe("203.0.113.9");
  });

  it("takes the LAST x-forwarded-for entry, not the spoofable first", () => {
    // A client can prepend entries; the closest trusted proxy appends the real
    // one, so the tail is the value worth trusting.
    expect(
      clientIp(req({ "x-forwarded-for": "9.9.9.9, 10.0.0.1, 203.0.113.7" })),
    ).toBe("203.0.113.7");
  });

  it("survives a spoof attempt that only prepends", () => {
    const spoofed = clientIp(req({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }));
    const honest = clientIp(req({ "x-forwarded-for": "203.0.113.7" }));
    expect(spoofed).toBe(honest);
  });

  it("handles array header values and missing headers", () => {
    expect(clientIp(req({ "x-real-ip": ["203.0.113.5", "10.0.0.1"] }))).toBe("203.0.113.5");
    expect(clientIp(req({}))).toBe("unknown");
    expect(clientIp(req({ "x-forwarded-for": "" }))).toBe("unknown");
  });
});

describe("normalizeKey — a paste artifact must not masquerade as a bad key", () => {
  it("strips whitespace and newlines", () => {
    expect(normalizeKey("  fw_abc123\n")).toBe("fw_abc123");
    expect(normalizeKey("fw_abc123\r\n")).toBe("fw_abc123");
  });

  it("strips a matching pair of surrounding quotes", () => {
    expect(normalizeKey("'fw_abc123'")).toBe("fw_abc123");
    expect(normalizeKey('"fw_abc123"')).toBe("fw_abc123");
    expect(normalizeKey(" 'fw_abc123' ")).toBe("fw_abc123");
  });

  it("leaves an unquoted key intact and handles empties", () => {
    expect(normalizeKey("fw_abc123")).toBe("fw_abc123");
    expect(normalizeKey(undefined)).toBe("");
    expect(normalizeKey("")).toBe("");
  });
});

describe("extractTests — model output parsing", () => {
  it("reads a fenced JSON array", () => {
    expect(extractTests('ok:\n```json\n["f(1) === 2"]\n```')).toEqual(["f(1) === 2"]);
  });

  it("reads a bare object with a tests key", () => {
    expect(extractTests('{"tests": ["g() > 0"]}')).toEqual(["g() > 0"]);
  });

  it("returns [] on prose (the client then falls back to its curated suite)", () => {
    expect(extractTests("I could not do that.")).toEqual([]);
  });
});
