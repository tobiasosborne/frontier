# PRD — Frontier: an explore/exploit controller for an orchestrator LLM

**Working name:** `frontier` (CLI: `fr`). The scouting/reconnaissance metaphor still fits — a `-feld` option is *Spähfeld* (Späher = scout). `fr` is the **pre-lab-book scouting layer**: it runs the campaign while it is still a portfolio of bets, and graduates the survivors into a sister-style lab book.

**Status:** design doc **v0.2** (the canonical PRD). The MVP described here is **built, tested, and
dogfood-validated** — see the [README](../README.md) and [docs](.). v0.1's bones (append-only log as truth,
derived recency-injected scoreboard, non-skippable Stop-hook referee, hook-ready JSON, factual-not-imperative
board) are retained; the *model of operation* below is rebuilt around an observed workflow.
The **discovery ledger + fork** extension (full spec + provenance in [`prd-discovery.md`](./prd-discovery.md),
phases D1–D3) is **built and green**, and folded into the canonical model below (§4.8, §5, §6, §7, §13, §15).
**Owner:** TJO.
**One-line goal:** externalise, for the **orchestrator** of an agent swarm, the explore/exploit controller and big-picture memory it structurally lacks — an append-only cycle log + a derived, recency-injected **FRONTIER + portfolio scoreboard**, made non-skippable via Claude Code hooks, and shaped to mirror the wave-based research workflow that **Fable 5** spontaneously used.

> **What changed from v0.1 (read this first).**
> 1. **Audience narrowed to the orchestrator.** The tool is for the one entity in a swarm whose context accumulates — the coordinator. Subagents are free of the tool. (§1, §9)
> 2. **The model is a fund manager, not a researcher.** Arms = portfolio positions; a pull = capital (a wave of subagents); evidence = returns; the breaker = a stop-loss; untried-arm optimism = a diversification mandate. (§4)
> 3. **One flat `▲/△/—/✗` glyph is replaced by a rigour ladder.** Outcomes carry an *evidence class* (lit/numerics/side-conjecture/af/lean/…) and a *tier*, and `banked` is reachable only through an independent **audit gate**. (§4.3, §7)
> 4. **The circuit-breaker fires on a stalled frontier, not a null counter.** A productive death (`died-at` a sharper residual) is progress and resets the breaker; the same residual surviving *k* independent attacks is the staleness signal. (§4.5, borrowed from `bean`)
> 5. **The cycle is a wave, not a single arm.** One orchestrator turn dispatches a fan-out across one-or-more arms and logs one record per arm-pull. v0.1's "one arm per turn" non-goal is retired. (§4.2)
> 6. **New first-class state:** the single live **FRONTIER** (the one named open, progressively reduced), a **dead-routes ledger** (keyed on `died-at` residuals), and a **banked-machinery ledger**. These are what the orchestrator hand-maintained across the Fable campaign; the tool captures them as a side effect of logging. (§5)
> 7. **Implementation is Bun** (`bun build --compile` → standalone binary), chosen for Claude's TS/JS post-training. (§11)

---

## 1. Problem

A transformer's default generation dynamic *is* exploitation: greedy continuation of the current line of reasoning. Over-exploitation is an attention feedback loop — the active approach accumulates the most (and most recent) tokens, wins the most attention mass under all-pairs softmax, and so pulls the next token toward continuing it. The model has no intrinsic memory of marginal returns and no exogenous boredom drive.

**This pathology is fundamentally an *accumulation* disease, and in a swarm only one entity has it.** Subagents are short-lived, fresh-context probes — they cannot suffer sunk-cost because they have no cost yet. The **orchestrator** is the sole entity whose context grows monotonically across a multi-day campaign, so it is the one that tunnel-visions on the first approach that shows life, and the one whose big picture decays under context compaction. Therefore:

> The swarm **is** exploration. The orchestrator **is** the exploitation risk. `fr` attaches to the seam between them and regulates **capital allocation across approaches** — it is the controller for a fund manager, not a referee for a researcher.

The controller must (a) survive quadratic attention by being short, differentiated, and positioned in the recency slot; (b) work with the post-training, not against it (instruct-following, self-assessment, ritual compliance, and — crucially — **a workflow the model already knows how to run**, see §2); (c) be non-skippable; and (d) **survive context loss** — the orchestrator's portfolio state must reconstruct from an immutable on-disk log, never from a lossy conversation summary.

## 2. What we are emulating (the observed workflow)

This is not a hypothetical controller. It externalises a workflow **Fable 5 ran spontaneously** as an orchestrator across two multi-day campaigns on unproven math-physics conjectures:

- **`almost-idempotent-positive-maps`** (`agent-A/explorations/classical-portfolio/`): ~43 numbered **waves** (`w1…w43`) over four days, each a fan-out of 2–10 specialised subagents ("codex"/"opus"/"sonnet" workers) attacking a single named open problem, progressively reducing it (big conjecture → `(TREE)` → `(SB)` → `(EX)` → one inequality).
- **`haldane-conjecture`** (100% Fable-authored): the cleanest greenfield instance. Its directory layout *is* the evidence ladder — `literature/ numerics/ attacks/{A..E}/ lean/` — with a hand-maintained `STATE.md` scoreboard, a `HANDOFF.md` frontier-carry, and an append-only `orchestration/log/`.

