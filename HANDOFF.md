# HANDOFF — `frontier` (`fr`)

> **Status:** MVP **complete, green, dogfood-validated**; the **discovery ledger + fork** (D1–D3), the
> **forward graduation marker**, and the **backward `ingest`** (read-only parser + write slice 1:
> `--write` appends taint residuals idempotently) are **built and green** on top. Last session:
> 2026-07-01 (backward seam — ingest read-only parser + write slice 1, IMPL_PLAN §11).
> **Read order for a new agent:** this file → `CLAUDE.md` (the Laws) → `docs/prd.md` (WHAT) →
> `docs/IMPL_PLAN.md` (module APIs) → `src/types.ts` (the contract). Then `bun test` and skim `src/derive.ts`.

---

## 0. What this is (30-second version)

`fr` is a Bun/TypeScript CLI that externalises the **explore/exploit controller** for an **orchestrator** LLM
coordinating a swarm of subagents against an unproven math-physics conjecture. It compiles to one standalone
binary dropped at a target project's `.frontier/bin/fr` and wired into three Claude Code hooks
(`SessionStart`/`UserPromptSubmit`/`Stop`). Mental model: a **fund manager** — arms = portfolio positions, a
pull = capital (a wave of subagents), evidence = returns on a rigour ladder, the circuit-breaker = a stop-loss.
It emulates the wave-based workflow **Fable 5** ran spontaneously (provenance in §8).

**One non-skippable rule:** the `Stop` hook blocks a turn until this cycle's outcome is logged and the
frontier-stall breaker is respected. Everything else is light ceremony (`fr log` once per arm-pull).

## 1. Current state

- **229 tests pass / 0 fail** (`bun test`), `tsc --noEmit` clean, `bun run build` → `dist/fr`, `bun run latency`
  board ≈41 ms / check ≈40 ms (50 ms budget — verify on a QUIET machine; under load even pristine `main`
  measures ~56 ms, so a failing gate mid-session is contention, not a regression). **`fr` installed globally**
  at `~/.local/bin/fr` (on PATH; the global binary predates `fr ingest` — rebuild with `bun run install:global`).
