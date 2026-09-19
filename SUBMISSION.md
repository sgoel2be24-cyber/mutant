# Submission — HackDevengers 2.0

Copy-paste source for the Google Form. All links verified live.

## Project Title

**Mutant — Tests That Prove Themselves**

## GitHub Repository Link

https://github.com/sgoel2be24-cyber/mutant

## Live Deployment Link

https://mutant-omega.vercel.app

## Project Description

Every passing test suite hides a question: would these tests actually fail if the code were wrong? Coverage tools don't answer it — they count executed lines, not caught bugs.

Mutant answers it. Paste any JavaScript function and its tests, and Mutant rewrites the code into dozens of real bugs — flipped comparison operators, nudged boundary values, wiped constants, negated conditions, dropped guards and return values — then runs your test suite against every single mutant in a sandboxed Web Worker with a hard timeout.

Any mutant your tests still pass is a bug your tests cannot find. Mutant shows each survivor as an exact diff, and attributes every kill to the specific test that caught it.

Then it closes the loop: it generates stronger boundary tests and re-runs, proving the improvement as a number that moves. In the built-in GST slab example, a single passing happy-path test scores only 35% — 11 of 17 injected bugs go undetected. After the model writes eight boundary tests — `gstRate(999)`, `gstRate(1000)`, `gstRate(5000)`, `gstRate(50001)` and the like — the same function scores 100%.

The mutation engine is written from scratch: it parses code to an AST and splices source at exact operator spans, so every mutant is guaranteed to be valid JavaScript, and every mutant is re-parsed in the test suite to prove it. The scoring is honest — tests that fail on the original code are excluded rather than quietly counted as kills, and mutants that no input can distinguish are labelled "possibly equivalent" instead of inflating the score.

The whole thing runs client-side: no code leaves the browser, no account, no setup. Everything is measurable, and the run exports as JSON for auditing.

## PPT

(deck built separately — optional field)
