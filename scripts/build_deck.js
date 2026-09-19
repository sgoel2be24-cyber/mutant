// Rebuild: in any temp dir, `npm i pptxgenjs`, then `node scripts/build_deck.js deck/Mutant-HackDevengers2.pptx`.
// The script fails (exit 1) if its conservative text-fit estimate predicts any overflow.
// Short judge-facing deck for Mutant. 6 slides, dark theme matching the live site.
const pptxgen = require("pptxgenjs");
const out = process.argv[2];

const C = {
  bg: "07080C", panel: "0E1017", panel2: "131722", border: "232838",
  fg: "E8ECF6", muted: "8C95AD", accent: "6EE7B7", accentDim: "0F3B31",
  danger: "F87171", dangerDim: "2A1414",
};
const SANS = "Arial";
const MONO = "Courier New";
const W = 13.333, M = 0.6;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.title = "Mutant — Tests That Prove Themselves";

// ---- fit check (no renderer available): conservative Arial width estimate ----
const problems = [];
function checkFit(label, text, wIn, hIn, pt, { mono = false, lineH = 1.25, pad = 0.1 } = {}) {
  const charW = (mono ? 0.6 : 0.53) * pt; // pt per char, conservative
  const usable = (wIn - 2 * pad) * 72;
  let lines = 0;
  for (const para of String(text).split("\n")) {
    const words = para.split(" ");
    let cur = 0, l = 1;
    for (const w of words) {
      const len = (w.length + 1) * charW;
      if (cur + len > usable && cur > 0) { l++; cur = len; } else cur += len;
    }
    lines += l;
  }
  const need = (lines * pt * lineH) / 72 + 2 * pad;
  if (need > hIn) problems.push(`${label}: needs ${need.toFixed(2)}in, box ${hIn}in (${lines} lines)`);
}
function text(slide, label, t, o) {
  const plain = Array.isArray(t) ? t.map((r) => r.text + (r.options?.breakLine ? "\n" : "")).join("") : t;
  if (!o.noCheck) checkFit(label, plain, o.w, o.h, o.fontSize, { mono: o.fontFace === MONO, pad: o.margin === 0 ? 0 : 0.1 });
  const { noCheck, ...opts } = o;
  slide.addText(t, { isTextBox: true, fontFace: SANS, color: C.fg, valign: "top", ...opts });
}
function panel(slide, x, y, w, h, { fill = C.panel, line = C.border } = {}) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: line, width: 1 },
  });
}
function badge(slide, n, x, y, d = 0.55) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: C.accent }, line: { color: C.accent } });
  slide.addText(String(n), {
    isTextBox: true, x, y, w: d, h: d, align: "center", valign: "middle", margin: 0,
    fontFace: SANS, fontSize: 18, bold: true, color: C.bg,
  });
}
function newSlide() {
  const s = pres.addSlide();
  s.background = { color: C.bg };
  return s;
}
function title(s, t, sub) {
  text(s, "title", t, { x: M, y: 0.45, w: W - 2 * M, h: 0.8, fontSize: 34, bold: true, margin: 0 });
  if (sub) text(s, "subtitle", sub, { x: M, y: 1.22, w: W - 2 * M, h: 0.45, fontSize: 16, color: C.muted, margin: 0 });
}

