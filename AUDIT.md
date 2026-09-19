# Adversarial Audit — Mutant (HackDevengers 2.0) — Kimi K3 XHigh, 19 Sep 2026 ~21:00 IST

Method: read the actual engine/runner/proxy source, ran adversarial probes against both the
local engine and the live deployment. Nothing below is speculation; each finding is reproduced.

## BLOCKERS (fix before submission)

1. **Engine produces INVALID JavaScript for negative literals.** `a + -5` mutates to `a--5`
   (SyntaxError). The operator-token splice `[left.end, right.start]` only replaces the visible
   `+`/`-` token, but acorn folds unary minus into the literal's span, so `right.start` is at
   the `5`, not the `-`. The mutant string is `a` + `-` + `-5` = `a--5`.
   Evidence: probe in `src/lib/mutate.ts` operatorSpan/mutateNode; repro `mutate("function f(a){ return a + -5; }")`.
   Why a judge cares: the README says "every mutant is guaranteed to remain valid JavaScript" —
   this is false, and the runner counts the invalid mutant as KILLED (its parse fails, tests all
   "fail"), which silently inflates the score. That is the exact dishonesty the product claims to expose.
   Fix: compute `right.start` including any leading unary `-`/`+` operators (extend the span to
   include them), OR wrap replacements in parentheses `(${to})`. Also re-parse every generated
   mutant and drop any that fail to parse before scoring.

2. **Validation-gate failures are reported but NOT excluded from scoring.** `runnerClient.ts`
   runs the gate, collects `gateFailures`, and then runs ALL tests against every mutant anyway.
   The UI shows a banner but the score is computed with the broken tests included.
   Evidence: `runMutationCampaign` never filters the test list by gate outcome.
   Why a judge cares: README and the on-page copy say gate failures are "excluded from scoring."
   They are not. Overclaimed.
   Fix: in `runMutationCampaign`, after the gate run, filter `tests` to those passing on the
   original, and score mutants only against that subset; keep gateFailures in the export.

3. **A mutant that fails to PARSE is counted as "killed".** The worker's `new Function(...)`
   throws on a syntax error, every test is marked failed, status = killed. Combined with finding 1,
   invalid mutants currently *improve* the score.
   Evidence: `worker.ts` runSuite catch-block marks failed; `runnerClient.ts` status logic.
   Fix: distinguish "parse/eval error in the mutant itself" (invalid mutant → exclude from the
   denominator, or count as its own category) from "test failed" (a genuine kill).

## MAJOR

4. **Per-IP rate limit is spoofable.** `x-forwarded-for` is read from the first header value,
   which the client controls. A hostile caller rotates the header and bypasses the 6/min, 30/hour
   caps, draining the Fireworks quota.
   Fix: rate-limit on Vercel's `request.headers['x-real-ip']` or the platform-provided IP, not a
   client-supplied header; document that the limiter is best-effort, not a security boundary.

5. **The docs overclaim the token/model fix.** The reasoning-model bug (empty content at 700
   tokens) was real, but README/SUBMISSION never mention `kimi-k2p6`, the 2500-token cap, or
   `reasoning_content`. The "Built with" section is honest about the stack; the failure-mode story
   is not. A judge auditing the failure narrative will find it incomplete.

6. **`durationMs: 0` is hardcoded in every result** (`runnerClient.ts`). The export JSON claims
   per-mutant timing; it's always 0. Either measure it (performance.now around runOnce) or drop
   the field from the export so it doesn't lie.

## MINOR

7. **60-second demo is not safe on mobile.** The judge may open the link on a phone; the
   `.grid2` collapses to one column (good), but the diff `<pre>` blocks use `white-space: pre-wrap`
   with a fixed font size — long lines wrap fine, but the survivor list with 11 cards is a long
   scroll. Consider collapsing survivors by default beyond the first few.

8. **`evidence.ts` `formatMeasurement` renders a `+185.7% from baseline` delta for a 0→100
   improvement,** because percentDelta guards only a zero *divisor*, not the semantic case where
   baseline=0 means "no bugs caught at all." The evidence claim reads as a percentage change
   from nothing, which is technically undefined. It's borderline; consider hiding the delta when
   before === 0.

## What I would attack in the first 60 seconds (as a judge)
- "Show me a negative number in the input." (breaks the 'valid JS' claim)
- "Why did my broken test count toward a kill?" (gate not enforced)
- "Your score went UP when the engine made a syntax error — how is that a kill?"

## Rubric snapshot (1–10), with the weakest link
- Innovation & Originality: 8 (browser-native, honest scoring, evidence model)
- Problem-Solving Approach: 9 (validation gate + equivalent-mutant honesty)
- Technical Implementation: 6 (the three blockers above are real correctness bugs)
- Functionality & Execution: 8 (live, verified, key-resilient)
- UX: 7 (clean, but long survivor scroll on mobile)
- Real-World Impact: 6 (dev-tool for AI-test adopters; weakest criterion)
- Scalability & Future Potential: 7 (CI gate + TS type-level mutation are credible)