The load-bearing empirical findings (full provenance in §16):

- **The atomic unit is a *wave*** — brief-at-launch → dispatch N parallel workers → harvest → audit → bank/decide-next. One harvest ≈ one commit.
- **The portfolio is two-level:** lanes/routes (`A`–`E`, or `Lane D/B/E/G/C`) ⊃ named open targets (`(EX)`,`(SB)`,`(TREE)`,`(CHARGE)`). Arms are **coupled** — a counterexample on one can moot others.
- **`died-at` is the *modal* success**, not a failure. An attempt that dies at a *sharply stated residual in display math* ("the path-product floor `Π_C ≳ τ − O(Lδ)`") narrows the frontier and becomes a permanent constraint. ~179 `DIED-AT` verdicts vs ~198 `PROVED` in one campaign.
- **A real rigour ladder:** `claimed → audited → banked`, with `banked` gated by a **hostile audit by a *different* worker / model family** (the "two-family bar"). This gate caught ~6 plausible-but-wrong claims *before* they were recorded. Evidence is tagged by tier (`T0` theorem / `T1` certified computation / `T2`/`GUIDANCE` floats) and grounding (byte-verified `refs/` vs `[UNVERIFIED]`).
- **A single live FRONTIER block** (current open → proved/banked machinery → dead routes → live mechanism), rewritten each reduction.
- **An explicit dead-routes ledger** ("do not re-walk"), keyed on the `died-at` residual, carrying the killing wave.
- **Explicit switch rules:** switch arms when (a) a pre-registered kill criterion fires; (b) a blocker survives two independent attacks by different model families; (c) another arm opens a cheaper door.
- **Calibrated credences** `P(true)` / `P(survives audit)` per result, aggregated to decide funding.
- **A resilience protocol:** bounded briefs (one question, ≤30 min), eager repo snapshots, commit-early-push-often, resume-or-relaunch, and an *orchestrator-local-probe* fallback when the swarm is unreachable.
- **The controller itself was never serialized.** It lived entirely as hand-maintained markdown discipline (`STATE.md`, `HANDOFF.md`, `ORCHESTRATION.md`, append-only dossiers). **That absence is exactly what `fr` fills.**

`bean` (github.com/grainulation/bean) is an independent attempt to capture the same Fable behaviour from the *task-convergence* angle — a single Rust binary + a fail-closed, file-gated Stop hook + a claim ledger with an external **oracle gate**. It has no portfolio/arms/explore-exploit layer at all. We borrow its gate mechanics wholesale (§7) and build the portfolio layer it lacks.

## 3. Goals / Non-goals

**Goals (MVP)**
- **Append-only cycle log as the single source of truth**; every derived view (FRONTIER, scoreboard, dead-routes, banked-machinery, staleness) is recomputed from the immutable log, never stored as mutable state. Records **supersede**, never overwrite — so "proved-then-narrowed" and "banked-then-retracted" are representable.
- A tiny **FRONTIER + portfolio scoreboard** injected every turn via `UserPromptSubmit` / `SessionStart`, phrased as factual state.
- **Hard enforcement at the turn boundary** (`Stop` hook): the turn cannot end until this wave's outcomes are logged and a next-cycle decision is recorded; the **frontier-stall breaker** forces an EXPLORE/PIVOT when an arm's residual survives *k* independent attacks.
- **Minimum ceremony:** the per-pull `fr log` is the one required call; the FRONTIER and ledgers update as a side effect. No arithmetic by hand.
- **Orchestrator-only, fail-closed, file-gated hooks** (§9): inert unless `.frontier/` exists; if the referee can't run, it **blocks** (a gate that fails open is worthless). Subagents never touch the tool.
- The CLI emits **hook-ready JSON**, so `settings.json` entries are trivial one-liners.

**Non-goals (explicitly out of MVP)**
- No real UCB/Thompson arithmetic. Glyphs, rungs, and pull-counts are *salience devices*, not an optimiser. (Rigour-weighted optimism with decay is v2 — §13.)
- ~~No multi-arm-per-turn.~~ **Retired.** A wave fans out across arms; the tool logs one record per arm-pull. (§4.2)
- **No automatic artifact detection.** `progress`/`banked` must cite an artifact reference by hand; `banked` additionally needs an independent verdict (§7).
- No concurrency primitives, no DB, no multi-session merge. Single project, single log file. (The log being append-only *is* the cross-session/outage merge story — §4.7.)
- **The tool certifies provenance and consistency, not mathematical truth.** Even the audit gate is bounded — over-trust of an oracle is the central residual risk; `trust` labels are normative, not enforced (§7, borrowed from `bean`). `fr` makes a wrong claim *hard*, not impossible.
- Not an agent framework. It is a logbook with a referee and a portfolio.

## 4. Model of operation

