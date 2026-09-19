/**
 * POST /api/generate — the app's ONLY server-side piece.
 *
 * Why a proxy: the browser must never see an API key. Why it stays small: the
 * mutation engine, scoring, validation gate and evidence all run client-side;
 * this endpoint only asks a model for test expressions.
 *
 * Runtime note: Vercel's Node.js runtime passes an IncomingMessage /
 * ServerResponse (NOT the Web Request/Response pair), so the handler reads the
 * body off the stream and writes with res.end.
 *
 * Guardrails (stated in the README, not hidden):
 * - per-IP rate limit: 6 requests / minute, 30 / hour (in-memory, per-instance)
 * - payload caps: code <= 4000 chars, at most 8 existing tests echoed back
 * - max_tokens 2500 (reasoning models spend budget before answering), temperature 0.2,
 *   strict JSON instruction
 * - any failure returns a JSON error the client turns into its offline path
 */

import type { IncomingMessage, ServerResponse } from "node:http";

interface Bucket {
  minuteCount: number;
  minuteWindow: number;
  hourCount: number;
  hourWindow: number;
}

const buckets = new Map<string, Bucket>();
const MINUTE_LIMIT = 6;
const HOUR_LIMIT = 30;
/**
 * Platform-wide ceiling, independent of the per-IP bucket. The per-IP limiter is
 * best-effort (see clientIp); this bounds the total cost an attacker can cause
 * even if they rotate whatever identifier the limiter keys on.
 */
const GLOBAL_HOUR_LIMIT = 150;
let globalHourCount = 0;
let globalHourWindow = 0;

function rateLimited(ip: string, now: number): boolean {
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
  if (now - globalHourWindow > 3_600_000) {
    globalHourWindow = now;
    globalHourCount = 0;
  }
  globalHourCount++;
  return (
    b.minuteCount > MINUTE_LIMIT ||
    b.hourCount > HOUR_LIMIT ||
    globalHourCount > GLOBAL_HOUR_LIMIT
  );
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > 64 * 1024) throw new Error("body too large");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length === 0 ? {} : JSON.parse(raw);
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Best-effort client identity for rate limiting.
 *
 * `x-forwarded-for` is client-appendable, so its FIRST value is attacker
 * controlled and a rotating header defeats a naive limiter. Prefer
 * `x-real-ip`, which the platform sets, and otherwise take the LAST
 * x-forwarded-for entry (appended by the closest trusted proxy). This is still
 * best-effort — it is a quota guard, not a security boundary, and the global
 * ceiling exists because of exactly that.
 */
export function clientIp(req: IncomingMessage): string {
  const real = headerValue(req, "x-real-ip");
  if (real && real.trim() !== "") return real.trim();
  const forwarded = headerValue(req, "x-forwarded-for");
  if (!forwarded) return "unknown";
  const parts = forwarded.split(",").map((p) => p.trim()).filter((p) => p !== "");
  return parts.length > 0 ? (parts[parts.length - 1] as string) : "unknown";
}

/** Pull a JSON array of test expressions out of model output. */
export function extractTests(content: string): string[] {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? (fence[1] as string) : content;
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
    // not JSON — fall through
  }
  return [];
}

/**
 * Defensive normalisation. A key pasted through a shell or UI commonly arrives
 * with a trailing newline, surrounding whitespace, or a literal pair of quotes
 * — all of which make an otherwise valid credential fail. Strip them here so a
 * paste artifact never masquerades as a bad key.
 */
export function normalizeKey(raw: string | undefined): string {
  if (!raw) return "";
  let k = raw.trim();
  const quoted =
    (k.startsWith("'") && k.endsWith("'")) ||
    (k.startsWith('"') && k.endsWith('"'));
  if (quoted && k.length > 1) k = k.slice(1, -1).trim();
  return k.replace(/[\r\n\t]/g, "");
}

const SYSTEM = [
  "You write JavaScript test expressions for a function under test.",
  "Each test is ONE boolean expression, self-contained, calling the function",
  "by the name defined in the user's code. Use only comparisons and arithmetic",
  "on literals. No imports, no variables, no helper functions, no console.log.",
  "Target boundary values and edge cases that catch small logic bugs:",
  "off-by-one comparisons, wrong constants, dropped guards, sign errors.",
  'Reply with ONLY a JSON object: {"tests": ["expr", ...]} with 6-10 tests.',
].join(" ");

const SYSTEM_TARGETED = [
  "You write ONE JavaScript test expression that kills a specific surviving mutant.",
  "A mutant is the original code with one small change. Your test must evaluate",
  "to TRUE on the ORIGINAL code and FALSE on the MUTANT, so it distinguishes them.",
  "The test is one boolean expression, self-contained, calling the function by the",
  "name defined in the original code. Only comparisons and arithmetic on literals.",
  'Reply with ONLY a JSON object: {"tests": ["expr"]} — exactly one test.',
].join(" ");