// ---------------------------------------------------------------- 1 · title
{
  const s = newSlide();
  text(s, "eyebrow", "HACKDEVENGERS 2.0  ·  OPEN INNOVATION  ·  SOLO BUILD, 24H", {
    x: M, y: 0.6, w: 8, h: 0.35, fontSize: 12, fontFace: MONO, color: C.muted, charSpacing: 2, margin: 0,
  });
  text(s, "name", "Mutant", { x: M, y: 1.1, w: 6.6, h: 1.2, fontSize: 64, bold: true, margin: 0 });
  text(s, "tagline", [
    { text: "Your tests are ", options: { color: C.fg } },
    { text: "lying to you.", options: { color: C.accent } },
  ], { x: M, y: 2.35, w: 6.9, h: 0.7, fontSize: 30, bold: true, margin: 0 });
  text(s, "hook",
    "AI writes more and more of our tests. Who checks them? Mutant plants real bugs in your code and proves which ones your tests miss — then an AI writes tests that catch them, and Mutant checks every one.",
    { x: M, y: 3.25, w: 6.4, h: 1.9, fontSize: 18, color: C.muted, margin: 0, lineSpacingMultiple: 1.1 });

  // result card
  const cx = 7.65, cy = 1.35, cw = 5.08, ch = 3.6;
  panel(s, cx, cy, cw, ch);
  text(s, "card label", "MUTATION SCORE · SAME FUNCTION", {
    x: cx + 0.35, y: cy + 0.35, w: cw - 0.7, h: 0.35, fontSize: 12, fontFace: MONO, color: C.muted, charSpacing: 1, margin: 0,
  });
  text(s, "before", "35%", { x: cx + 0.35, y: cy + 0.85, w: 1.9, h: 1.1, fontSize: 54, bold: true, color: C.danger, margin: 0 });
  text(s, "arrow", "→", { x: cx + 2.1, y: cy + 0.95, w: 0.6, h: 0.9, fontSize: 36, color: C.muted, margin: 0, noCheck: true });
  text(s, "after", "100%", { x: cx + 2.7, y: cy + 0.85, w: 2.2, h: 1.1, fontSize: 54, bold: true, color: C.accent, margin: 0 });
  text(s, "card body",
    "One passing test let 11 of 17 planted bugs through. After 8 AI-written tests, all 17 are caught — measured live, not claimed.",
    { x: cx + 0.35, y: cy + 2.15, w: cw - 0.7, h: 1.25, fontSize: 14, color: C.fg, margin: 0 });

  text(s, "links", "mutant-omega.vercel.app     ·     github.com/sgoel2be24-cyber/mutant", {
    x: M, y: 6.45, w: W - 2 * M, h: 0.4, fontSize: 14, fontFace: MONO, color: C.accent, margin: 0,
  });
  s.addNotes("Hook first: AI writes our tests now — who checks them? Then the one number: 35% to 100% on the same function.");
}

// ---------------------------------------------------------------- 2 · problem
{
  const s = newSlide();
  title(s, "A passing test suite can still miss most bugs");

  const px = M, py = 1.75, pw = 5.9;
  panel(s, px, py, pw, 2.75, { fill: C.panel2 });
  text(s, "fn label", "FUNCTION UNDER TEST", { x: px + 0.3, y: py + 0.22, w: 4, h: 0.3, fontSize: 11, fontFace: MONO, color: C.muted, margin: 0 });
  text(s, "code",
    "function gstRate(amount) {\n\u00a0\u00a0if (amount < 1000) return 0;\n\u00a0\u00a0if (amount <= 5000) return 5;\n\u00a0\u00a0if (amount > 50000) return 28;\n\u00a0\u00a0return 18;\n}",
    { x: px + 0.3, y: py + 0.6, w: pw - 0.6, h: 2.0, fontSize: 15, fontFace: MONO, margin: 0 });

  panel(s, px, py + 2.95, pw, 1.15, { fill: C.panel2 });
  text(s, "test label", "ITS TEST", { x: px + 0.3, y: py + 3.12, w: 3, h: 0.3, fontSize: 11, fontFace: MONO, color: C.muted, margin: 0 });
  text(s, "test", "gstRate(20000) === 18", { x: px + 0.3, y: py + 3.45, w: 4, h: 0.45, fontSize: 16, fontFace: MONO, margin: 0 });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: px + pw - 1.45, y: py + 3.43, w: 1.15, h: 0.42, rectRadius: 0.2,
    fill: { color: C.accentDim }, line: { color: C.accentDim },
  });
  text(s, "pass pill", "PASSES", { x: px + pw - 1.45, y: py + 3.43, w: 1.15, h: 0.42, fontSize: 12, bold: true, color: C.accent, align: "center", valign: "middle", margin: 0, noCheck: true });

  const rx = 7.25, rw = W - M - rx;
  text(s, "big stat", "11 of 17", { x: rx, y: 1.7, w: rw, h: 1.3, fontSize: 72, bold: true, color: C.danger, margin: 0 });
  text(s, "stat label", "planted bugs slip straight past this test — and it stays green.", {
    x: rx, y: 3.0, w: rw, h: 0.95, fontSize: 20, margin: 0,
  });
  text(s, "examples", "Flip < 1000 to <= 1000. Change 28 to 0. Drop a return value. None of these turn the test red.", {
    x: rx, y: 4.15, w: rw, h: 0.95, fontSize: 15, color: C.muted, margin: 0,
  });
  text(s, "coverage", "Coverage only counts lines that ran. It never asks the real question: would this test fail if the code were wrong?", {
    x: rx, y: 5.2, w: rw, h: 0.95, fontSize: 15, color: C.muted, margin: 0,
  });
  s.addNotes("This is the demo's own first example, exactly as it loads on the live site.");
}

