# Implementation plan — `fr` MVP

Canonical spec: `docs/prd.md`. Working rules: `CLAUDE.md`. Type contract: `src/types.ts`.
This doc is the architecture, the module APIs (implement to these signatures), the delegation DAG, and the
TDD test matrix. MVP **includes the bank gate** (`fr verify` + G2b) — the anti-gaming close is core, not v1.1.

## 1. Architecture (a pure core behind two thin edges)

```
              edges (impure)                         pure core (no FS/clock/env)
  ┌─────────────────────────────────┐     ┌───────────────────────────────────────────┐
  │ cli.ts / index.ts  (argv, exit) │ ──► │ derive.ts   log → DerivedState            │
  │ store.ts   (.frontier/ I/O)     │ ──► │ referee.ts  DerivedState+turn → CheckResult│
  │ oracle.ts  (run command oracle) │ ──► │ validate.ts write-time log validation     │
  └─────────────────────────────────┘     │ board.ts    DerivedState → text + hookJSON │
                                          └───────────────────────────────────────────┘
```

All clock/now values are injected from the edge (`now: string`) so the core stays deterministic (L4/Rule 5).

## 2. Module APIs (implement exactly)

### `src/store.ts` (impure — Pillar A)
```ts
export function resolveFrontierDir(env?: Record<string,string>, cwd?: string): string
  // $CLAUDE_PROJECT_DIR/.frontier if set, else walk up from cwd to find .frontier/, else <cwd>/.frontier
export function isActive(dir: string): boolean              // does dir/portfolio.json exist?
export function readPortfolio(dir: string): Portfolio
export function writePortfolio(dir: string, p: Portfolio): void   // pretty JSON
export function readLog(dir: string): LogRecord[]           // [] if absent; one JSON object per line
export function appendLog(dir: string, rec: LogRecord): void
export function readTurn(dir: string): TurnState            // {log_len_at_turn_start:0,blocks_this_turn:0} if absent
export function writeTurn(dir: string, t: TurnState): void
export function readVerdicts(dir: string): Verdict[]        // from dir/verdicts/*.json; [] if absent
export function writeVerdict(dir: string, v: Verdict): void // dir/verdicts/<claim>.<oracle>.json (claim slugified)
```