export const config = { maxDuration: 30 };

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    send(res, 405, { error: "method not allowed" });
    return;
  }

  const ip = clientIp(req);
  if (rateLimited(ip, Date.now())) {
    send(res, 429, { error: "rate limited" });
    return;
  }

  const key = normalizeKey(process.env.FIREWORKS_API_KEY);
  if (!key) {
    send(res, 503, { error: "generation unavailable (no key configured)" });
    return;
  }

  let payload: { code?: unknown; existingTests?: unknown };
  try {
    payload = (await readJsonBody(req)) as {
      code?: unknown;
      existingTests?: unknown;
    };
  } catch {
    send(res, 400, { error: "bad json" });
    return;
  }

  const code = typeof payload.code === "string" ? payload.code : "";
  const existing = Array.isArray(payload.existingTests)
    ? payload.existingTests.filter((t): t is string => typeof t === "string")
    : [];
  // Optional targeted mode: the exact mutant that survived, so the model writes
  // a test that would kill THAT one. Turned into a focused system prompt below.
  const targetMutant =
    typeof (payload as Record<string, unknown>)["targetMutant"] === "object" &&
    (payload as Record<string, unknown>)["targetMutant"] !== null
      ? ((payload as Record<string, unknown>)["targetMutant"] as Record<string, unknown>)
      : undefined;
  if (code.length === 0) {
    send(res, 400, { error: "code required" });
    return;
  }
  if (code.length > 4000) {
    send(res, 413, { error: "code too long" });
    return;
  }

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
            "accounts/fireworks/models/kimi-k2p6",
          max_tokens: 2500,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: targetMutant ? SYSTEM_TARGETED : SYSTEM,
            },
            {
              role: "user",
              content: targetMutant
                ? `Original code:\n\n${code}\n\n` +
                  `Surviving mutant (your test must FAIL on this):\n\n${String(targetMutant["code"] ?? "").slice(0, 4000)}\n\n` +
                  `The change: ${String(targetMutant["description"] ?? "")}.\n\n` +
                  'Return {"tests": ["expr"]} — one test that passes on the original and fails on the mutant.'
                : `Function under test:\n\n${code}\n\n` +
                  (existing.length > 0
                    ? `Existing tests (write NEW ones, do not repeat these):\n${existing
                        .slice(0, 8)
                        .join("\n")}\n\n`
                    : "") +
                  'Return {"tests": [...]} now.',
            },
          ],
        }),
      },
    );

    if (!upstream.ok) {
      // Include the upstream reason so a misconfigured key is diagnosable
      // instead of surfacing as a bare status code. Fireworks error bodies
      // never echo the credential.
      let detail = "";
      try {
        const text = await upstream.text();
        detail = text.slice(0, 240).replace(/\s+/g, " ");
      } catch {
        detail = "(no body)";
      }
      send(res, 502, { error: `upstream ${upstream.status}`, detail });
      return;
    }
    const data: unknown = await upstream.json();
    let content: unknown;
    let finishReason: unknown;
    let usage: unknown;
    if (
      typeof data === "object" &&
      data !== null &&
      Array.isArray((data as Record<string, unknown>)["choices"])
    ) {
      const rec = data as Record<string, unknown>;
      const choice = (rec["choices"] as Record<string, unknown>[])[0];
      finishReason = choice?.["finish_reason"];
      usage = rec["usage"];
      const message = choice?.["message"];
      if (typeof message === "object" && message !== null) {
        const msg = message as Record<string, unknown>;
        content = msg["content"];
        // Some reasoning models emit `reasoning_content` and leave `content`
        // empty when the token budget is consumed by reasoning.
        if ((typeof content !== "string" || content.trim() === "") &&
            typeof msg["reasoning_content"] === "string") {
          content = msg["reasoning_content"];
        }
      }
    }
    if (typeof content !== "string") {
      send(res, 502, {
        error: "no content from upstream",
        detail: JSON.stringify({ finishReason, usage }).slice(0, 240),
      });
      return;
    }
    const tests = extractTests(content);
    if (tests.length === 0) {
      send(res, 502, {
        error: "could not parse tests",
        detail:
          `finish=${String(finishReason)} ` +
          content.slice(0, 400).replace(/\s+/g, " "),
      });
      return;
    }
    send(res, 200, { tests: tests.slice(0, 12) });
  } catch (e) {
    send(res, 502, {
      error: e instanceof Error ? e.message : "generation failed",
    });
  }
}
