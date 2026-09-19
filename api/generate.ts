/**
 * POST /api/generate — the app's ONLY server-side piece.
 *
 * Why a proxy at all: the browser must never see an API key. Why it stays
 * small: the mutation engine, scoring, validation gate and evidence all run
 * client-side; this endpoint just asks a model for test expressions.
 *
 * Guardrails (deliberate, stated in the README):
 * - per-IP rate limit: 6 requests / minute, 30 / hour (in-memory; per-instance)
 * - payload caps: code <= 4000 chars, <= 50 existing tests, <= 8 sent
 * - max_tokens 700, temperature 0.2, JSON-shaped instruction
 * - failures return 502/429 JSON the client turns into the fallback path
 */

type Ip = string;

interface Bucket {
  minuteCount: number;
  minuteWindow: number;
  hourCount: number;
  hourWindow: number;
}

const buckets = new Map<Ip, Bucket>();
const MINUTE_LIMIT = 6;
const HOUR_LIMIT = 30;

function rateLimited(ip: Ip, now: number): boolean {
  let b = buckets.get(ip);
  if (!b) {
    b = { minuteCount: 0, minuteWindow: now, hourCount: 0, hourWindow: now };
    buckets.set(ip, b);
  }
  if (now - b.minuteWindow > 60_000) {
    b.minuteWindow = now;
    b.minuteCount = 0;
  }
  if (now - b.hourWindow > 3_600_000) {
    b.hourWindow = now;
    b.hourCount = 0;
  }
  b.minuteCount++;
  b.hourCount++;
  return b.minuteCount > MINUTE_LIMIT || b.hourCount > HOUR_LIMIT;
}

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const SYSTEM = [
  "You write JavaScript test expressions for a function under test.",
  "Each test is ONE boolean expression, self-contained, calling the function",
  "by the name defined in the user's code. Use only ===/!== comparisons and",
  "arithmetic on literals. No imports, no variables, no helper functions, no",
  "console.log. Target boundary values and edge cases that would catch small",
  "logic bugs (off-by-one, flipped operators, wrong constants).",
  "Reply with ONLY a JSON object: {\"tests\": [\"expr\", ...]} with 6-10 tests.",
].join(" ");

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "method not allowed" });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip, Date.now())) {
    return json(429, { error: "rate limited" });
  }

  const key = process.env.FIREWORKS_API_KEY;
  if (!key) {
    return json(503, { error: "generation unavailable (no key configured)" });
  }

  let payload: { code?: unknown; existingTests?: unknown };
  try {
    payload = (await req.json()) as { code?: unknown; existingTests?: unknown };
  } catch {
    return json(400, { error: "bad json" });
  }

  const code = typeof payload.code === "string" ? payload.code : "";
  const existing = Array.isArray(payload.existingTests)
    ? payload.existingTests.filter((t): t is string => typeof t === "string")
    : [];
  if (code.length === 0) return json(400, { error: "code required" });
  if (code.length > 4000) return json(413, { error: "code too long" });

  try {
    const upstream = await fetch(
      "https://api.fireworks.ai/inference/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model:
            process.env.FIREWORKS_MODEL ??
            "accounts/fireworks/models/kimi-k2p6-instruct",
          max_tokens: 700,
          temperature: 0.2,
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content:
                `Function under test:\n\n${code}\n\n` +
                (existing.length > 0
                  ? `Existing tests (write NEW ones, do not repeat these):\n${existing
                      .slice(0, 8)
                      .join("\n")}\n\n`
                  : "") +
                `Return {"tests": [...]} now.`,
            },
          ],
        }),
      },
    );

    if (!upstream.ok) {
      return json(502, { error: `upstream ${upstream.status}` });
    }
    const data: unknown = await upstream.json();
    const content =
      typeof data === "object" && data !== null &&
      Array.isArray((data as Record<string, unknown>)["choices"])
        ? ((data as Record<string, { message?: { content?: unknown } }[]>)["choices"][0]?.["message"]?.["content"])
        : undefined;
    if (typeof content !== "string") {
      return json(502, { error: "no content from upstream" });
    }
    // Extract tests server-side too; client re-validates and gates anyway.
    const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fence ? (fence[1] as string) : content;
    let tests: string[] = [];
    try {
      const parsed: unknown = JSON.parse(body.trim());
      if (Array.isArray(parsed)) {
        tests = parsed.filter((t): t is string => typeof t === "string");
      } else if (
        typeof parsed === "object" && parsed !== null &&
        Array.isArray((parsed as Record<string, unknown>)["tests"])
      ) {
        tests = ((parsed as Record<string, unknown>)["tests"] as unknown[]).filter(
          (t): t is string => typeof t === "string",
        );
      }
    } catch {
      tests = [];
    }
    if (tests.length === 0) return json(502, { error: "could not parse tests" });
    return json(200, { tests: tests.slice(0, 12) });
  } catch (e) {
    return json(502, {
      error: e instanceof Error ? e.message : "generation failed",
    });
  }
}
