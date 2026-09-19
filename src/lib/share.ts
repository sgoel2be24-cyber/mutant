/**
 * Shareable run state, encoded into the URL hash.
 *
 * Design rule: the demo is client-side and the deployment may be opened days
 * later, so a share link must not depend on a database, a server route, or an
 * expiring token. State goes in the hash (never sent to the server, never
 * logged), base64url-encoded UTF-8. Anyone opening the link gets the same
 * function and tests, and re-runs it live — the score is recomputed, not
 * replayed, so a shared link is a live reproduction, not a screenshot.
 */

export interface ShareState {
  readonly code: string;
  readonly tests: readonly string[];
  /** "gst" | "latefee" when it matches a curated example, else "custom". */
  readonly exampleId: string;
  /** The score the sender saw, for the preview caption. Recomputed on open. */
  readonly scorePercent: number;
}

export function encodeShare(state: ShareState): string {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShare(hash: string): ShareState | null {
  if (!hash.startsWith("#run=")) return null;
  try {
    const b64 = hash.slice(5).replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const v: unknown = JSON.parse(json);
    if (typeof v !== "object" || v === null) return null;
    const rec = v as Record<string, unknown>;
    if (typeof rec["code"] !== "string") return null;
    if (!Array.isArray(rec["tests"])) return null;
    if (typeof rec["scorePercent"] !== "number") return null;
    return {
      code: rec["code"],
      tests: rec["tests"].filter((t): t is string => typeof t === "string"),
      exampleId: typeof rec["exampleId"] === "string" ? rec["exampleId"] : "custom",
      scorePercent: rec["scorePercent"],
    };
  } catch {
    return null;
  }
}

/** A link that fits in a form field; rejects unreasonably large states. */
export function buildShareUrl(state: ShareState, base?: string): string | null {
  const origin = base ?? (typeof window !== "undefined" ? window.location.origin + window.location.pathname : "");
  const encoded = encodeShare(state);
  const url = `${origin}#run=${encoded}`;
  // Browsers handle long hashes, but keep it sane: beyond ~8k the link is a
  // poor artifact to hand to a judge.
  return url.length <= 8192 ? url : null;
}

export function readShareFromLocation(): ShareState | null {
  if (typeof window === "undefined") return null;
  return decodeShare(window.location.hash);
}

export function clearShareFromLocation(): void {
  if (typeof window === "undefined") return;
  history.replaceState(null, "", window.location.pathname + window.location.search);
}
