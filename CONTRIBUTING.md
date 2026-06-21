# Contributing

Thanks for your interest. Frontier is small, pure-cored, and opinionated — contributions that keep it that
way are very welcome.

## Ground rules (the Laws)

These are non-negotiable; the full statement is in [`CLAUDE.md`](CLAUDE.md).

1. **Red-green TDD.** No behaviour lands without a test written *first* that fails for the right reason.
   For any load-bearing gate, perturb the implementation to confirm the test goes red, then restore — a test
   that can't fail proves nothing. "It runs" is not a passing test.
2. **The log is append-only and the single source of truth.** The FRONTIER, scoreboard, staleness, dead
   routes, and banked ledger are *derived* (`derive.ts`), never stored. Don't cache a derived count.
3. **Hook hygiene + fail-closed.** On the hook path: JSON-only on stdout, diagnostics to stderr, signal via
   exit code; cold start `<50 ms`. `check` fails closed; `turn-begin`/`board` fail soft.
4. **The core is pure.** `derive.ts`, `referee.ts`, `validate.ts`, `board.ts` are side-effect-free — no fs,
   clock, env, or network. Inject `now` from the edge. Only `store.ts`, `oracle.ts`, `cli.ts`, `index.ts`
   touch the outside world.
5. **No runtime dependencies.** `package.json` `dependencies` stays empty; the binary is self-contained.

## Workflow

```bash
bun install
bun test            # the gate — must stay green
bun run typecheck   # tsc --noEmit must be clean
bun run build       # standalone binary → dist/fr
bun run latency     # board/check cold start < 50 ms
```

- Read [docs/architecture.md](docs/architecture.md) and [src/types.ts](src/types.ts) before changing
  behaviour. Types live in `types.ts` only — import, never redefine.
- Keep modules ~200 lines, single-responsibility.
- One atomic change per commit; imperative subject; body says *what* and *why* (and which gates passed).

## Where things live

| Want to change… | Touch | Test |
|---|---|---|
| how staleness / dead routes / banked are computed | `src/derive.ts` | `test/derive.test.ts` |
| the Stop-hook gates / breaker | `src/referee.ts` | `test/referee.test.ts` |
| write-time `fr log` rejections | `src/validate.ts` | `test/validate.test.ts` |
| board rendering | `src/board.ts` | `test/board.test.ts` |
| a command / flag | `src/commands.ts`, `src/cli.ts` | `test/integration.test.ts`, `test/robustness.test.ts` |
| the in-CLI manual | `src/help.ts` | `test/robustness.test.ts` |

## Things that look right but are wrong

- **Don't** make staleness reset on a renamed residual — only a real frontier reduction resets it (closing a
  gaming hole). See `docs/architecture.md` §invariants.
- **Don't** let `readLog` silently skip malformed lines — that loses records (L2). Corruption must surface
  (`check` blocks; `turn-begin`/`board` degrade without dropping data).
- **Don't** "simplify" the write-time vs Stop-time breaker timing without re-reading the `validate.test.ts`
  breaker cases (the frontier-reduction exemption is deliberate).

## Stop conditions

Open an issue rather than working around: a locked PRD decision (§15) needs to change; the latency budget
can't be met without a runtime dependency; or a gate would have to be *relaxed* to make a test pass (that's a
design smell — fix the design, not the gate).
