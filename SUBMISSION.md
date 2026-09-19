# Submission — HackDevengers 2.0

Copy-paste source for the Google Form. All links verified live.

## Project Title

**Mutant — Tests That Prove Themselves**

## GitHub Repository Link

https://github.com/sgoel2be24-cyber/mutant

## Live Deployment Link

https://mutant-omega.vercel.app

## Project Description — SHORT (≈100 words, use if the form caps length)

AI now writes a lot of our tests — but who checks the tests? A green suite never tells you whether it would fail if the code were wrong. Mutant does. Paste a JavaScript or TypeScript function and its tests: a hand-written AST engine plants real bugs (flipped operators, nudged boundaries, dropped guards), runs your suite against each in a sandboxed Web Worker, and shows every bug that slips through as an exact diff. Then an AI writes tests aimed at those survivors, and Mutant keeps only the ones proven to catch a bug. One passing test: 35%. After: 100%. All in the browser.

## Project Description — FULL (≈510 words)


AI now writes a large share of our tests, and nobody checks them. Every passing suite hides a question: would these tests actually fail if the code were wrong? Coverage tools don't answer it — they count executed lines, not caught bugs.

Mutant answers it. Paste a JavaScript or TypeScript function and its tests, and Mutant rewrites the code into dozens of real bugs — flipped comparison operators, nudged boundary values, wiped constants, negated conditions, dropped guards and return values — then runs your test suite against every single mutant in a sandboxed Web Worker with a hard timeout.

Any mutant your tests still pass is a bug your tests cannot find. Mutant shows each survivor as an exact diff, and attributes every kill to the specific test that caught it.

Then it closes the loop — and this is where AI-written tests get held to account. Click "Kill this mutant" on any survivor and a model writes a test aimed at that exact bug; Mutant runs it against the original and the mutant and inserts it only if it passes the first and fails the second. Or generate a whole boundary suite and re-run: the improvement is proven as a number that moves. In the built-in GST slab example, a single passing happy-path test scores only 35% — 11 of 17 injected bugs go undetected. After the model writes eight boundary tests — `gstRate(999)`, `gstRate(1000)`, `gstRate(5000)`, `gstRate(50001)` and the like — the same function scores 100%.

The mutation engine is written from scratch: it parses code to an AST and splices source at exact operator spans, so every mutant is guaranteed to be valid JavaScript, and every mutant is re-parsed in the test suite to prove it. The scoring is honest — tests that fail on the original code are excluded rather than quietly counted as kills, and mutants that no input can distinguish are labelled "possibly equivalent" instead of inflating the score.

Two guarantees are enforced rather than assumed. Every generated mutant is re-parsed before it is used: an operator flip that would produce invalid JavaScript — flipping `+` in `a + -5` naively yields `a--5` — is repaired into a valid form or discarded, because an unparseable mutant would be scored as a "kill" and silently inflate the score. And tests that fail on the original code are removed from scoring entirely, not just flagged; if none of your tests pass on the original, the app refuses to publish a score instead of showing a meaningless zero.

The whole thing runs client-side: no code leaves the browser, no account, no setup — open the link and the first example is already scored. Runs share as links that recompute live, and export as a CI gate and a README badge. Everything is measurable, and the run exports as JSON for auditing. Before submission the project was put through an independent adversarial audit by a different model, which found three real correctness defects in the engine and runner; all are fixed, pinned by regression tests, and recorded in AUDIT.md.

## PPT

(deck built separately — optional field)