### 4.1 Arms (the portfolio)
An **arm** is one approach/route in the portfolio, registered with a short id and description. Each arm carries:
- a **priority** ∈ `primary | exploratory | support | background | logged | dead` (graded funding, not binary alive/dead — Fable demoted arms to "cheap background probes" rather than killing them);
- a **current target** — the named open it is presently attacking (`(EX)`, `lem-foo`, …), capturing the two-level portfolio lightly;
- a pre-registered **kill criterion** (the condition under which it should be abandoned).

Derived per arm (never stored): `pulls`, trailing outcome strip, **best evidence rung reached**, **frontier-stall** (consecutive independent pulls whose target/residual did not move), aggregated `P(true)`, status.

### 4.2 Cycle = wave
A **cycle** is one orchestrator turn ≈ one **wave**: the orchestrator may dispatch a fan-out of subagents across one or more arms, then logs **one `fr log` record per arm-pull** (per returned worker batch). The breaker and all per-arm derivations read the immutable log, so multi-arm waves need no special accounting. ("One arm per turn" was a solo-agent simplification; a *coordinator* naturally logs one line per pull.)

**No-wave turns (`orient ·`).** Not every turn runs a wave: a fresh orchestrator *familiarising* with the project, or a turn spent planning / answering the user, dispatches no subagents. The Stop hook (G1) still requires the turn be accounted for, so without a channel the model fakes a junk `null` arm-pull — which inflates the arm's pull-count and stall counter (two such nulls trip the breaker on pure orientation). A seventh outcome **`orient ·`** (`fr orient "<why>"`) gives no-wave turns their own channel: an **off-arm** (`arm:null`), decision-less record that **satisfies G1** but is **not a pull** (the per-arm `pulls`/strip/`stale` walk never sees it) and is **breaker-neutral**. It mirrors the `discovery ⟡` shape (§4.8) but, unlike a discovery, it *is* a valid way to end a turn (a discovery is *additional to* a wave, never a substitute; an orient *is* the no-wave turn). A brief reason is required so the log stays auditable, and the board surfaces the count (`NO-WAVE TURNS: ×N`) so the no-wave escape is visible, never hidden. This adds no new gaming hole — the junk-null escape it replaces already existed; it just stops it corrupting the portfolio metrics.

### 4.3 Outcomes are rungs of a rigour ladder
A single `▲` is too coarse for evidence against a conjecture. The outcome of an arm-pull is one of:

| Outcome | Glyph | Meaning | Hard requirement |
|---|---|---|---|
| `banked` | `▣` | result locked into the proved machinery | a **passing, non-stale, independent verdict** (audit gate, §7) |
| `progress` | `△` | a *claimed* result, not yet audited | a **resolvable** `--artifact` + `--class`/`--tier` |
| `died` | `✗` | the modal outcome: attempt died at a sharp, named residual | `--at "<residual>"` (the death certificate) |
| `refuted` | `⊘` | a counterexample killed the current target | the counterexample `--artifact`; auto-creates a dead-route |
| `null` | `—` | genuinely nothing learned (dead weight) | — |