- **Backward fr⇄vibefeld seam — `ingest` read-only parser + write slice 1 (built 2026-07-01 — seam-sketch
  §2.2/§3/§6, IMPL_PLAN §11).** `fr ingest <af-dir>` runs `af` as *an oracle of a richer return type* (`af status/
  challenges --format json`, binary via `$FR_AF_BIN`) and maps its derived state BACK into fr obligations:
  a `refuted` node → a `refutation` (a dead-route that sharpens the frontier by elimination); an OPEN
  critical/major challenge → a `gap` (a new arm); an `admitted`/`tainted` **leaf** → a `taint` (a citable
  discovery) **capped at T2** so it can NEVER support a banked/T0 result — the never-upgrade `taint→cap`
  conservation, the §8 trust-upgrade hole closed. PURE classifier `ingest.ts`; impure edge `vibefeld.ts`
  (with a pure `parseVibefeldState` inside). **Validated end-to-end against the real `../vibefeld/af`
  binary** (a clean proof → 0 residuals; a refute+admit workspace → refutation+taint). Subtlety: an admitted
  node is caught by `epistemic === "admitted"` even when its per-node `taint_state` reads `unresolved` (a
  pending ancestor) — `taint_state` alone would miss it.
  **Write slice 1:** `fr ingest <af-dir> --write` (opt-in; bare `fr ingest` stays read-only) idempotently
  appends each TAINT residual as a **parked discovery** (off-arm, breaker-neutral, `evidence.tier = cap = T2`,
  `artifact = vibefeld:<nodeId>`), reusing the discovery ledger — promotable via `fr arm add --from-discovery`.
  **Idempotency:** each record carries `from_vibefeld = residualRef = <nodeId>#<challenge|kind>@<contentHash>`;
  a re-run whose ref is already logged is skipped, and a CHANGED node (new contentHash → new ref) re-ingests —
  the lightweight `oracle.currentVerdicts` twin (pure `residualRef` + `newResiduals`). `gap`/`refutation` are
  printed but **report-only** (we write only the landings we've built). Verified live: `--write` wrote 1 taint
  discovery, a second run wrote 0 (skipped), the board shows the parked discovery. **Deferred (see §5):** the
  `gap→arm` and `refutation→refuted-dead-route` landings + the `crack → supersedes` credit-assignment loop.
- **Forward fr⇄vibefeld seam (built earlier — `docs/research/seam-sketch.md`, IMPL_PLAN §10).**
  `vibefeld`/`af` (`../vibefeld`) is the *already-built* contract-carrying adversarial proof DAG (event-sourced
  ledger, per-node verifier, `gap`/`completeness` challenges, `taint`, lemma-extraction); `fr` is the upstream
  explore/exploit scouting layer. The eighth outcome **`graduate ↟`** (`fr graduate <cycle> --to "<vibefeld
  root ref>"`) hands a statable SURVIVOR (a `▣ banked` result or a `✗ died-at` residual) to vibefeld as a root
  obligation — **off-arm + breaker-neutral**, same shape as `discovery`/`orient` (not a pull, not a turn-ender;
  `isPull` excludes it; G1 unaffected). Derived `graduations` ledger with **`tier→initialTaint` trust
  conservation** (`clean` IFF `T0`, else `admitted`), surfaced as `GRADUATED → vibefeld: ×N (clean · admitted)`.
  This is the FORWARD half ONLY; see §5 for what's deferred. Why the seam (not contracts-on-arms): an `fr` arm
  is a bet under *unknown* decomposition; vibefeld's nodes are steps of a *chosen* proof — different layers,
  and the litmus "can you write its verifier?" is a GRADUATION gate between them, not a per-arm admission gate.
- **No-wave turn marker (built this session, `docs/prd.md` §4.2 + IMPL_PLAN §9).** A seventh outcome
  `orient ·` (`fr orient "<why>"`) gives no-wave turns (a fresh agent *familiarising*, planning, answering
  the user) an **off-arm** channel that **satisfies G1 but is NOT a pull** — fixing the bug where ending an
  orientation turn meant faking a `null` arm-pull (two of which trip the breaker on pure orientation). Same
  shape as `discovery` (arm:null → already excluded from every arm's pulls/stale/strip); G1 now blocks iff
  the turn has no arm-pull AND no orient, and a no-wave turn early-returns pass before the wave gates. Board
  surfaces `NO-WAVE TURNS: ×N` so the escape stays visible. (Decision: dedicated marker, chosen by TJO over
  off-arm-null / dup-collapse.)
- **Discovery ledger + fork (built this session, `docs/prd-discovery.md`).** A sixth outcome `discovery ⟡`
  (`fr discover "<obs>" --question "…"`) gives off-goal results a **breaker-neutral** channel (off-arm, so the
  per-arm `stale` walk skips it). Derived `discoveries` ledger with signals **reuse** (distinct citing arms),
  **⟲ learning-progress**, **surprise**; status `parked → promoted-arm → forked → decayed`. Promote with
  `fr arm add <id> --from-discovery <c>` (Rung 2) or `fr fork <c> --goal --frontier` (Rung 3 — gated by GF:
  stateable new frontier + reuse≥2 or learning-progress; scaffolds a child `.frontier/`, prepares-not-launches).
  Decisions A/B taken as proposed defaults; **C deferred** (no §15.1 change). The board shows only PARKED
  discoveries (decay/promotion hide, never delete).
- **Feature-complete MVP:** `init · arm add/set · frontier · log · discover · orient · fork · graduate ·
  ingest · verify · board · check · turn-begin · status · help`; five wave outcomes `▣ banked / △ progress / ✗ died / ⊘ refuted / — null`
  plus two off-arm channels `⟡ discovery / · orient`; evidence class+tier+workers+P;
  the **bank gate** (`fr verify` oracle + hash-bound verdicts); the **frontier-stall breaker** + `PIVOT`;
  dead-routes ledger; supersession; loop guard; fail-closed/soft; orchestrator-only file-gated hooks; and a
  **progressively-discoverable in-CLI manual** (`fr help [topic]`, teaching errors, next-step nudges).
- **Dogfooded** on the sister repo `../npt-bound-entanglement` (NPT bound entanglement conjecture): a real
  10-cycle orchestrator+swarm campaign. See `../npt-bound-entanglement/orchestration/DOGFOOD-REPORT.md`.

## 2. Architecture — a PURE core behind two thin EDGES

```
EDGES (impure: fs / clock / spawn)            PURE CORE (no fs/clock/env/network — L4)
  index.ts     entry; the ONE clock call      derive.ts    (Portfolio,LogRecord[],Verdict[]) → DerivedState
  cli.ts       argv → dispatch (+ HELP)        referee.ts   check() — gates G1/G5/G2/G_launder/G2b/G3/G4 + guard
  cliutil.ts   parseArgs, out/err writers      validate.ts  validateLog() — write-time rejects (immediate feedback)
  commands.ts  the command handlers            board.ts     renderBoard() + hook-JSON wrappers
  store.ts     .frontier/ read/write           ingest.ts    ingestResiduals() — backward-seam classifier + taint→cap
  oracle.ts    run an oracle; verdict staleness  types.ts     the shared contract (IMPORT, never redefine)
  vibefeld.ts  run `af`; parse → VibefeldState
```

Purity is load-bearing: it is what makes the referee unit-testable and the <50 ms hook budget reachable. `now`
is injected once (index.ts) so the core is deterministic. **Never import `node:fs`/`Date`/`process` into a pure
module** (a purity grep guards this: `grep -nE "node:|Date\.|process\." src/{derive,referee,validate,board,ingest}.ts`).

State lives in `.frontier/`: `portfolio.json` (goal, frontier, config{stale_threshold,max_blocks_per_turn,
oracles}, arms), `log.jsonl` (append-only, one record per arm-pull — the single source of truth), `turn.json`
(ephemeral; `log_len_at_turn_start`+`blocks_this_turn`), `verdicts/*.json` (scrubbed oracle verdicts).

## 3. Build / test / deploy (verified commands)

```bash
bun install                 # once — dev tooling only (typescript, @types/bun); ZERO runtime deps
bun test                    # THE gate — 183 red/green unit + integration tests
bun run typecheck           # tsc --noEmit
bun run build               # → dist/fr  (standalone, embeds the Bun runtime; ~94 MB is expected)
bun run latency             # build + assert board/check cold start < 50 ms
bun run install:global      # build + install `fr` onto PATH (~/.local/bin; sudo → /usr/local/bin)
bun run src/index.ts <cmd>  # dev-run without compiling

# `fr` is installed globally (~/.local/bin/fr, on PATH). Deploy into a target repo:
#   merge hooks/settings.json (calls global `fr`) into target/.claude/settings.json, then `fr init`.
#   PATH-independent fallback: hooks/settings.selfcontained.json + cp dist/fr target/.frontier/bin/fr.
```

**The manual lives in the binary** (progressive discovery): `fr help` → overview + ritual + topic
index; `fr help <command|topic>` → detail (commands + concepts: workflow/outcomes/breaker/bank-gate/
evidence/arms/oracles/hooks). Error messages teach the fix + point to `fr help <topic>`; `fr init`
nudges the next step. Source: `src/help.ts`.

## 4. KEY DESIGN POINTS (the load-bearing subtleties — read before changing behaviour)

1. **The breaker is FRONTIER-STALL, not residual-rename.** In `derive`, staleness resets to 0 **only** on a
   moving pull: outcome ∈ {banked, progress, refuted} **or** a `frontier_after` reduction. A `died`/`null` that
   merely *renames* the `at` residual does **NOT** reset — otherwise the model paraphrases its way around the
   one non-skippable rule. This was a gaming hole in the first IMPL_PLAN draft; fixed and reflected in PRD §4.5.
   `k = stale_threshold = 2`. The `at` residual is the death certificate (G5 / dead-routes / board); it does
   **not** drive the breaker.
2. **`validate` (write-time) vs `check` (Stop) timing.** `validate` uses **pre-append** state **plus a
   frontier-reduction exemption** (a reducing pull is allowed even if the arm was pre-stalled — a productive
   death is the escape). `check` uses **post-append** state. Net effect: the *tripping* pull is allowed at write
   and caught at the Stop hook (so the block is visible); a *subsequent* EXPLOIT-on-stalled is rejected
   immediately at `fr log`. Don't "simplify" this without re-reading the `validate.test.ts` breaker cases.
3. **Fail-CLOSED vs fail-SOFT.** `check --hook stop` is fail-**closed**: corrupt/unreadable `.frontier/` →
   **BLOCK**. `turn-begin` and `board` are fail-**soft**: they catch, warn to **stderr**, and emit valid
   fallback JSON / stay silent — they must **never** leak a stack trace to stdout (it would break the
   UserPromptSubmit hook). Inert (`{}` / no-op) when `.frontier/portfolio.json` is absent.
4. **Append-only + derived (L2).** `log.jsonl` is truth; the FRONTIER, scoreboard, staleness, dead-routes,
   banked ledger are all derived. Records **supersede** (via `--supersedes <cycle>`), never overwrite.
   **Subtlety:** `derive`'s supersession (`isLive`) affects **only** the `banked` + `deadRoutes` ledgers — a
   superseded attempt still counts in an arm's pulls/strip/staleness (it historically happened).
5. **Bank gate.** `▣ banked` requires a **passing, independent** verdict (`fr verify <claim> --oracle <name>`,
   which runs argv with NO shell). G2b enforces it at write (`validate`) and Stop (`check`). Verdicts are
   hash-bound and go **stale** on change; staleness is resolved at the **edge** (`oracle.currentVerdicts` in
   `cli`), so the pure core only ever sees live verdicts. Oracle `cmd` should use **absolute paths** (cwd is
   not guaranteed under the hook).
6. **Orchestrator-only, file-gated hooks.** Inert unless `.frontier/portfolio.json` exists → every subagent /
   stray session is zero-cost. Only the orchestrator runs `fr`.

## 5. What's NOT done (pick up here)

- **Seam BACKWARD half — the remaining WRITE landings (the next increments).** The read-only parser AND
  write slice 1 now ship (§1): `fr ingest --write` appends the `taint` residuals as idempotent parked
  discoveries (`from_vibefeld = <nodeId>#<challenge|kind>@<contentHash>` keys the dedupe). What remains:
  (a) **`gap → arm`** — an open critical/major challenge appends/updates a portfolio arm with
  `ArmConfig.from_vibefeld` set (`--target = the gap`); portfolio-mutating, so decide arm-id derivation +
  the same idempotency key; (b) **`refutation → refuted dead-route`** — needs a derive tweak so an *off-arm*
  `refuted` record (arm:null) joins the `deadRoutes` ledger (today `derive` skips `arm == null` there), or a
  synthetic arm to hang it on; (c) the **`crack → supersedes` credit-assignment loop** — the deferred `crack`
  kind: a critical gap in a node `fr` had **banked** writes a record with `supersedes: <banking-cycle>`,
  re-opening the frontier via the existing `derive.isLive` path (the only sound place for `fr`'s intermediate
  reward; seam-sketch §2.2/§4) — needs the cross-ledger join (match a vibefeld node back to the fr banked
  cycle it graduated from, via the forward `graduated_to` markers). Extend `residualRef` to hash the
  challenge text too (today a re-worded challenge on an unchanged node won't re-ingest). `buildIngestedDiscovery`
  in `commands.ts` is the pattern to mirror for the arm/refuted builders.
  **Also deferred** (separate, more invasive): the statability-tightening of the log gate — every non-null pull
  names a *falsifiable* post-state, generalizing `died-at`'s G5 discipline (seam-sketch §9).
  Decided AGAINST: a shared `fr`/`vibefeld` ledger (TJO: too complex for the goal).
- **Discovery feature — canonical fold-in (on acceptance).** D1–D3 are built/green and documented in
  `docs/prd-discovery.md` (the spec) + `IMPL_PLAN.md` §6–8. On acceptance, fold it into the **canonical
  `docs/prd.md`** (§4 model, §5 data model, §6 CLI, §7 referee, §15) and add one `fr discover` line to the
  `CLAUDE.md` model-side ritual. Deferred: **Decision C** (the `progress`-resets-breaker tightening) — held as
  a ready drop-in, flip on only if a real campaign shows persistent progress-theatre (the D2 reuse /
  learning-progress signals instrument it). Not yet exercised in a **live** Claude Code session.
- **The tool repo is public** at `github.com/tobiasosborne/frontier` (AGPL-3.0). The `../npt-bound-entanglement`
  dogfood repo is still local-only (separate decision — it's a research campaign, not the tool).
- **Live hook test (PRD §14 #10–12).** Cannot be done headless — needs a Claude Code session **rooted in a
  target repo** so the real `Stop`/`UserPromptSubmit` hooks fire. Checklist: `../npt-bound-entanglement/
  orchestration/DOGFOOD-REPORT.md` §4 and `README.md`. Verify: board injects at SessionStart + each prompt;
  driving an arm to the stall threshold makes the Stop hook block; a subagent session is inert; the loop guard
  keeps clear of the 8-block session kill.
- **v1.1+ candidates** (PRD §13 "v2" + dogfood notes): the same-family ½-weight breaker refinement; `fr lessons`
  (cross-cycle recurring-dead-route / high-churn mining, *consumed* by the orchestrator); rigour-weighted
  decaying untried-arm optimism (the one real bandit term); multi-arm-per-wave allocation accounting; the
  lab-book render (project `.frontier/` → STATE.md/HANDOFF.md, PRD §12); validating `--artifact` against a
  sister-repo claim ledger. None are blocking; the MVP is self-contained.

## 6. The dogfood campaign (`../npt-bound-entanglement`)

A genuine scouting campaign on the **NPT bound entanglement conjecture** (do NPT undistillable states exist?
candidate: NPT Werner states). Built by 3 real subagents (literature dossier, numerics + the `verify_npt.py`
bank-gate oracle, a Schur–Weyl reduction). Frontier reduced to "is `W_3(α*=−0.4)` 2-undistillable?" with the
n=1 result banked `[T1]`. The campaign log/state is in `npt-bound-entanglement/.frontier/`; the report (feature
matrix + findings) is `orchestration/DOGFOOD-REPORT.md`. **This is a Fable-style lab book and a working example
of the tool in use — read it to see the intended workflow.**

## 7. Gotchas / where the bodies are buried

- Don't reintroduce residual-text-based staleness reset (§4.1) — it's a gaming hole.
- `derive.isLive` (supersession) touches **only** banked + deadRoutes, not staleness.
- `refuted` dead-routes key on `target ?? at ?? note` (operators rarely set `--target`).
- `--supersedes` / `--wave` are parsed by `fr log` (added late; check `buildRecord` in `commands.ts`).
- The 94 MB binary is normal (`bun build --compile` embeds the runtime). `dist/` is gitignored.
- `fr --help`/`-h`/bare `fr` all print usage now (exit 0); unknown command → exit 2.

## 8. Provenance

- The model (waves, `died-at` as the modal success, the FRONTIER reduction chain, claimed→audited→banked, the
  two-family bar, resilience) is reverse-engineered from **Fable 5** campaigns in
  `../almost-idempotent-positive-maps/agent-A/explorations/classical-portfolio/` (waves w1–w43) and
  `../haldane-conjecture/` (the cleanest greenfield Fable artifact).
- The gate mechanics (fail-closed file-gated Stop hook, pure-adjudicator/quarantined-verifier split,
  hash-bound stale-on-change verdicts, "internal convergence ≠ correctness") are adapted from **`bean`**
  (github.com/grainulation/bean) — an independent capture of the same behaviour with no portfolio layer.
- Locked decisions: PRD §15 (stale `k=2`; `P(true)` advisory-only; single-level arms + `target`; `.frontier/`
  committed; lab-book render deferred). The canonical design doc is `docs/prd.md`.