// ---------------------------------------------------------------- 3 · how it works
{
  const s = newSlide();
  title(s, "How it works", "Four steps, all running in your browser.");
  const steps = [
    ["Plant bugs", "A hand-written AST engine flips operators, nudges boundaries, wipes constants and drops guards. Every mutant is re-parsed, so it is always valid code."],
    ["Run tests", "Each mutant runs in a disposable Web Worker with a hard timeout. Tests that fail on the original code are excluded, never counted as catches."],
    ["Show survivors", "Every bug your suite missed, as an exact diff — plus which test caught each of the others."],
    ["Verified AI fix", "A model writes tests aimed at the survivors. “Kill this mutant” keeps a test only if it passes the original and fails that exact bug."],
  ];
  const cw = 2.8, gap = 0.31, cy = 2.0, ch = 3.25;
  steps.forEach(([h, b], i) => {
    const x = M + i * (cw + gap);
    panel(s, x, cy, cw, ch, i === 3 ? { fill: C.panel, line: C.accent } : {});
    badge(s, i + 1, x + 0.3, cy + 0.3);
    text(s, `step ${i + 1} head`, h, { x: x + 0.3, y: cy + 1.0, w: cw - 0.6, h: 0.45, fontSize: 18, bold: true, margin: 0 });
    text(s, `step ${i + 1} body`, b, { x: x + 0.3, y: cy + 1.5, w: cw - 0.6, h: 1.95, fontSize: 13.5, color: C.muted, margin: 0 });
  });
  text(s, "footer", "Nothing is uploaded — engine, sandbox and scoring run in the page. The AI only writes tests; it never decides the score.", {
    x: M, y: 5.65, w: W - 2 * M, h: 0.7, fontSize: 16, margin: 0,
  });
  s.addNotes("The AI is the last step, and it is the only step that is checked by the others.");
}

// ---------------------------------------------------------------- 4 · proof
{
  const s = newSlide();
  title(s, "Measured on the live site, not claimed");
  const stats = [
    ["35% → 100%", C.accent, "GST example: 1 passing test, then 8 AI-written tests. 17 of 17 bugs caught."],
    ["~3 s", C.fg, "17 mutants generated, sandboxed and scored, entirely in the browser."],
    ["2 flagged", C.danger, "Unkillable mutants labelled “possibly equivalent”, not hidden to fake 100%."],
  ];
  const cw = 3.84, gap = 0.3, cy = 1.6, ch = 2.35;
  stats.forEach(([big, col, body], i) => {
    const x = M + i * (cw + gap);
    panel(s, x, cy, cw, ch);
    text(s, `stat ${i}`, big, { x: x + 0.3, y: cy + 0.3, w: cw - 0.6, h: 0.85, fontSize: 36, bold: true, color: col, margin: 0 });
    text(s, `stat ${i} body`, body, { x: x + 0.3, y: cy + 1.2, w: cw - 0.6, h: 1.0, fontSize: 14, color: C.muted, margin: 0 });
  });

  text(s, "honest head", "Honest scoring, enforced in code", { x: M, y: 4.3, w: 8, h: 0.45, fontSize: 20, bold: true, margin: 0 });
  const rows = [
    "Tests that fail on the original code are removed — never counted as catching a bug.",
    "Mutants that don't parse are excluded from the score, not counted as caught.",
    "110 automated tests and an adversarial audit — every defect it found is fixed and pinned by a test.",
  ];
  rows.forEach((r, i) => {
    const y = 4.9 + i * 0.58;
    s.addShape(pres.shapes.OVAL, { x: M, y: y + 0.07, w: 0.2, h: 0.2, fill: { color: C.accent }, line: { color: C.accent } });
    text(s, `honest ${i}`, r, { x: M + 0.4, y, w: W - 2 * M - 0.4, h: 0.45, fontSize: 15, margin: 0 });
  });
  s.addNotes("Every number here was re-measured on the deployed site on 20 Sep. Audit trail: AUDIT.md.");
}

