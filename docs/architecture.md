# Architecture

Frontier is a **pure core behind two thin edges**. The core is a set of deterministic, side-effect-free
functions; the edges do all the I/O. That split is what makes the referee unit-testable and the `<50 ms`
hook budget reachable.

```
EDGES (impure: fs / clock / spawn)            PURE CORE (no fs / clock / env / network)
  index.ts     entry; the ONE clock call      derive.ts    (Portfolio, LogRecord[], Verdict[]) → DerivedState
  cli.ts       argv → dispatch                 referee.ts   check() — the Stop-hook gates
  cliutil.ts   parseArgs, out/err writers      validate.ts  validateLog() — write-time rejects
  commands.ts  the command handlers            board.ts     renderBoard() + hook-JSON wrappers
  store.ts     .frontier/ read/write           help.ts      the in-CLI manual (strings)
  oracle.ts    run an oracle; verdict staleness types.ts     the shared contract
```

**Rule:** never import `node:fs` / `Date` / `process` into a pure module. `now` is injected once (in
`index.ts`) and threaded through, so the same inputs always produce the same output — and the compiled
binary behaves identically to `bun run src/index.ts`.

## Data model (`.frontier/`)

| File | Role |
|---|---|
| `portfolio.json` | goal, current frontier, `config` (`stale_threshold`, `max_blocks_per_turn`, `oracles`), arms |
| `log.jsonl` | **append-only**, one JSON record per arm-pull — the single source of truth |
| `turn.json` | ephemeral: `log_len_at_turn_start` + `blocks_this_turn` (so `check` can diff the turn) |
| `verdicts/*.json` | scrubbed, hash-bound oracle verdicts |

Everything else — the FRONTIER trail, per-arm staleness/strip/best-tier, dead routes, the banked ledger —
is **derived** by `derive.ts`, never stored. A stale counter the model could quietly reset doesn't exist.

## The flow

```
fr <cmd>  →  cli.ts  →  store.ts reads .frontier/  →  derive() / validate() / check() / renderBoard()
                                                            (pure)
          ←  store.ts writes / out() prints  ←──────────────┘
```

- `fr log` → `validateLog(...)` (pure, write-time gates) → `appendLog(...)`.
- `fr board` → `derive(...)` → `renderBoard(...)` → print (or wrap as hook JSON).
- `fr check --hook stop` → `derive(...)` → `check(...)` → emit Stop JSON; on a block, increment
  `blocks_this_turn`. Wrapped in try/catch: **fail-closed** (a throw → block).
- `fr verify` → `runOracle(...)` (the only `spawn`) → `writeVerdict(...)`.

## Key invariants

1. **Append-only + derived (L2).** Records supersede, never overwrite. `derive`'s supersession (`isLive`)
   affects only the `banked` and `deadRoutes` ledgers — a superseded attempt still counts toward an arm's
   pulls/strip/staleness, because it historically happened.

2. **Frontier-stall, not residual-rename.** `derive` resets an arm's staleness to 0 only on a *moving* pull:
   `outcome ∈ {banked, progress, refuted}` or a `frontier_after` reduction. A `died`/`null` that renames the
   `--at` residual does not reset it — closing a gaming hole (paraphrasing past the breaker).

3. **Write-time vs Stop-time breaker.** `validate` (write) uses pre-append state **plus a frontier-reduction
   exemption**; `check` (Stop) uses post-append state. The *tripping* pull is allowed at write and caught at
   the Stop hook (so the block is visible); a *subsequent* stalled-EXPLOIT is rejected immediately at `fr log`.

4. **Edge-resolved verdict staleness.** Verdict hashes are recomputed at the edge (`oracle.currentVerdicts`
   in `cli`); only *current* verdicts are passed into the pure core, so `derive`/`referee` can treat verdict
   presence as "live" without touching the filesystem.

5. **Fail-closed where it gates, fail-soft where it injects.** `check` blocks on corruption; `turn-begin` /
   `board` degrade gracefully and never pollute hook stdout.

## Testing

`bun test` runs unit tests per pure module (constructing fixtures directly — no I/O), plus integration tests
that spawn the real CLI against a temp `.frontier/` and a robustness suite for the edge behaviours
(fail-soft, `--supersedes`, the in-CLI help). Every load-bearing gate has a perturbation check: break the
implementation, confirm the test goes red, restore. `scripts/latency.ts` builds the binary and asserts the
`board`/`check` cold start is under 50 ms. The full design rationale and the build-time task DAG are in
[IMPL_PLAN.md](IMPL_PLAN.md).