### `src/derive.ts` (PURE — Pillar A)
```ts
export function derive(p: Portfolio, log: LogRecord[], verdicts: Verdict[], stripLen?: number): DerivedState
```
Behaviour:
- **Supersession:** a record `r` with `r.supersedes === c` retires the record at cycle `c` from the banked/active
  view (it stays in the log; derivation just doesn't count the superseded one as live).
- **Per arm**, over its pulls oldest→newest, tracking `runningFrontier` (starts at global `p.frontier` unless a
  `frontier_after` reduces it):
  - a pull **moves** (advances) iff `outcome ∈ {banked, progress, refuted}` **or** `frontier_after` is set and
    differs from `runningFrontier`. **A `died`/`null` that merely renames the `at` residual does NOT move** —
    anti-gaming: paraphrasing the residual must not reset the breaker (PRD §4.5). The `at` residual is the death
    certificate (G5 / dead-routes / board), it does **not** drive staleness.
  - `stale` resets to 0 on a moving pull, else `stale += 1`.
  - update `runningFrontier` when `frontier_after` set.
- `strip` = last `stripLen` (default 6) outcome glyphs, newest last.
- `bestTier`/`bestClass` = best (lowest-numbered) tier ever reached by a progress/banked pull on the arm.
- `distinctFamilies` = number of distinct model **families** among workers across the trailing stalling run
  (run of pulls counted into `stale`). Family map: opus/sonnet/haiku/fable→`claude`; codex/gpt→`openai`;
  gemini→`google`; else the raw model string.
- `status`: `untried` (0 pulls) · `dead` (priority==="dead") · `stalled` (stale ≥ threshold) ·
  `hot` (last pull banked/progress) · `warm` (last pull died with a new residual) · `cold` (otherwise).
- `aggP` = mean of non-null `p_true` over the arm's pulls, else null.
- **frontierTrail** = ordered distinct `frontier_after` values across the whole log, prefixed by the initial
  `p.frontier` if different; `frontier` (current) = last trail entry.
- **deadRoutes** = every `refuted` record (residual = target) + every `died` record whose arm later switched
  away from that residual (terminal death), keyed/deduped by residual; carry `killedAtCycle`/`killedByWave`.
  MVP simplification: include all `refuted` + all `died` records, dedupe by `residual`, newest wins.
- **banked** = records with `outcome==="banked"`; `verified` = exists a verdict with `result==="pass"` whose
  `claim===artifact` and which is not stale (see oracle §). Superseded banked entries are excluded.

### `src/referee.ts` (PURE — Pillar B)
```ts
export function check(state: DerivedState, turn: TurnState, log: LogRecord[],
                      p: Portfolio, verdicts: Verdict[]): CheckResult
```
Let `newThisTurn = log.slice(turn.log_len_at_turn_start)` and `newest = log[log.length-1]`. Gates, in order;
the FIRST failing gate determines the result. If `turn.blocks_this_turn >= p.config.max_blocks_per_turn`,
return `{status:"soft", ...}` (with the gate/reason) **instead of** `{status:"block"}` (loop guard).
- **G1 logged-this-turn:** the turn appended no **arm-pull** (`outcome ∉ {discovery, orient}`) **and** no **`orient`** marker → block "No wave outcome logged this turn. Record it with `fr log …` (or `fr orient` if no wave ran)." A turn accounted for by an `orient` alone (no pulls this turn) then **early-returns pass** — the wave gates have nothing to adjudicate, and this stops G4 firing on a legitimate first-turn orient.
- **G5 died-needs-residual:** any `r∈newThisTurn` with `r.outcome==="died" && !r.at` → block.
- **G2 progress/banked-backed:** any `r∈newThisTurn` with `r.outcome∈{progress,banked}` and no resolvable
  artifact (`!r.evidence?.artifact`) → block.
- **G_launder anti-laundering:** any `r∈newThisTurn` with `r.outcome==="refuted"` and `r.evidence?.verdict==="banked"` → block.
- **G2b banked-verified:** any `r∈newThisTurn` with `r.outcome==="banked"` lacking a passing non-stale verdict
  (no `verdicts` entry with `result==="pass" && claim===r.evidence.artifact` that is current) → block
  "`▣ banked` needs an audit verdict from an oracle other than the author. Run `fr verify` or downgrade to `△`."
- **G3 breaker:** let `arm = newest.arm`, `d = newest.decision`, `s = state.arms.find(a=>a.id===arm)`. If
  `s.stale >= p.config.stale_threshold` (tripped) and the decision is not an escape — i.e. NOT
  (`d.type==="EXPLORE" && d.arm!==arm`) and NOT (`d.type==="PIVOT"`) → block
  "Arm <arm>'s residual has survived <k> frontier-non-moving pulls. Next cycle must EXPLORE a different arm or PIVOT."
- **G4 ends-on-decision:** `!newest.decision` → block "End the turn on EXPLOIT|EXPLORE|PIVOT <arm>."
- else `{status:"pass"}`.

### `src/validate.ts` (PURE — Pillar B)
```ts
export function validateLog(p: Portfolio, state: DerivedState, rec: LogRecord, verdicts: Verdict[]): ValidationResult
```
Write-time rejects (immediate feedback, PRD §6) — mirror the relevant gates so the model is told at `fr log`
time, not only at `Stop`:
- died without `at`; progress/banked without `evidence.artifact`; banked without a passing non-stale verdict;
  refuted with `evidence.verdict==="banked"` (launder); unknown arm id; missing decision; a decision whose
  `arm` is not a registered arm; **breaker tripped** (the record's arm is `stalled` in `state`) and the
  decision is not an escape (EXPLORE-different / PIVOT).

### `src/board.ts` (PURE — Pillar C)
```ts
export function renderBoard(state: DerivedState, opts?: {maxArms?: number; maxDead?: number}): string
export function promptHook(text: string, event?: "UserPromptSubmit"|"SessionStart"): PromptHookOutput
export function stopPass(): StopHookOutput                 // {}
export function stopBlock(reason: string): StopHookOutput  // {decision:"block",reason}
export function stopSoft(text: string): StopHookOutput     // hookSpecificOutput additionalContext
```
Board layout per PRD §8 (FRONTIER + OPEN + trail · BANKED · ARMS one line each · DEAD ROUTES tail).
**Factual phrasing only** — no imperative verbs ("must", "switch now", "you should"); a test asserts this.
Untried arms render `??`. Token budget: cap arms at `maxArms` (default all, but truncate notes) and dead
routes at `maxDead` (default 6).

### `src/oracle.ts` (impure — Pillar C)
```ts
export function runOracle(claim: string, oracle: {name:string; cmd:string[]; inputs?:string[]},
                          claimText: string, now: string): Verdict
```
Runs `cmd` (argv, **no shell**) with `claimText` on stdin; exit 0 → pass, non-zero → fail, spawn error → error.
Writes nothing itself (the CLI persists via `store.writeVerdict`). Computes `claim_hash` (sha256 of claimText),
`oracle_digest` (sha256 of cmd joined), `inputs_hash` (sha256 of inputs file contents or ""). **Staleness** is a
pure predicate the referee/derive use: a verdict is current iff its three hashes still match the live claim,
oracle, and inputs. For MVP, expose `export function isStale(v: Verdict, claimText: string): boolean` (recompute
claim_hash and compare) — oracle/inputs digests are recorded for future re-check.

### `src/cli.ts` + `src/index.ts` (impure — Pillar C)
Dispatch (all `now = new Date().toISOString()` injected here):
- `init "<goal>"` → write portfolio.json (default config, empty arms, frontier="<goal>").
- `arm add <id> "<desc>" [--priority p] [--target t] [--kill k]`
- `arm set <id> [--priority p] [--target t] [--kill k]`
- `frontier "<text>"` → set portfolio.frontier (the live open).
- `log <arm> <outcome> "<note>" [--at r] [--artifact ref] [--class c] [--tier t] [--worker model:role]... [--p-true x] [--p-audit y] --decide <TYPE> <next-arm>`
  → build LogRecord, run `validateLog`; on `!ok` print error to stderr + exit 1; else `appendLog`, set
  `frontier_after` if `--frontier` given (optional), print a one-line confirmation.
- `verify <claim> --oracle <name>` → look up oracle in portfolio.config (or a `verify` block); run, persist verdict, print result.
- `board [--hook prompt]` → derive + render; with `--hook prompt` print `promptHook(text)` JSON only.
- `check [--hook stop]` → derive + check; with `--hook stop`: print Stop JSON (`stopPass`/`stopBlock`/`stopSoft`)
  and exit 0; on block increment `turn.blocks_this_turn`. **Fail closed:** wrap in try/catch — if `isActive` and
  anything throws, print `stopBlock("frontier check failed: <msg>")`; if `!isActive`, print `{}` exit 0 (inert).
- `turn-begin` → stamp turn.json `{log_len_at_turn_start: readLog().length, blocks_this_turn: 0}`. JSON-silent.
- `status` → human-readable summary (NOT hook-wrapped).
- Global: hook subcommands print **only** JSON to stdout; everything else (errors, status) is fine on stdout/stderr
  but hook paths must never leak non-JSON to stdout.

## 3. Delegation DAG (one session)

```
[me] scaffold + types.ts + this plan        ✔ done
        │
        ├──► Pillar A (agent)  store.ts + derive.ts        + test/store.test.ts test/derive.test.ts
        ├──► Pillar B (agent)  referee.ts + validate.ts    + test/referee.test.ts test/validate.test.ts
        │        (A ∥ B — disjoint files, both import types.ts only)
        ▼
     Pillar C (agent)  board.ts + oracle.ts + cli.ts + index.ts + scripts/latency.ts
                       + test/board.test.ts test/integration.test.ts   (imports A+B)
        ▼
[me] integrate · bun test (full) · bun run build · bun run latency · acceptance §14 · report
```
**File ownership is disjoint** — no two agents touch the same file. Every agent: import from `src/types.ts`
only; do **red-green TDD** (failing test first, show RED then GREEN, perturb a load-bearing test to RED then
restore); run `bun test <their files>` and report pass counts + any perturbation evidence.

## 4. TDD test matrix (maps to PRD §14)

| Test file | Asserts | PRD §14 |
|---|---|---|
| `derive.test.ts` | staleness increments on every non-frontier-reducing died/null (incl. the first); **resets** on a FRONTIER reduction (`frontier_after`) / progress / refuted; **does NOT reset** on a residual paraphrase; `strip`; `bestTier`; `distinctFamilies`; untried→`??` status; frontierTrail order; deadRoutes dedupe; banked `verified` flag; supersession removes a banked entry | 2, 6, 8 |
| `referee.test.ts` | G1 (nothing logged) · G2 (progress no artifact) · **G2b** (banked no verdict; verdict present→pass) · G3 breaker fires on stale+EXPLOIT, **passes** on EXPLORE-different / PIVOT, **passes** when a new residual reset stale · G4 · G5 · anti-launder · loop guard (≥max → soft not block) | 2, 5, 7 |
| `validate.test.ts` | each write-time reject (died/artifact/banked-verdict/launder/unknown-arm/breaker-tripped) | 3, 4 |
| `board.test.ts` | renders FRONTIER+trail, glyph strip, `??` for untried, dead-routes tail; **no imperative phrasing** (regex bans "must"/"switch now"/"you should"); `promptHook` shape is exact | 6, 7 |
| `store.test.ts` | round-trip portfolio/log/turn/verdicts in a temp dir; append-only; `resolveFrontierDir` env/cwd; `isActive` | — |
| `integration.test.ts` | spawn the CLI (`bun run src/index.ts`) against a temp `.frontier/`: the full §14 unit script 1–8 end-to-end, incl. fail-closed (`check` blocks when `.frontier` corrupt; `{}` when absent) | 1–8 |
| `scripts/latency.ts` | build the binary, time `board`+`check` cold start, assert < 50 ms | 9 |

## 5. Acceptance (definition of done for the session)
`bun test` green (all files) · `bun run build` produces `dist/fr` · `bun run latency` < 50 ms · the §14 unit
script 1–8 pass via integration · a `hooks/settings.json` snippet (PRD §9) + a short `README` deploy note exist.
Live hook test (§14 #10–12) is out of this session (needs a Claude Code session in a target repo) — leave a
documented manual checklist.

## 6. D1 — discovery ledger (capture + ledger)

Spec: `docs/prd-discovery.md` §10 (D1). Scope: `fr discover` (+ The Question), the `discovery ⟡` outcome,
breaker-neutrality, the derived discoveries ledger, the board block, the G1 fix. **Signal: cross-thread
`reuse` only** (learning-progress/surprise + promote/fork are D2/D3). No fork, no promote-to-arm.

**Key simplification:** a discovery record carries `arm: null`, and `deriveArm` filters `r.arm === arm.id`,
so discoveries are **already excluded** from every arm's `pulls`/`stale`/`strip`/`bestTier` — breaker
neutrality needs no gate surgery, only a regression test (L1: perturb the filter → RED → restore).

### 6.1 Type deltas (`src/types.ts`)
- `Outcome` gains `"discovery"`; `OUTCOME_GLYPH.discovery = "⟡"`.
- `LogRecord.arm: string | null` (null only for discovery/fork records); add `question?: string`, `cites?: string[]`.
- `DiscoveryStatus = "parked" | "promoted-arm" | "forked" | "decayed"` (D1 only ever yields `parked`).
- `interface Discovery { cycle; observation; question; class: EvidenceClass|null; tier: Tier|null; artifact: string|null; reuse: number; status: DiscoveryStatus }`.
- `DerivedState` gains `discoveries: Discovery[]`.

### 6.2 Module deltas
- **`derive.ts`** — new `deriveDiscoveries(log, isLive)`: one `Discovery` per live `outcome:"discovery"` record;
  `reuse` = # of **distinct arms** among non-discovery records whose `cites` includes the discovery's
  `artifact`; `status:"parked"`. Add `discoveries` to the return. Guard `if (r.arm == null) continue` in the
  dead-routes + banked loops so `arm:string` stays sound.
- **`referee.ts`** — G1 counts **arm-pulls only**: block iff `newThisTurn.filter(r=>r.outcome!=="discovery")`
  is empty (a turn that logs only a discovery has not logged its wave outcome). G3/G4 operate on
  `newestPull` = last non-discovery record (so a trailing discovery can't spuriously trip G4).
- **`validate.ts`** — new pure `validateDiscover(rec)`: reject empty observation; reject missing `--question`.
- **`board.ts`** — a bounded `DISCOVERIES (off-goal)` tail block (factual phrasing; `⟡ <obs> [class/tier]
  reuse×N`), shown only when non-empty; `BoardOpts.maxDisc` (default 6).
- **`cliutil.ts`** — `parseArgs` collects repeated `--cites` into `cites: string[]`.
- **`commands.ts`** — `cmdDiscover(dir, rest, now)` (build record → `validateDiscover` → append); `cmdLog`/
  `buildRecord` thread `--cites` onto the record.
- **`cli.ts`** — dispatch `discover`. **`help.ts`** — `discover` command + `discovery` concept; COMMANDS list.

### 6.3 TDD matrix (D1) — built
| Test file | Asserts |
|---|---|
| `derive.test.ts` | a `discovery` record creates a `discoveries[]` entry (obs/question/class/tier/artifact); **does NOT appear in any arm's `pulls`/`stale`/`strip`** (breaker-neutral, between two stalling pulls); `reuse` counts distinct citing arms; superseded discovery drops from the ledger |
| `referee.test.ts` | G1 **still blocks** when only a discovery was logged this turn; G4 does not fire when a discovery trails a decided arm-pull |
| `validate.test.ts` | `validateDiscover` rejects missing observation; rejects missing `--question`; accepts a well-formed discovery |
| `board.test.ts` | the `DISCOVERIES` block renders `⟡` + `reuse×N`, factual (no imperative tokens), absent when empty |
| `integration.test.ts` | `fr discover "x" --question "q"` appends `⟡` with `arm:null`; G1 still blocks a discovery-only turn; a later `fr log … --cites <artifact>` raises `reuse` on the board |

## 7. D2 — promotion + signals (built)

Spec: `docs/prd-discovery.md` §10 (D2). Adds the learning-progress + surprise signals, the decay
policy (Decision B), and Rung-2 promote-to-arm. Decisions taken (the proposed defaults): **A** —
fork-eligible at `reuse ≥ 2` **or** learning-progress; **B** — rigour-weighted decay that hides, never
deletes (a reuse-0, non-`T0` discovery older than `DECAY_AFTER_CYCLES = 8` → `status:decayed`, off the
board; the log record stays).

- **`types.ts`** — `Discovery` gains `learningProgress`/`surprise`; `ArmConfig.from_discovery?`.
- **`derive.ts`** — `deriveDiscoveries(log, isLive, arms, currentCycle)`: `learningProgress` = a citing
  pull MOVED (`MOVING_OUTCOMES` or `frontier_after`); `surprise` = artifact + `p_true ≤ SURPRISE_PRIOR
  (0.25)`; `status` ∈ promoted-arm (an arm's `from_discovery` names it) → decayed → parked.
- **`board.ts`** — only `status==="parked"` discoveries surface; clause adds `⟲` (learning-progress) /
  `surprise`.
- **`commands.ts`** — `fr arm add <id> --from-discovery <cycle>` seeds an arm from the discovery
  (desc ← observation), rejects a nonexistent cycle.

| Test file | Asserts (D2) |
|---|---|
| `derive.test.ts` | `learningProgress` true only when a citing pull moves; `surprise` on low-prior+artifact; `status` promoted-arm / decayed (T0 sticky, reuse-0 + old) |
| `board.test.ts` | `⟲` for learning-progress; only PARKED discoveries surface (decayed/promoted hidden) |
| `integration.test.ts` | `fr arm add P --from-discovery <c>` seeds the arm + promotes it off the parked tail; nonexistent cycle rejected |

## 8. D3 — fork-to-goal (built)

Spec: `docs/prd-discovery.md` §4.5 / §10 (D3). The expensive, gated Rung-3 promotion: a discovery
spins into its own campaign (a new `.frontier/`), not a multi-goal parent.

- **`types.ts`** — `Portfolio.forked_from?: ForkedFrom`; `LogRecord.fork_of?` (the inert fork-marker).
- **`validate.ts`** — pure `validateFork(disc, goal, frontier)` = **GF** (Decision A): stateable new
  frontier + new goal + (`reuse ≥ K_FORK=2` **or** learning-progress).
- **`derive.ts`** — a live record with `fork_of` adds to `forkedCycles` and is skipped as a ledger entry;
  status precedence becomes **forked > promoted-arm > decayed > parked**.
- **`commands.ts`** — `fr fork <cycle> --goal --frontier [--dest] [--first-arm id:"desc"]`: checks GF,
  scaffolds `<dest>/.frontier/` (copied config, seeded goal/frontier/+arm, `forked_from` provenance,
  inherited cites by reference, fresh log), appends the parent fork-marker. **Prepares, never launches**
  (the FS scaffolding is the only impure work — an edge op, like `fr init`; core stays pure, L4).

| Test file | Asserts (D3) |
|---|---|
| `validate.test.ts` | `validateFork` rejects no-discovery / no-goal / no-frontier / under-threshold; accepts at reuse≥2 or learning-progress |
| `derive.test.ts` | a `fork_of` marker sets the discovery `status:"forked"` and is not itself a ledger entry |
| `integration.test.ts` | an ineligible discovery is refused (no child created); an eligible one scaffolds a child `.frontier/portfolio.json` with `forked_from` + a FRESH log, and drops off the parent's parked board |

## 9. Orient — no-wave turn marker (built)

Spec: `docs/prd.md` §4.2. A turn that ran **no wave** (a fresh agent familiarising; planning; answering
the user) must still satisfy G1, but faking a `null` arm-pull inflates the arm's `pulls`/`stale` (two
nulls trip the breaker on pure orientation). `fr orient "<why>"` gives no-wave turns an off-arm channel.

**Same key simplification as discovery:** an orient record carries `arm: null`, and `deriveArm` filters
`r.arm === arm.id`, so orients are **already excluded** from every arm's `pulls`/`stale`/`strip` — it is
breaker-neutral for free. The only new logic is in `referee.ts` (G1 accepts it) and a small derived count.

- **`types.ts`** — `Outcome` gains `"orient"`; `OUTCOME_GLYPH.orient = "·"`; `DerivedState` gains `orientTurns: number`.
- **`derive.ts`** — `orientTurns` = count of live `outcome:"orient"` records (off-arm, so it touches nothing else).
- **`referee.ts`** — G1 blocks iff the turn has **no arm-pull and no orient**; on a no-wave turn (no pulls
  this turn) it **early-returns `{status:"pass"}`** *before* the wave gates (so G4's `!newest` cannot fire
  on a first-turn orient). `isPull` excludes both `discovery` and `orient`.
- **`validate.ts`** — pure `validateOrient(rec)`: reject an empty reason (a no-wave escape must stay auditable).
- **`board.ts`** — append `NO-WAVE TURNS: ×N` when `orientTurns > 0` (factual; keeps the escape visible).
- **`commands.ts`** — `cmdOrient(dir, rest, now)` (build off-arm record → `validateOrient` → append).
- **`cli.ts`** — dispatch `orient`. **`help.ts`** — `orient` command entry; OVERVIEW ritual + COMMANDS list.

| Test file | Asserts (orient) |
|---|---|
| `derive.test.ts` | an `orient` record is breaker-neutral (not in any arm's `pulls`/`stale`/`strip`); two orients add zero pulls and leave the arm `untried`; `orientTurns` counts live markers |
| `referee.test.ts` | an orient satisfies G1; an orient-only FIRST turn passes (G4 not tripped); a turn that logs nothing still blocks G1; an orient-only turn does not trip G3 against a pre-stalled arm |
| `validate.test.ts` | `validateOrient` rejects an empty reason; accepts a well-formed marker |
| `board.test.ts` | renders `NO-WAVE TURNS: ×N` when `orientTurns > 0`; no line when 0 |
| `integration.test.ts` | `fr orient "x"` appends an off-arm marker and the Stop hook passes; `fr orient` with no reason is rejected; two orient turns add zero pulls (arm stays `??`) and surface `NO-WAVE TURNS: ×2` |