// ---------------------------------------------------------------- 5 · why it stands out
{
  const s = newSlide();
  title(s, "Why it stands out");
  const cols = [
    ["Not a wrapper", "Mutation, sandboxing and scoring are hand-written. Remove the AI entirely and the product still works end to end."],
    ["AI held to account", "The model only proposes tests. Mutant checks each one against the real code — and the real bug — before trusting it."],
    ["Zero setup, shareable", "Paste JavaScript or TypeScript; works on a phone. Share links recompute live; CI export and README badge built in."],
  ];
  const cw = 3.84, gap = 0.3, cy = 1.6, ch = 3.0;
  cols.forEach(([h, b], i) => {
    const x = M + i * (cw + gap);
    panel(s, x, cy, cw, ch);
    badge(s, i + 1, x + 0.3, cy + 0.3);
    text(s, `col ${i} head`, h, { x: x + 0.3, y: cy + 1.05, w: cw - 0.6, h: 0.5, fontSize: 19, bold: true, margin: 0 });
    text(s, `col ${i} body`, b, { x: x + 0.3, y: cy + 1.6, w: cw - 0.6, h: 1.55, fontSize: 15, color: C.muted, margin: 0 });
  });
  text(s, "next head", "NEXT", { x: M, y: 5.05, w: 2, h: 0.35, fontSize: 12, fontFace: MONO, color: C.muted, charSpacing: 2, margin: 0 });
  text(s, "next", "Parallel worker pool  ·  type-aware TypeScript mutations  ·  mutate only a PR's changed lines in CI", {
    x: M, y: 5.45, w: W - 2 * M, h: 0.5, fontSize: 16, margin: 0,
  });
  s.addNotes("The differentiator is the verification loop: AI output is only trusted after the tool proves it catches a bug.");
}

// ---------------------------------------------------------------- 6 · try it
{
  const s = newSlide();
  title(s, "Try it in 60 seconds");
  text(s, "url", "mutant-omega.vercel.app", { x: M, y: 1.5, w: W - 2 * M, h: 0.9, fontSize: 44, bold: true, color: C.accent, fontFace: MONO, margin: 0 });
  const steps = [
    "Open the link — the GST example is already scored: 35%, 11 bugs survive.",
    "Click “Let AI write tests that catch them”.",
    "Watch it re-score to 100% — or hit “Kill this mutant” on one survivor.",
  ];
  steps.forEach((t, i) => {
    const y = 2.85 + i * 0.85;
    badge(s, i + 1, M, y);
    text(s, `try ${i}`, t, { x: M + 0.8, y: y + 0.07, w: W - 2 * M - 0.8, h: 0.5, fontSize: 19, margin: 0 });
  });
  text(s, "code", "Code: github.com/sgoel2be24-cyber/mutant   ·   pnpm test (110 tests)   ·   built solo within the HackDevengers 2.0 window", {
    x: M, y: 6.3, w: W - 2 * M, h: 0.45, fontSize: 13, color: C.muted, margin: 0,
  });
  s.addNotes("No install, no account. Works on a phone.");
}

if (problems.length) {
  console.error("FIT PROBLEMS:\n" + problems.join("\n"));
  process.exitCode = 1;
}
pres.writeFile({ fileName: out }).then(() => console.log("wrote", out));
