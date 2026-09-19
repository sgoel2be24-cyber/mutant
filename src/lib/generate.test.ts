import { describe, expect, it } from "vitest";
import { extractTestsFromText, parseTests } from "./generate";

describe("parseTests", () => {
  it("accepts a direct {tests:[...]} payload", () => {
    expect(parseTests({ tests: ["f(1) === 2"] })).toEqual(["f(1) === 2"]);
  });

  it("accepts an OpenAI-ish choices payload and extracts tests from content", () => {
    const payload = {
      choices: [
        {
          message: {
            content: '```json\n["gstRate(1000) === 5", "gstRate(0) === 0"]\n```',
          },
        },
      ],
    };
    expect(parseTests(payload)).toEqual([
      "gstRate(1000) === 5",
      "gstRate(0) === 0",
    ]);
  });

  it("returns [] for junk", () => {
    expect(parseTests(null)).toEqual([]);
    expect(parseTests("nope")).toEqual([]);
    expect(parseTests({ tests: "not-an-array" })).toEqual([]);
  });
});

describe("extractTestsFromText", () => {
  it("parses a fenced JSON array", () => {
    expect(
      extractTestsFromText('Here you go:\n```json\n["a() === 1"]\n```'),
    ).toEqual(["a() === 1"]);
  });

  it("parses a bare JSON object with a tests key", () => {
    expect(extractTestsFromText('{"tests": ["b() > 2"]}')).toEqual(["b() > 2"]);
  });

  it("scans line-by-line as a last resort, skipping comments", () => {
    const text = "// these are tests\ngstRate(999) === 0\nplain prose line without tests\nf(2) !== 3";
    expect(extractTestsFromText(text)).toEqual([
      "gstRate(999) === 0",
      "f(2) !== 3",
    ]);
  });
});
