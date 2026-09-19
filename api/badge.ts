/**
 * GET /api/badge?state=<base64url> — a shields-style SVG badge of a mutation
 * score. The score is NOT stored anywhere: it is decoded from the same share
 * hash the app produces, so the badge is evidence for a run the owner actually
 * produced, not a number anyone can type into a URL.
 */

interface ShareState {
  code: string;
  tests: string[];
  exampleId: string;
  scorePercent: number;
}

function decodeState(raw: string): ShareState | null {
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    const v: unknown = JSON.parse(json);
    if (typeof v !== "object" || v === null) return null;
    const rec = v as Record<string, unknown>;
    if (typeof rec["scorePercent"] !== "number") return null;
    return {
      code: String(rec["code"] ?? ""),
      tests: Array.isArray(rec["tests"]) ? (rec["tests"] as string[]) : [],
      exampleId: String(rec["exampleId"] ?? "custom"),
      scorePercent: Math.max(0, Math.min(100, Math.round(rec["scorePercent"]))),
    };
  } catch {
    return null;
  }
}

function colorFor(score: number): string {
  if (score >= 90) return "#34d399";
  if (score >= 70) return "#6ee7b7";
  if (score >= 50) return "#fbbf24";
  return "#f87171";
}

export const config = { maxDuration: 10 };

export default function handler(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void {
  const url = new URL(req.url ?? "", "http://localhost");
  const raw = url.searchParams.get("state");
  const state = raw ? decodeState(raw) : null;

  const label = "mutation score";
  const value = state ? `${state.scorePercent}%` : "unknown";
  const color = state ? colorFor(state.scorePercent) : "#8c95ad";

  const lw = 7 + label.length * 6.4;
  const vw = 7 + value.length * 7.2;
  const width = Math.ceil(lw + vw);
  const labelWidth = Math.ceil(lw);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}: ${value}">` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#3a4152" stop-opacity=".12"/><stop offset="1" stop-opacity=".12"/></linearGradient>` +
    `<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#0f1017"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${labelWidth}" height="20" fill="#131722"/><rect x="${labelWidth}" width="${Math.ceil(vw)}" height="20" fill="${color}"/><rect width="${width}" height="20" fill="url(#s)"/></g>` +
    `<g fill="#e8ecf6" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">` +
    `<text x="${labelWidth / 2}" y="15" fill="#e8ecf6" fill-opacity=".9">${label}</text>` +
    `<text x="${labelWidth + vw / 2 - 1}" y="15" fill="#07080c" font-weight="700">${value}</text>` +
    `</g></svg>`;

  res.statusCode = 200;
  res.setHeader("content-type", "image/svg+xml; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=300");
  res.end(svg);
}
