# CLAUDE.md — how to work on `frontier` (`fr`)

> **Router.** *WHAT / scope?* → `docs/prd.md` (the canonical PRD). *HOW do I build?* → this file.
> *The architecture + task DAG?* → `docs/IMPL_PLAN.md`. *The type contract?* → `src/types.ts` (single source of truth).

This repo builds **`fr`**: a Bun/TypeScript CLI that externalises the explore/exploit controller for an
**orchestrator** LLM coordinating an agent swarm against a math-physics conjecture (full rationale: the PRD).
It compiles to a single standalone binary dropped at a target project's `.frontier/bin/fr` and wired into
three Claude Code hooks. It is small, pure-cored, and fast.

**The single failure mode this project guards against: a hook that stalls or corrupts the host session, or a
gate the model can quietly satisfy without doing the work.** Everything below exists to make those hard.

---

## The Laws (non-negotiable)

- **L1 — Red-green TDD.** No behaviour lands without a test written **first** that fails for the right reason.
  Per unit: write the failing test (`bun test` → **RED**; *read* the failure to confirm it's the intended
  assertion, not a typo) → implement the minimum to pass (→ **GREEN**) → refactor green. For every
  load-bearing gate, **perturb the implementation to confirm the test goes RED, then restore** — a test that
  cannot fail proves nothing. "It runs" is never a passing test: each test asserts an invariant against a
  known value.
- **L2 — The log is append-only and the single source of truth.** `.frontier/log.jsonl` is the only
  authority. The FRONTIER, the scoreboard, staleness, the dead-routes ledger, and the banked ledger are all
  **derived** (`derive.ts`), never stored. Records **supersede**, never mutate. If you catch yourself caching
  a derived count, stop and recompute from the log.
- **L3 — Hook hygiene + fail-closed.** On the hook path: read JSON on stdin, write **only** JSON on stdout
  (every diagnostic → stderr), signal via exit code. The hot path (`board` / `check` / `turn-begin`) must
  cold-start **< 50 ms**: two small file reads, compute, print — no network, no heavy import, no dynamic
  require. **Fail closed:** if `.frontier/` is active but the referee cannot run, `check` **BLOCKS** the stop.
  Inert (`{}`, exit 0) when `.frontier/portfolio.json` is absent.
- **L4 — The core is pure and deterministic.** `derive.ts`, `referee.ts`, `validate.ts`, `board.ts`,
  `ingest.ts` are LLM-free, side-effect-free pure functions of their inputs — **no FS, clock, env, or network
  inside them** (inject `now`/paths from the edge). Only `store.ts`, `oracle.ts`, `vibefeld.ts`, `cli.ts`,
  `index.ts` touch the outside world. Purity is what makes the referee unit-testable and the latency budget
  reachable.

## Anti-gaming principle (why the gates exist)

**Internal convergence ≠ correctness.** A self-consistent log can converge cleanly on a *wrong* reading of the
problem. `fr check` certifies **provenance and protocol**, not mathematical truth; only `fr verify` (an
external oracle) reaches toward truth, and only as far as the oracle is trustworthy. Therefore: `△ progress`
needs a **resolvable** artifact; `▣ banked` needs a **passing, non-stale, independent** verdict; a residual
can't launder a failing oracle; a non-zero exit can never be upgraded to pass by self-reported JSON (signal
may only *downgrade*); a worker's "it's fine" is `class=stated`, never `tested`. (Borrowed from `bean`.)

## The Rules (numbered)

0. **Build-first / read-order.** Before changing behaviour, read the relevant PRD section + `docs/IMPL_PLAN.md`
   + `src/types.ts`. Don't restate types — import them.
1. **Get feedback fast.** After any change run `bun test` (and `bun run typecheck` if a signature changed).
   Never work blind.
2. **One contract, one place.** All shared types live in `src/types.ts`; modules import, never redefine. Type
   drift = build failure.
3. **~200-line modules, single responsibility** (see file map). No monolith.
4. **No runtime dependencies.** The binary is self-contained; `package.json` `dependencies` stays **empty**.
   Dev tooling (typescript, @types/bun) is fine. No network at runtime, ever.
5. **Determinism.** No `Date.now()` / randomness inside pure modules — pass `now` in. Same inputs → same
   output → same compiled-binary behaviour.
6. **Commit discipline.** One atomic step per commit; imperative subject; body = what + why; end with
   `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Commit/push only when TJO asks.
7. **Docs in lockstep.** A change leaving the PRD, this file, or `IMPL_PLAN.md` stale is incomplete work.

## Build & test (verified commands)

```bash
bun test                        # THE gate — the red/green unit + integration suite
bun test test/referee.test.ts   # one file
bun run typecheck               # tsc --noEmit  (needs `bun install` once for typescript + @types/bun)
bun run build                   # bun build ./src/index.ts --compile --outfile dist/fr   (standalone binary)
bun run latency                 # build, then time board/check cold start; asserts < 50 ms
bun run src/index.ts <cmd>      # dev-run the CLI without compiling
```

## Architecture / file map

```
docs/prd.md   canonical PRD (WHAT) · CLAUDE.md this file (HOW)
docs/IMPL_PLAN.md                 architecture + module APIs + task DAG + TDD matrix
src/types.ts     the shared contract — every type; single source of truth (IMPORT, never redefine)
src/store.ts     FS edge: locate .frontier/, read/write portfolio|log|turn|verdicts (impure)
src/derive.ts    PURE: (Portfolio, LogRecord[], Verdict[]) → DerivedState
src/referee.ts   PURE: (DerivedState, TurnState, ...) → CheckResult — gates G1–G5, breaker, anti-launder, guard
src/validate.ts  PURE: write-time validation for `fr log` (immediate rejects)
src/board.ts     PURE: DerivedState → factual board text + hook JSON wrappers
src/ingest.ts    PURE: VibefeldState → ResidualToken[] — backward-seam classifier + taint→cap conservation
src/oracle.ts    verify edge: run a registered command oracle → scrubbed hash-bound verdict (impure)
src/vibefeld.ts  ingest edge: run `af status/challenges --format json` → VibefeldState (impure; pure parser inside)
src/cli.ts       arg parse + command dispatch (impure edge) · src/index.ts entrypoint
test/*.test.ts   bun tests — one per module + integration · scripts/latency.ts latency harness
```

## Stop conditions (escalate to TJO)

- A PRD §15 locked decision would need to change.
- The < 50 ms latency budget can't be met without adding a **runtime** dependency.
- A gate would have to be **relaxed** to make a test pass (that's a design smell — fix the design, not the gate).
