# MUTANT — Tests That Prove Themselves

> Paste a function and its tests. Mutant rewrites the code 17 ways — flipped operators, nudged boundaries, wiped constants, dropped guards — and shows you exactly which of those bugs your tests never catch. Then it proves the improvement with a number.

**Live demo:** https://mutant-omega.vercel.app
**Built:** solo, during the HackDevengers 2.0 24-hour window (19–20 September 2026), Open Innovation track.

[![ci](https://github.com/sgoel2be24-cyber/mutant/actions/workflows/ci.yml/badge.svg)](https://github.com/sgoel2be24-cyber/mutant/actions/workflows/ci.yml)

---

## The problem

A green test suite tells you the tests pass. It does not tell you whether they would *fail* if the code were wrong. Those are different questions, and only the second one is what "tested" is supposed to mean. The gap is invisible: coverage reports count lines executed, not bugs caught.

This is not hypothetical. In the demo's own example, a GST slab calculator with a passing test suite scores **35%** — meaning **11 of 17 injected bugs go completely undetected** by tests that all pass. The suite is a comfort blanket.

## What it does

- **Rewrites your function automatically.** A hand-written AST engine injects real bugs: `>=` → `>`, `1000` → `0`, `!x` → `x`, guards forced true, return values dropped.
- **Runs every mutant against your tests, sandboxed.** Each run gets a disposable Web Worker with a hard timeout. Nothing your code does can freeze the page.
- **Shows survivors as diffs.** A surviving mutant is a bug your tests cannot see. You get the exact one-character change and the line it happened on.
- **Attributes every kill to the test that caught it.** Not just a score — the causal link between a specific test and a specific bug class.
- **Refuses to score broken tests.** A test that fails on the *original* code is excluded and reported. A test that fails before any mutation proves nothing about mutants.
- **Flags possibly-equivalent mutants.** Some mutants cannot be killed by any input. Mutant says so instead of pretending 100% is always reachable.
- **Exports the whole run as JSON.** Every mutant, operator, status, killer test and headline number — auditable after the page is closed.

## Why this isn't a wrapper

The mechanism is ours. `src/lib/mutate.ts` is a hand-written AST mutation engine built on acorn: it walks the parse tree, identifies mutation sites, and splices the source **at the exact operator token or literal** — never across a whole expression, so every mutant is guaranteed to remain syntactically valid JavaScript.

That guarantee is load-bearing, and it is *tested*: `mutate.test.ts` re-parses every mutant the engine produces and asserts it compiles, asserts each mutant differs from the original at exactly its declared span, and asserts a mutant that does not change the source is rejected (dropping a guard whose test is already `true` is not a mutation).

The LLM writes test expressions. It does not generate mutants, does not decide the score, and does not verify anything. Strip the model out entirely and the product still works end to end on curated examples — which is also the resilience story: the deployed demo has no hard dependency on an API key, so it still works the way a judge finds it days later.

## Evidence — measured, not claimed

Every number below came from a real run on the live deployment.

| Claim | Measurement | How to reproduce |
|---|---|---|
| A passing suite can miss most bugs | GST example, seed suite: **35%** score, **11 of 17** mutants survive | open demo → *Run mutation analysis* |
| Better tests measurably close the gap | same example after generation: **35% → 100%**, 17/17 killed | *Generate stronger tests* → *Run* |
| The engine works on arbitrary code, not just curated input | pasted `shippingCost()` function: **67%** (8 killed, 4 survived / 12) | paste any function + one test |
| Some mutants are unkillable | latefee example: **2 of 8** survivors flagged *possibly equivalent* | load *Library late fee* → *Run* |
| The engine's output is valid JavaScript | **62/62** tests pass, including "every mutant re-parses" across 5 code shapes | `pnpm test` |

## How it works

```
src/lib/mutate.ts     AST engine: acorn parse -> walk -> splice at operator/literal spans
src/lib/prng.ts       seeded PRNG: same seed -> same mutants -> same score, every time
src/lib/worker.ts     disposable sandbox: fresh scope per test, no DOM, no page freeze
src/lib/runnerClient.ts campaign driver: validation gate, then N mutants, timeout = kill
src/lib/runner.ts     scoring: (killed + timeout) / total, Stryker semantics
src/lib/diff.ts       token-level LCS diff for survivor cards
src/lib/generate.ts   LLM client with a curated offline fallback path
src/lib/evidence.ts   claim/measurement model — unprovable claims render as UNMEASURED
api/generate.ts       the only server-side piece: rate-limited LLM proxy
```

Pipeline: **parse → mutate → gate → run each mutant in isolation → score → attribute kills**.

Scoring follows Stryker semantics: a timeout counts as a kill, because a suite that hangs on changed behaviour has still distinguished mutant from original.

## Quickstart

```bash
pnpm install
pnpm dev            # http://localhost:5173
pnpm verify         # typecheck + tests + build + deploy smoke test
```

## Verification a judge can run without credentials

```bash
pnpm test           # 62 tests: engine, PRNG, runner, diff, generation parsing, evidence
pnpm verify:serve   # serves dist/ and asserts the built page mounts correctly
```

The engine tests are the interesting ones: they prove mutants are valid, precisely spliced, deterministic under a seed, and that no-op mutations are rejected.

## Honest limits

- **JavaScript only.** The engine parses JS/TS-compatible syntax; TypeScript type annotations and other languages are out of scope for a 24-hour build.
- **Not every survivor is a real bug.** Some mutants are semantically equivalent to the original. Mutant flags the ones it can detect via the curated suite rather than silently counting them as defeats.
- **Single function, one screen.** Multi-file projects and module resolution aren't handled.
- **The sandbox is a Web Worker, not a security boundary.** It isolates crashes, hangs and globals; it is not designed to run adversarial code you didn't paste yourself.
- **The rate limiter is per-instance and in-memory.** It caps abuse of the generation endpoint, not a hostile actor with a botnet.
- **One LLM call sharpens tests; it is not required.** The generation endpoint needs a key; everything else is keyless and offline-capable by design.

## Scalability & future work

- **Per-mutant parallelism.** Runs are currently sequential; a worker pool would cut wall-clock time roughly by core count, which matters at hundreds of mutants.
- **Type-aware mutation for TypeScript.** Mutating at the type level (type guards, nullability, generics) catches a class of bug the value-level operators cannot.
- **CI integration + mutation-diff on pull requests.** Run against changed lines only, fail the build on a score regression — the adoption path from a browser tool to a pipeline gate.
- **Cross-validation of the score.** Report which mutants survived *and* which tests would have killed them, turning the output into a "write this test next" recommendation.

## Built with

TypeScript, React 19, Vite 8, acorn (AST parsing), Vitest (62 tests), pnpm, Vercel (static + one serverless function). No mutation-testing library is used — the engine is the point of the project.

## Provenance

Built inside the hackathon window. Commit history is the record:

```
13:40  scaffold (verified: typecheck, tests, build, deploy smoke test)
13:43  decision locked: Mutant
13:56  mutation engine + sandbox runner + curated examples (49 tests)
14:00  full app: editor, run pipeline, survivor diffs, AI flow, evidence
14:10  serverless handler fix (Vercel Node runtime signature)
14:12  JSON run export + equivalent-mutant labeling
14:13  honest evidence metrics + diff legend
```

## License

MIT — see [LICENSE](./LICENSE).