**Evidence class** (open vocabulary; the user's six types + room for more): `lit` (local ground truth) · `num` (numerics) · `side` (side-conjecture formulated/proven) · `af` (adversarial-proof rigour) · `lean` (machine-checked) · `…`. **Tier** (orthogonal, per artifact): `T0` proof/theorem · `T1` certified computation (exact/interval + error theorem) · `T2`/`GUIDANCE` floats & literature numerics. `banked ▣` is the only strong reward, and it is unreachable without the gate; `progress △` is a weak, decaying signal (a numeric hit is not a proof).

### 4.4 Decision (every turn ends on one)
`EXPLOIT <arm>` (keep funding the same arm) · `EXPLORE <arm>` (fund a different arm) · `PIVOT <arm>` (same problem, *mandated change of technology / reframe / supersede a belief* — borrowed from `bean`'s pivot primitive, for when the arm is right but the attack is exhausted). The FRONTIER may be updated in the same turn (`fr frontier "<new reduced open>"`) when a pull reduces it.

### 4.5 Circuit-breaker (frontier-stall, the one non-negotiable rule)
Enforced by the harness, not trusted to the model. The breaker fires when an arm accrues **`stale_threshold` consecutive pulls (default 2) that do not reduce the FRONTIER** — i.e. that neither bank/progress/refute a result nor record a `frontier_after` reduction. On fire, the next decision **must** be `EXPLORE` to a *different* arm or `PIVOT` (not `EXPLOIT`, not EXPLORE-to-the-same-arm).

Why frontier-reduction, not a null counter and not a residual-rename:
- **A productive death is progress — but only if it *reduces the open*.** A death that records a reduced FRONTIER (the orchestrator runs `fr frontier`, as Fable did: Kernel → (TREE) → (SB) → (EX)) **resets** the breaker. A death that merely *renames the `died-at` residual* does **not** reset it — otherwise the model could paraphrase its way around the one non-skippable rule. The residual is the death certificate (it feeds the dead-routes ledger and the board); it does **not** drive the breaker.
- **The real staleness signal is "the same wall survives diverse attacks."** Pulls by **different model families** count as independent attacks (the board surfaces `distinctFamilies`); the breaker is most justified when one wall survives two of them. The breaker's job is to interrupt over-concentration, **not** to judge the math.

### 4.6 Untried-arm optimism (diversification mandate)
Arms with zero pulls render as `??` and sort to visible prominence, so roads-not-taken get attention mass the active arm's token volume would otherwise deny them. Display-level in MVP; a **rigour-weighted decaying bonus** is v2 — the decay is the one bandit term that must eventually be real, and here it is *rigour-relative*: weak (`T2`) evidence ages fast, `banked` evidence is sticky.

### 4.7 The log is the checkpoint (resilience)
Because the log is append-only and on disk, it *is* the outage/compaction checkpoint. The orchestrator re-orients after any break by reading the derived FRONTIER+board, not the conversation. The Fable resilience protocol maps directly: bounded waves (an interruption loses at most one pull), log-early, and an *orchestrator-local-probe* mode (when the swarm is unreachable, the orchestrator still logs local numerics/derivations as pulls).

### 4.8 Off-goal discovery (the discovery ledger) — `prd-discovery.md`
The breaker measures progress against the *locked* FRONTIER, so a genuine **off-goal** result reads as "no progress" and could even trip it — the anti-tunnel-vision rule is also anti-serendipity. A sixth outcome **`discovery ⟡`** (`fr discover "<obs>" --question "<falsifier / why it matters>"`) gives off-goal results their own channel: an **off-arm** (`arm:null`) record that is **breaker-neutral** (the per-arm `stale` walk skips it), trusted **weaker** than a banked result (`class=stated` until externally checked), and parked in a derived **discoveries ledger** on the board. Capture is cheap; `--question` (Platt's *The Question*) is the required recognition step. Three log-derivable, advisory signals salience the ledger: **reuse** (distinct *other* arms that `--cites` it — POET's transfer signal and the promotion bar), **learning-progress** (a citing pull that *moved* the frontier), **surprise** (a usable artifact despite a low `p_true`). A reuse-0, non-`T0` discovery **decays** off the board over time (the record stays — F5). Promotion is a three-rung ladder: park → **promote-to-arm** (`fr arm add --from-discovery`, same goal, liberal) → **fork** (`fr fork`, a new campaign, gated). The single locked goal is **not** relaxed inside a campaign — one `.frontier/` = one goal; multi-goal happens only by *forking* a new `.frontier/`, which is what preserves the "one orchestrator = one goal" property (§1). Rationale, computable-signal menu, and sourcing: `prd-discovery.md` (grounded in the lit review in `docs/research/`).

## 5. Data model

State lives in `.frontier/` at project root (gitignore-able, or committed as the campaign record).

**`.frontier/portfolio.json`** — small, mostly static config + arm registry:
```json
{
  "goal": "prove <conjecture>",
  "frontier": "(EX): every row-stochastic idempotent P with δ(P)≤1/4 has an actual-row basis U with Vol(U)≥½·Vol_max and max_s Φ_s(U) ≤ C₀·δ",
  "config": { "stale_threshold": 2, "max_blocks_per_turn": 2,
              "evidence_bar": { "banked": "T0+independent-verdict", "progress": "any-artifact" } },
  "arms": [
    { "id": "A", "desc": "quasi-FF finite-size criteria (Knabe beyond FF)",
      "priority": "primary", "target": "(EX) at rank ≥ 3",
      "kill": "multipliers ~1/√δ on clean small-δ samples", "created": "2026-06-21T10:00:00Z" }
  ]
}
```

**`.frontier/log.jsonl`** — append-only, one record per arm-pull:
```json
{"ts":"2026-06-21T10:42:00Z","cycle":37,"wave":"w37","arm":"A","target":"(SB)",
 "outcome":"died","at":"path-product floor Π_C ≳ τ − O(Lδ)","note":"selection proven irreducible",
 "evidence":{"class":"af","tier":"T0","artifact":"proofs/lem-sb-floor","verdict":"claimed"},
 "workers":[{"model":"opus","role":"prover"},{"model":"codex","role":"refuter"}],
 "p_true":0.48,"p_audit":0.30,
 "decision":{"type":"EXPLOIT","arm":"A"},
 "frontier_after":"(SB) one scalar display"}
```
Append-only is load-bearing: `check`/`board` derive everything from it; the model cannot quietly reset a stale counter or un-bank a retraction. A later record may `supersede` an earlier one (downgrade/retract) by id.

**`.frontier/turn.json`** — ephemeral, written by `UserPromptSubmit` so `Stop` can diff: `{ "log_len_at_turn_start": 36, "blocks_this_turn": 0 }`.

**`.frontier/verdicts/<claim>.<oracle>.json`** — (v1.1) scrubbed, hash-bound oracle verdicts (§7), recorded once and replayed; bound by `claim_hash + oracle_digest + inputs_hash`; auto-**stale** when any of those change.

Derived, never stored: per-arm `pulls` / outcome-strip / best-rung / `stale` / status; the **FRONTIER trail** (the sequence of reductions); the **dead-routes ledger** (`refuted` records + `died`-marked-terminal, keyed on `at`, carrying the killing wave); the **banked-machinery ledger** (`banked` records + constants); the **discoveries ledger** (off-goal `discovery ⟡` records — `arm:null`, `question`, `cites` — with derived `reuse` / learning-progress / surprise + promotion status, §4.8); the **no-wave-turn count** (`orient ·` records — `arm:null`, surfaced as `NO-WAVE TURNS: ×N`, §4.2).

A **discovery** record (`outcome:"discovery"`) is off-arm/off-frontier and carries `question` (required) + optional `cites`/`evidence`; a `fr fork` appends an inert `fork_of` marker and writes a child `.frontier/portfolio.json` carrying `forked_from {repo, goal, cycle, discovery, inherits}` (a snapshot, not a live link — the child re-banks via its own oracle).

## 6. CLI surface

```
fr init "<goal>"                                  # create .frontier/, set goal
fr arm add <id> "<desc>" [--priority P] [--target "<open>"] [--kill "<criterion>"]
fr arm add <id> --from-discovery <cycle>          # promote a parked discovery into a new arm (same goal)
fr arm set <id> [--priority P] [--target "<open>"] [--kill "<criterion>"]   # re-aim / re-weight (allocation)
fr frontier "<the single live named open>"        # record a FRONTIER reduction
fr log <arm> <outcome> "<one clause>" \            # THE per-pull call
       [--at "<residual>"] [--artifact <ref>] [--class lit|num|side|af|lean|…] [--tier T0|T1|T2] \
       [--worker model:role]... [--p-true x] [--p-audit y] \
       --decide <EXPLOIT|EXPLORE|PIVOT> <next-arm>
fr discover "<observation>" --question "<falsifier / why it matters>" \   # off-goal capture (§4.8)
       [--artifact <ref> --class <c> --tier <t>] [--cites <ref>]...
fr orient "<why this turn ran no wave>"            # no-wave turn marker (§4.2): off-arm, satisfies G1, not a pull
fr fork <cycle> --goal "<new goal>" --frontier "<new open>" \             # spin a discovery into its OWN campaign (gated)
       [--dest <path>] [--first-arm <id>:"<desc>"]
fr verify <claim> --oracle <name>                  # (v1.1) run an oracle → scrubbed hash-bound verdict (enables banked)
fr board [--hook prompt]                            # render FRONTIER + scoreboard + dead-routes; --hook → UserPromptSubmit JSON
fr check [--hook stop]                              # referee; --hook → Stop JSON + exit code
fr status                                           # human-readable summary (no hook wrapping)
fr lessons [--markdown]                             # (v2) cross-cycle: recurring dead-routes, high-churn arms
```

`fr log` validates inline (fail at write time, not only at `Stop`): rejects `progress`/`banked` without a resolvable `--artifact`; rejects `banked` without a passing non-stale verdict; rejects `died` without `--at`; rejects an `EXPLOIT`/same-target decision when the breaker is tripped; rejects a `refuted`-with-residual that tries to also self-tag `banked` (anti-laundering, §7).

## 7. Referee logic (`fr check`) and the bank gate (`fr verify`)

Deterministic, LLM-free, unit-testable. Split borrowed from `bean`: **`fr check` is a pure adjudicator that never executes anything; `fr verify` is the only path that runs an oracle.**

**`fr check`** reads `log.jsonl` + `turn.json` + `verdicts/`. Gates, in order:
- **G1 — logged this turn.** the turn appended no **arm-pull** *and* no **`orient ·`** marker → fail: *"No wave outcome logged this turn. Record it with `fr log …` (or `fr orient` if no wave ran)."* A turn accounted for by an `orient` marker alone (a no-wave turn) satisfies G1 and **skips the wave gates** (G5/G2/G_launder/G2b/G3/G4 — there is no wave to adjudicate, and crucially G4 cannot fire on a legitimate first-turn orient).
- **G2 — progress/banked is backed.** newest `outcome ∈ {progress, banked}` with no **resolvable** `--artifact` → fail. (Resolvable = the path/id exists, or the ref parses to a registered external — *not* the model's say-so.)
- **G2b — banked is verified.** newest `outcome == banked` lacking a **passing, non-stale, independent** verdict → fail: *"`▣ banked` needs an audit verdict from an oracle/verifier other than the author. Run `fr verify` or downgrade to `△ progress`."*
- **G3 — circuit-breaker.** current arm's `stale ≥ stale_threshold` and newest `decision` is `EXPLOIT` or targets the same target → fail: *"Arm <X>'s residual <r> has survived <k> independent attacks. The next cycle must EXPLORE a different arm or PIVOT."*
- **G4 — turn ends on a decision.** newest record has no `decision` → fail.
- **G5 — died needs a death certificate.** `outcome == died` without `--at` → fail.

**Discovery / orient deltas (§4.2, §4.8 / `prd-discovery.md` §7).** G1 counts **arm-pulls** plus the **`orient ·`** no-wave marker — a turn that logs only a `discovery ⟡` has not logged its wave outcome and still blocks (a discovery is *additional to* a wave), whereas a turn that logs an `orient` *is* an accounted-for no-wave turn and passes; G3/G4 read the newest *arm-pull*, so a trailing discovery or orient cannot spuriously trip them. `fr discover` validates **The Question** at write; `fr fork` enforces **GF** (fork eligibility: a stateable new frontier + a new goal + `reuse ≥ 2` **or** learning-progress) at write. A discovery is `class=stated` until externally checked — it can never self-tag `banked`.

**Anti-laundering** (borrowed from `bean`, stated as invariants): a `died`/residual tag cannot mask a `refuted` (a real counterexample is `refuted`, not "died productively"); a failing oracle verdict can never be upgraded to `banked` by self-reported JSON (signal may only *downgrade*); a worker's "it's fine" is `class=stated`, never `tested`/`banked`.

**`fr verify <claim> --oracle <name>`** (v1.1): runs a registered oracle (`argv`, no shell) — an `af` workspace check, a `lean` build, a numerics re-run — with the claim on stdin; writes a **scrubbed** verdict (hashes + pass/fail only, raw log gitignored) bound to `claim_hash + oracle_digest + inputs_hash`. The verdict **goes stale** (re-blocks `banked`) if the claim text, the oracle, or its inputs change. Honest limit (stated, not hidden): `fr` cannot prove an oracle is sound; `trust` labels are normative.

**Internal convergence ≠ correctness** (the principle behind all of the above): a self-consistent log can converge cleanly on a *wrong* reading of the problem. `fr check` certifies provenance and the protocol; only `fr verify` reaches toward truth, and only as far as its oracle is trustworthy.

**Loop guard.** If `blocks_this_turn ≥ max_blocks_per_turn` (default 2), do **not** hard-block again — emit the message as `additionalContext` (exit 0) and allow the stop. Keeps the breaker well clear of Claude Code's 8-consecutive-block session kill. `blocks_this_turn` is incremented per block, reset by `UserPromptSubmit`. **Fail-closed:** if `fr check` cannot run / emits no JSON / sees an unknown status on an active `.frontier/`, it **blocks** the stop.

Output contract: pass → exit 0, `{}` (or a soft `additionalContext` reminder). Hard fail under the guard → exit 0, `{"decision":"block","reason":"<the G-message>"}`. (The `reason` *is* allowed to be imperative — it's a next-step instruction to the model, unlike injected context.)

## 8. The board (`fr board`)

Three blocks, factual-state phrasing only (imperative text trips Claude Code's prompt-injection defence and gets surfaced to the user instead of used as context). The board is the orchestrator's externalised big picture — for a long campaign it is a token *saving*, replacing paragraphs of self-narration with ~12 derived lines that survive compaction.

```
FRONTIER — goal: prove <conjecture>.
OPEN: (EX) one existence inequality at rank ≥ 3.  (trail: Kernel → (TREE) → (SB) → (EX))
BANKED: rank-2 theorem C=2; factorization S* ≤ 2Φ+6δ; θ=1/2 mandatory.
ARMS:
  A primary  6 pulls  ▣△✗✗——  best:T0  target (EX)  residual stalled ×2
  B support  2 pulls  △✗       best:T1  target (SB*)
  C explore  untried ??
DEAD ROUTES (do not re-walk): coefficient-only LP (w30); universal C≤2 (w33); Jensen/convexity (w33).
```

`--hook prompt` wraps it as `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…"}}`. Token budget: O(arms) lines + a bounded dead-routes/banked tail; truncate notes hard.

## 9. Claude Code hook wiring (orchestrator-only)

Only the orchestrator session installs these. Subagents (Agent-tool / `codex exec` lanes) run in their own sessions without `.frontier/` hooks, so they are free of the tool by construction — and the hook is **inert unless `.frontier/portfolio.json` exists**, so any stray session is zero-cost.

`.claude/settings.json` (paths via `$CLAUDE_PROJECT_DIR`; stdout must be JSON-only):
```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.frontier/bin/fr board --hook prompt" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.frontier/bin/fr turn-begin && $CLAUDE_PROJECT_DIR/.frontier/bin/fr board --hook prompt" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.frontier/bin/fr check --hook stop" }] }]
  }
}
```
- `SessionStart` / `UserPromptSubmit` → inject the board (recency slot). `UserPromptSubmit` also stamps `turn.json`. Mind the 30 s `UserPromptSubmit` timeout — the hot path must be trivial (§11).
- `Stop` → run the referee; block-with-reason on violation, self-limited by the loop guard, fail-closed.
- Hooks are snapshotted at session start; use `/hooks` to review after edits.

## 10. Model-side protocol (goes in `CLAUDE.md`)

Kept to a ritual — Fable already runs this; the ritual just makes it legible to any model:
> You are the **orchestrator**. Each turn is a **wave**: brief and dispatch subagents, harvest, and before ending the turn log **one `fr log` per arm-pull**: `fr log <arm> <outcome> "<one clause>" [--at "<residual>"] [--artifact <ref> --class <c> --tier <t>] [--worker model:role …] --decide <EXPLOIT|EXPLORE|PIVOT> <next-arm>`. `△ progress` needs a real artifact; `▣ banked` needs an independent `fr verify`; `✗ died` needs the residual it died at. If the board shows an arm's residual stalled at the threshold, the next decision must be EXPLORE or PIVOT. Update `fr frontier` whenever the open reduces. Subagents do the object-level work and return artifacts; **only you touch `fr`.** Do **not** raise sampling temperature to "explore" — exploration is a decision, not token noise. If a wave turns up an **off-goal** result worth keeping, park it with `fr discover "<obs>" --question "<falsifier / why it matters>"` — off-arm and breaker-neutral, *additional* to (never a substitute for) your wave's `fr log`. If a turn ran **no wave at all** (you were orienting, planning, or answering the user), end it with `fr orient "<why>"` — a no-wave marker that satisfies the Stop hook without faking a `null` arm-pull. Do **not** log a junk `null` to escape the hook.

## 11. Implementation: Bun (the chosen stack)

**Language: Bun + TypeScript.** Rationale: Claude's TS/JS post-training makes this the fastest path to a *correct* tool, which dominates raw runtime for a tool this small. This refines v0.1 §9 (which ruled out Julia for JIT/startup latency and allowed "a compiled single binary or a genuinely fast-start script"):
- **Ship a standalone binary.** `bun build ./src/fr.ts --compile --outfile .frontier/bin/fr` embeds the Bun runtime → a single executable that needs neither `bun` nor `node` at runtime. Self-contained, zero runtime deps, no network. Drop it at `.frontier/bin/fr`.
- **Cold start ≪ perceptible.** Fires on every prompt and every stop (`UserPromptSubmit` has a 30 s timeout and blocks model processing). Target **< 50 ms, ideally < 30 ms**. The compiled binary clears this comfortably; the hot path (`board`, `check`, `turn-begin`) must read only `portfolio.json` + `log.jsonl` + `turn.json`, compute, and print JSON — **no heavy imports, no dynamic require, no network**. **Acceptance gate: measure the compiled-binary cold start on the hook path and confirm < 50 ms before wiring live** (§14).
- **Hook hygiene.** Read JSON on stdin, write **only** JSON on stdout, signal via exit codes. Route every log/diagnostic to stderr — any stray stdout byte breaks JSON parsing. No startup banner.

## 12. Relationship to the sister repos

The target is a **greenfield conjecture**, not one of the existing repos — so `fr` takes the sister repos' *instincts* and leaves their *apparatus* behind:
- the **append-only memory** (`worklog/`, `orchestration/log/`, `log.jsonl`) — kept;
- the **provenance reflex** (every claim resolves to a real artifact) — kept, as the evidence ladder;
- beads / the `af` registry / the typed-module DAG — **not inherited on day one**; they re-enter only as the *top rungs* of the evidence ladder (`af`, `lean`), opt-in, when an arm matures.

`haldane-conjecture` is the canonical template and a Fable artifact: `fr`'s derived views map onto its hand-kept layout almost 1:1 — `log.jsonl` ↔ `orchestration/log/`, the board's scoreboard ↔ `STATE.md`'s route table, the FRONTIER block ↔ `HANDOFF.md`, arms ↔ `attacks/{A..E}` + `lean`, evidence classes ↔ `literature/ numerics/ lean/`. **The tool owns the bookkeeping those files held by hand, and can optionally render to them** — the lab book becomes a *derived view* of the log. This is the answer to "compatible with the sister repos": `fr` is the engine; the lab book is its projection.

## 13. Phasing

- **MVP (smoke test).** `init`, `arm add/set`, `frontier`, `log`, `board`, `check`, `status`. Frontier-stall breaker; the five-rung outcome vocabulary with `died-at`; G1/G2/G3/G4/G5 + anti-laundering at write time; board = FRONTIER + scoreboard + dead-routes. No oracle execution yet (`banked` allowed with a self-cited artifact, flagged unverified).
- **v1.1 — the bank gate.** `fr verify` + oracle config + hash-bound scrubbed verdicts + G2b (`banked` needs an independent verdict). This is the `af`/`lean`/numerics-rerun rigour rung and the real anti-gaming close.
- **v2.** `fr lessons` (cross-cycle recurring-dead-route + high-churn mining, *consumed* by the orchestrator — a deliberate step past `bean`'s "propose-never-apply" line, stated as such); rigour-weighted decaying optimism (the real bandit term); brief-archiving / resilience automation; multi-arm allocation accounting; validating `--artifact` against a sister-repo claim ledger.
- **Discovery ledger + fork (built — `prd-discovery.md`, D1–D3).** `fr discover` (off-goal capture, §4.8) + the derived discoveries ledger (reuse / learning-progress / surprise signals, decay); `fr arm add --from-discovery` (promote-to-arm); `fr fork` (gated child campaign). Grounded in the cross-disciplinary lit review in `docs/research/`.
- **No-wave turn marker (built — §4.2).** `fr orient "<why>"`: an off-arm, breaker-neutral, decision-less record that satisfies G1 for a turn that ran no wave (orientation / planning / answering the user), so the orchestrator no longer fakes a `null` arm-pull to end such a turn. Not a pull (zero effect on any arm's pulls/strip/stall); surfaced factually as `NO-WAVE TURNS: ×N`.

## 14. Acceptance / smoke test

**Unit (no LLM):**
1. `fr init "test"`; `fr arm add A "smearing" --target T1`; `fr arm add B "numerics"`.
2. Two `died` pulls on A (no FRONTIER reduction) with a same-arm `EXPLOIT` → `fr check` fails **G3** (frontier-stall); a `died` that records a `frontier_after` reduction instead resets the breaker (check passes). A `died` that merely renames the residual does **not** reset it.
3. `fr log A died "…" --at "loose bound" --decide EXPLORE B` → `fr check` passes.
4. `fr log A progress "…"` without `--artifact` → rejected at write time (**G2**); with `--artifact proofs/lem-x --class af --tier T0` → accepted as `△`.
5. `fr log A banked "…" --artifact proofs/lem-x` with no verdict → rejected (**G2b**); after `fr verify lem-x --oracle af` passes → `▣` accepted; mutate the claim → verdict stale → `banked` re-blocks.
6. A `refuted` record that also tries to self-tag `banked` → rejected (anti-laundering).
7. After two forced blocks in one turn, the third `fr check` emits `additionalContext` (exit 0), not a block — loop guard holds. With `.frontier/` absent or `check` erroring, the hook **blocks** (fail-closed).
8. `fr board` renders the FRONTIER trail, the glyph/rung strip, marks B `??` (untried), and lists dead routes.
9. **Latency:** the compiled binary's `board` and `check` cold-start < 50 ms on the hook path.

**Live (Claude Code session, hooks installed, orchestrator only):**
10. Board appears at session start and before each prompt, as factual state.
11. Drive arm A's residual to the stall threshold across a multi-arm wave; confirm `Stop` blocks and the next turn EXPLOREs/PIVOTs.
12. Confirm subagent sessions never trigger the hook (file-gating verified) and the session is never killed by the 8-block cap.

## 15. Locked decisions (resolved 2026-06-21)

All five forks are decided; the MVP spec in §13 is buildable as-is.

1. **Stale threshold `k = 2`** consecutive pulls that **do not reduce the FRONTIER** fires the breaker (a residual rename does not count as a reduction — §4.5). The board additionally tracks how many *distinct model families* hit the same wall (the strongest switch signal); a same-family-only-repeat ½-weighting is a **v1.1 refinement**, not MVP. (`config.stale_threshold = 2`.)
2. **Keep `P(true)`/`P(survives audit)` — advisory-only.** They sort/salience the board but can **never** promote a result (only `fr verify` banks) and the breaker ignores them. Optional fields on `fr log`.
3. **Single-level arms + a `target` field** for MVP; full lane ⊃ sub-arm nesting deferred to v2.
4. **`.frontier/` is committed** — the append-only log *is* the campaign record ("one harvest = one commit"). Only `.frontier/bin/` and any raw verdict logs are gitignored.
5. **Lab-book render (STATE.md/HANDOFF.md projection, §12) deferred to v2.** MVP keeps state in `.frontier/` only.
6. **Discovery ledger + fork (§4.8, `prd-discovery.md`).** Off-goal results get a breaker-neutral `discovery ⟡` channel. Resolved 2026-06-22: **(A)** fork-eligible at `reuse ≥ 2` **or** learning-progress; **(B)** decay is rigour-weighted and **hides, never deletes**; **(C)** the `progress`-resets-breaker tightening is **deferred** (no change to decision 1 / §4.5 — flipped on only if instrumentation shows persistent progress-theatre). **One goal per `.frontier/` is preserved** — multi-goal happens only by forking a new campaign.

## 16. Provenance (what we borrowed, and from where)

- **The wave model, two-level portfolio, `died-at`-as-success, the FRONTIER block, dead-routes ledger, claimed→audited→banked, the two-family bar, calibrated credences, the resilience protocol, and the demotion-not-kill priority grades** — reverse-engineered from the Fable campaigns in `almost-idempotent-positive-maps/agent-A/explorations/classical-portfolio/` (waves `w1–w43`, June 10–13) and `haldane-conjecture/` (session 001, June 9), including the in-repo `ORCHESTRATION.md` / `STATUS-LEDGER.md` / `STATE.md` / `HANDOFF.md` / `agents.md` and the June-9 orchestrator transcript.
- **The fail-closed file-gated Stop hook, the pure-adjudicator/quarantined-verifier split, replayable hash-bound verdicts that go stale on change, frontier-based progress (pivot-don't-stop), the residual discipline, the anti-laundering rules, the briefing/reviewer≠author contract, and "internal convergence ≠ correctness"** — adapted from `bean` (github.com/grainulation/bean, v2.1.0), an independent capture of the same Fable behaviour from the task-convergence angle.
- **The append-only-log-as-truth, derived recency-injected scoreboard, hook-ready JSON, factual-not-imperative board, and the loop guard** — retained from v0.1 (TJO).
