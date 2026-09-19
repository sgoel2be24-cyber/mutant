/**
 * Test generation. Primary path: the app's own rate-limited serverless proxy
 * (never exposes a key to the client). Fallback path: the curated strong suite
 * so the full demo loop works with zero API dependency — important because
 * the deployed link may be opened by a judge days later, unattended.
 */

import type { Example } from "./samples";

export interface GeneratedSuite {
  readonly source: "llm" | "fallback";
  readonly tests: readonly string[];
  readonly note?: string;
}

/** One test aimed at a single surviving mutant. */
export interface TargetedTest {
  readonly tests: readonly string[];
  readonly note?: string;
}

export async function generateTests(
  code: string,
  existingTests: readonly string[],
  example: Example | undefined,
): Promise<GeneratedSuite> {
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, existingTests }),
    });
    if (!res.ok) throw new Error(`generate failed: ${res.status}`);
    const data: unknown = await res.json();
    const tests = parseTests(data);
    if (tests.length === 0) throw new Error("no tests parsed");
    return { source: "llm", tests };
  } catch (e) {
    if (example) {
      return {
        source: "fallback",
        tests: example.strongTests,
        note:
          "Loaded the curated boundary suite — the model path needs an API key " +
          "in this deployment, so the demo stays fully functional without one. " +
          "(reason: unavailable)",
      };
    }
    throw e;
  }
}

/**
 * Ask the model for a single test that kills ONE specific surviving mutant.
 * The test must pass on the original and fail on the mutant, so it is checked
 * against both before the UI accepts it.
 */
export async function generateTargetedTest(
  code: string,
  existingTests: readonly string[],
  mutant: { code: string; description: string },
): Promise<TargetedTest> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, existingTests, targetMutant: mutant }),
  });
  if (!res.ok) throw new Error(`targeted generate failed: ${res.status}`);
  const data: unknown = await res.json();
  const tests = parseTests(data);
  if (tests.length === 0) throw new Error("no targeted test parsed");
  return { tests };
}

/** Accept {tests:[...]} or {choices:[{message:{content}}]} JSON-ish payloads. */
export function parseTests(data: unknown): string[] {
  if (typeof data !== "object" || data === null) return [];
  const rec = data as Record<string, unknown>;
  if (Array.isArray(rec["tests"])) {
    return rec["tests"].filter((t): t is string => typeof t === "string");
  }
  let content: unknown = rec["content"];
  if (content === undefined && Array.isArray(rec["choices"])) {
    const first = (rec["choices"] as Record<string, unknown>[])[0];
    if (first !== undefined && typeof first["message"] === "object" && first["message"] !== null) {
      content = (first["message"] as Record<string, unknown>)["content"];
    }
  }
  if (typeof content !== "string") return [];
  return extractTestsFromText(content);
}

/** Pull test expression strings out of model prose/JSON fences. */
export function extractTestsFromText(text: string): string[] {
  // direct JSON array inside a code fence, or the whole text if no fence
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? (fence[1] as string) : text;
  try {
    const parsed: unknown = JSON.parse(body.trim());
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === "string");
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as Record<string, unknown>)["tests"])
    ) {
      return ((parsed as Record<string, unknown>)["tests"] as unknown[]).filter(
        (t): t is string => typeof t === "string",
      );
    }
  } catch {
    // fall through to per-line scanning
  }
  const out: string[] = [];
  const lines = body.split("\n");
  for (const rawLine of lines) {
    const t = rawLine.trim().replace(/;+$/, "");
    if (t.length === 0 || t.length >= 200) continue;
    if (!/[()=<>!]/.test(t)) continue;
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("-")) continue;
    out.push(t);
  }
  return out;
}