**Weakest: Real-World Impact.** Cheapest raise: add one sentence to the README naming a concrete
user (a team adopting AI-generated tests in CI, a TA grading student suites, a student checking
their own coverage claim) — already present, keep it. The bigger raise is the three blocker fixes,
because a correctness bug in a correctness tool is fatal to every other criterion.

## Top 3 fixes by value-per-minute
1. Fix the negative-literal span bug + drop unparseable mutants (findings 1 & 3 together).
2. Actually enforce the validation gate (finding 2).
3. Fix the rate-limit IP source (finding 4) and drop `durationMs` from the export (finding 6).


---

# RESOLUTION (Deepseek V4p1 Flash Ultra, 19 Sep 2026 ~21:10 IST)

All three blockers and both majors are fixed, verified in tests and re-verified on the
live deployment. Two minors were fixed; the third did not reproduce.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | BLOCKER | `a + -5` -> invalid `a--5` | FIXED — `mutate()` re-parses every candidate; unsafe splices repaired as `(a - -5)`, else dropped. Regression test added. |
| 2 | BLOCKER | Gate reported but not enforced | FIXED — failing tests removed from the scoring run; UI reports excluded vs kept; refuses to score when nothing passes. |
| 3 | BLOCKER | Unparseable mutant counted as a kill | FIXED — new `invalid` status, excluded from numerator and denominator; worker distinguishes SyntaxError from assertion failure. |
| 4 | MAJOR | `x-forwarded-for` client-spoofable | FIXED — prefers platform `x-real-ip`, else the LAST XFF entry; global hourly ceiling added as backstop; unit tests prove a prepend-only spoof yields the same identity. |
| 5 | MAJOR | Docs omitted the reasoning-model/token failure | FIXED — README now documents the empty-content-at-700-tokens failure and the `reasoning_content` fallback. |
| 6 | MAJOR | `durationMs: 0` hardcoded | FIXED — per-mutant and whole-campaign timings are now measured. |
| 7 | MINOR | Long survivor scroll on mobile | FIXED — first 5 survivors shown, with a "Show all N" expander. |
| 8 | MINOR | 0->N delta rendering | DID NOT REPRODUCE — `percentDelta` returns null for a zero baseline, so no delta renders ("0 -> 11", no percentage). Left as is. |

Test count went 62 -> 77 (engine validity corpus, gate enforcement, invalid-exclusion,
proxy IP resolution, key normalisation).

Post-fix live verification (in-browser, production deployment):
- Negative-literal case: 3 mutants, 0 invalid, no dropped, 100% — the audit attack no longer reproduces.
- Gate case: "1 test(s) fail on the ORIGINAL code and were EXCLUDED from scoring (1 kept)".
- Headline loop unchanged: GST 35% -> 100%; latefee 53% with 2 mutants flagged possibly equivalent.

---

# FINAL PASS (20 Sep 2026, pre-submission)

A final end-to-end pass on the live deployment found one more honesty bug in the
evidence spine, plus three smaller issues. All are fixed, pinned by tests, and
re-verified in production with the real model.

| # | Severity | Finding | Status |
|---|---|---|---|
| 9 | BLOCKER | Evidence baseline was global, not per-function: run GST (35%), switch to latefee, run (53%) and the page showed **"2/2 proven — Generated boundary tests raised the score from 35% to 53%"** with no generation at all. The history ribbon mixed examples the same way. | FIXED — one baseline per exact source (`baselineFor` / `recordBaseline`); the improvement claim requires same code + tests actually generated + a real rise; the ribbon only compares runs of the same code. |
| 10 | MAJOR | Baseline was recorded after the slower equivalence probe, with a stale-closure check, so a quick Generate click could make the post-generation 100% the baseline ("already killed all 17"). | FIXED — recorded through an order-safe updater, before the probe. |
| 11 | MAJOR | Gate matched tests by 80-char truncated display name; two long tests sharing a prefix could let a test that fails on the original into scoring, where it "kills" every mutant. | FIXED — `selectScoredTests` keeps tests by position. |
| 12 | MINOR | Equivalence probe ran the curated suite against user-edited code (and an all-excluded suite "passes" every mutant, flagging all as equivalent). | FIXED — probe runs only on the example's own code, and flags nothing if any curated test fails the gate. |
| 13 | MINOR | Offline-fallback note always blamed a missing API key, whatever the real failure (e.g. 429). | FIXED — states the actual reason. |

Test count 102 -> 110. Live verification: GST 35% -> latefee 53% (no claim) -> back to
GST, Generate: "raised from 35% to 100%", 2/2 proven, with 8 model-written tests.
