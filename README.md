# MUTANT — Tests That Prove Themselves

> In-browser mutation testing: paste a function and its tests, watch the code get rewritten N ways, see exactly which bugs the suite fails to catch — then let an LLM write better tests and prove the improvement with a score.

[![ci](https://github.com/sgoel2be24-cyber/hackdevengers-2.0/actions/workflows/ci.yml/badge.svg)](https://github.com/sgoel2be24-cyber/hackdevengers-2.0/actions/workflows/ci.yml)

**Live demo:** TODO · **Built:** 19-20 September 2026, solo, during the 24-hour
HackDevengers 2.0 window.

---

## The problem

TODO: one paragraph. State the specific problem for a specific user. Avoid
"everyone struggles with X".

## What it does

TODO: 3-5 bullets, each a user-visible capability, not an implementation detail.

## Why it is not a wrapper

TODO: the one paragraph that answers the judge's silent question. Name the
mechanism that is ours — the part that is not a model call.

## Evidence

This project renders every claim it makes with a measurement and the artifacts
that produced it. A claim that cannot be measured renders as `UNMEASURED`
(`src/lib/evidence.ts` enforces this — see the tests).

| Claim | Measurement | Artifact |
|---|---|---|
| TODO | `before → after` | `artifacts/...` |

## Quickstart

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # unit tests
pnpm build      # production bundle in dist/
```

## Architecture

```
src/
  lib/          # core mechanism (pure, unit-tested, no framework imports)
  components/   # presentation
  App.tsx       # composition
```

TODO: a short data-flow paragraph. Where does input come from, what transforms
it, what proves the output is correct.

## Verification

```bash
pnpm typecheck && pnpm test && pnpm build
```

TODO: the exact command a judge can run to reproduce the headline number
without any credentials.

## Limits, honestly

TODO: 2-3 bullets on what this does NOT do, and why the scope was chosen.
Judges trust a stated boundary more than an unbroken claim.

## Scalability & future work

TODO: 3 bullets on what happens at 10x users/documents, and the first thing
you would build next.

## Built with

TODO: stack. Name what actually mattered.

## License

MIT — see [LICENSE](./LICENSE).
