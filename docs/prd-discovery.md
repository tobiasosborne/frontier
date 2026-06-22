# PRD — Discovery ledger & campaign fork (`fr`)

**Status:** design doc **DRAFT v0.1** — an extension to the canonical [`docs/prd.md`](./prd.md) (v0.2).
**Owner:** TJO.
**Grounding:** every mechanism below is tagged to a finding (F1–F10) in
[`docs/research/discovery-ledger-lit-review.md`](./research/discovery-ledger-lit-review.md), whose primary
sources are mirrored in `docs/research/ground-truth/` (gitignored).
**One-line goal:** give the orchestrator a first-class way to **notice, capture, and reward an off-goal
discovery** — a result useful in its own right that the locked FRONTIER neither asked for nor rewards — and a
gated path to spin it into its own campaign, *without* weakening the anti-tunnel-vision spine or the
append-only-truth model.

> **What this changes from the canonical PRD (read first).**
> 1. **The single locked goal is no longer a trap, but it is *not* relaxed within a campaign.** A `.frontier/`
>    still has exactly one `goal` and one `frontier`. Off-goal results get a **separate channel** (the discovery
>    ledger); a discovery only becomes a *second goal* by **forking a new `.frontier/`** (a new campaign, a new
>    orchestrator). The "one orchestrator = one goal" property the whole tool rests on (canonical §1) is
>    preserved — the fork is what preserves it. (§4.5 here)
> 2. **A sixth outcome: `discovery ⟡`.** Off-arm, off-frontier; captured by one cheap call; **neutral to the
>    circuit-breaker**. The five-rung ladder (canonical §4.3) is unchanged; this sits beside it. (§4.1)
> 3. **A new derived ledger** (the discoveries ledger), sibling to dead-routes and banked-machinery, with
>    **computable interestingness signals** (cross-thread reuse, learning-progress, low-prior surprise) —
>    derived from the log, never stored (L2). (§4.2–4.3)
> 4. **A three-rung promotion ladder:** park → promote-to-arm (same goal, liberal) → fork-to-goal (new
>    campaign, gated and deliberately expensive). (§4.4–4.5)
> 5. **An anti-progress-theatre tightening** of the existing `progress △` reset rule (grounded in
>    learning-progress, F7) is **specified but deferred** (Decision C, resolved 2026-06-22): D2 *instruments*
>    progress-theatre via the reuse/learning-progress signals; the enforcement change is left off until/unless
>    the data shows it as a persistent failure mode. **No locked-decision change in this PRD.** (§4.6, §12)

---

## 1. Problem — the controller is also a serendipity suppressor

The canonical tool is **goal-locked**: the circuit-breaker (canonical §4.5) resets *only* on a pull that
reduces the one FRONTIER. A genuine off-goal discovery does not reduce *this* frontier, so it reads as a
non-moving pull and **can actively trip the breaker**. The anti-tunnel-vision machinery is therefore *also*
anti-serendipity machinery.

This is not a stylistic worry. A single fixed objective is **provably deceptive** — it does not reward the
stepping stones that lead off it, and ignoring it to reward novelty can dramatically outperform pursuing it
(Lehman & Stanley: 39/40 vs 3/40 on the deceptive hard maze; POET: capabilities unreachable by direct
optimization at all) **(F4)**. A second, objective-decoupled reward channel is the documented cure, not a
nicety.

**Scope discipline (what this is *not*).** Decoupling reward from the objective buys **reachability** —
results the locked goal can't get to — **not** a better assault on the locked goal. The claim "diversity beats
direct optimization *on the objective itself*" was **refuted** in verification (lit review, Refuted §). The
discovery channel must never present itself as a faster route to the locked goal.

## 2. What the literature licenses (and forbids)

You cannot plan or force serendipity, but you **can** reliably engineer three things (lit review TL;DR): a
low-cost **capture ritual** (notice-and-park before judging — F2), a persistent **archive** against which
novelty/reuse is computed (F5), and an **incentive channel decoupled from the single objective** (F4). The
load-bearing enabler for `fr` specifically: **the append-only log makes both interestingness *and*
anti-progress-theatre checkable without trusting the claim** — every usable signal is a comparison against
*recorded prior state*, and you cannot fabricate history you never logged (F7).

Forbidden by the evidence: rewarding **raw surprise/novelty** (the noisy-TV / leaf-in-the-wind trap — reward
*learning progress*, the decrease of error over time, instead — F7); treating the CD/disruption index as a
drop-in computable signal (**refuted** — needs a citation network); treating the intrinsic-motivation typology
as a turnkey formula menu (**refuted**).

## 3. Goals / Non-goals

**Goals**
- A **one-line capture** for an off-goal result, carrying the recognition step the prepared-mind result
  requires (exposure alone does not pay off — F1): `fr discover "<obs>" --question "<falsifier / why it
  matters>"`.
- A **derived discoveries ledger** (L2) with **pure, log-derivable** interestingness signals (L4).
- **Breaker neutrality:** a discovery never trips or resets the frontier-stall breaker (F10).
- **Promotion** up three rungs, with the expensive rung (fork) **gated** by an objective, log-derivable bar.
- **Preserve every Law:** append-only truth (L2), pure deterministic core (L4), zero runtime deps, < 50 ms hot
  path. The fork's only impure work (scaffolding a child `.frontier/`) lives at the edge, like `fr init`.

**Non-goals**
- **No multi-goal campaign.** One `.frontier/` = one goal. Multiple goals = multiple `.frontier/` via fork.
- **No "interestingness" LLM judge.** Signals are deterministic functions of the log; the orchestrator (an
  LLM) decides what to *do* with them. The tool stays "a logbook with a referee and a portfolio" (canonical
  §3).
- **No k-NN behavioral-novelty archive in v1.** It needs a feature representation for residuals/lemmas
  (open question 2, lit review); deferred. Cross-thread **reuse** is the v1 novelty proxy.
- **No auto-launch of a forked campaign.** `fr` *materializes* a child workspace; starting its orchestrator
  (a new session, new hooks) is out of band.

## 4. Model of operation

### 4.1 Discovery — the off-goal outcome (the capture ritual)
A **discovery** is an append-only log record that is **off-arm and off-frontier**. It is captured by a single
cheap call mirroring the one required `fr log`:

```
fr discover "<observation>" --question "<what would falsify this / why it matters>" \
            [--artifact <ref> --class <c> --tier <t>] [--cites <ref>]... [--p-true x]
```

`--question` **is Platt's "The Question"** — "what experiment could disprove this? / what hypothesis does it
disprove?" — the literature's sharpest named device for separating a real testable step from method-oriented
busywork (F8), and the recognition step F1 says raw exposure lacks. It is **required**: capture is cheap and
liberal (notice-and-park, F2), but every parked discovery must state *what would make it matter or be wrong*.

**Trust ladder (F1, F10).** A fresh discovery is `class=stated` / `verdict=claimed` — **never** `banked` or
`tested`. It rises only by answering The Question with a *resolvable* test and passing an external check
(`fr verify`), riding the existing `claimed → audited → banked` ladder and the anti-laundering invariant
(canonical §7). A discovery is *quarantined optimism*, not a result.

### 4.2 The discoveries ledger (derived, breaker-neutral)
Discovery records live in the **same `log.jsonl`** (L2 — single source of truth). `derive.ts`'s per-arm walk
iterates *registered arms only*, so a discovery (which names no arm) is **automatically neutral to every arm's
`stale` counter** — it neither resets nor increments it. That is the precise, implementable form of "exempt
from the breaker" (F10): the breaker interrupts *over-concentration on the locked goal*; an off-goal capture
is the opposite of over-concentration, so it must not read as a stale, non-reducing pull.

A new derived `discoveries` ledger — sibling to the dead-routes and banked-machinery ledgers (canonical §5) —
is recomputed from the log, never stored.

### 4.3 Interestingness — computable signals (pure, log-derivable)
Surfaced on the board; **advisory only** (like `P(true)`, canonical §15.2) — they salience the ledger, they
never gate. Ranked by translatability:

| Signal | Definition (pure over the log) | Source | Failure mode handled |
|---|---|---|---|
| **Cross-thread reuse** *(lead)* | # of later pulls **on a different arm** whose `--cites` names this discovery's artifact | POET transfer is load-bearing (F9) | robust; the v1 novelty proxy |
| **Learning progress** | a later frontier-reduction or stale-reset on an arm that `--cites` this discovery | Oudeyer-Kaplan decrease-of-error (F7) | rewards *unstuck*, not *shiny* — anti-noisy-TV |
| **Low-prior surprise** | landed a usable `--artifact` despite low pre-registered `--p-true` (or sourced from a `background`/`exploratory` context) | Oudeyer-Kaplan / ICM (F6) | combined with relevance (it produced an artifact) → serendipity = *unexpected AND relevant*, not raw error |

All three are comparisons against **recorded prior state**, which is what makes them (a) cheap for the pure
core and (b) immune to progress-theatre. Explicitly **excluded:** CD/disruption index (refuted as
non-computable on a small log).

### 4.4 Promotion ladder (three rungs)
- **Rung 1 · Park** — `fr discover`. The capture itself. Cheap, liberal, off-goal.
- **Rung 2 · Promote-to-arm** — `fr arm add <id> --from-discovery <cycle>`. Seeds a new arm against the
  *current* goal from the parked discovery (desc ← observation; `priority` defaults `exploratory`). This is
  Chamberlin's *method of multiple working hypotheses* — the canonical cure for tunnel-vision, which
  "distributes the effort and divides the affections" (F9). **No gate** — keep it liberal; it is cheap and
  same-goal, and it reuses the existing arm registry + EXPLORE/PIVOT decisions wholesale.
- **Rung 3 · Fork-to-goal** — `fr fork <cycle> …`. New campaign, new workspace. **Gated and deliberately
  expensive** (§4.5).

### 4.5 The fork (a new campaign, not a copy)
**The goal is the unit of workspace/session isolation.** A fork spins up a *fresh-context orchestrator* for
the new goal so the parent campaign stays focused on its own — the expense (a whole new session) is the
feature, because a multi-goal single session would re-import the context-accumulation pathology the tool
exists to fight (canonical §1). A fork is **four pieces, not a `cp -r`**:

1. **Scaffolding, copied** — `config` (oracles, thresholds). The reusable rig.
2. **The discovery, promoted to seed** — it becomes the child's `goal` + initial `frontier` (and optionally
   its first arm).
3. **Cited dependencies, by reference** — artifacts the discovery stands on are inherited as refs, **not as
   trust**; the child **re-banks** anything load-bearing through its own oracle. Snapshot, not live link — so a
   later parent retraction cannot silently rot the child, and L2 holds *per workspace*.
4. **Fresh log + provenance** — child `portfolio.json` records `forked_from {repo, goal, cycle, discovery}`;
   the **parent log** gets one discovery-supersession record marking the promotion. **Both logs stay complete
   and append-only** — genealogy survives on both sides, neither mutates.

`fr fork` **prepares** the child workspace and prints the next step; it does **not** launch the child
orchestrator (a new session / new hooks — out of band). The tool stays a logbook, not a session manager.

**Fork-eligibility gate (GF).** A discovery is fork-eligible only when **all** hold:
- **(a) a stateable new frontier** — `--frontier "<new open>"` is supplied and resolvable (this *is* The
  Question answered with a testable step; if you can't state it, it's not a goal yet — F8);
- **(b) an interestingness threshold** — `reuse ≥ k_fork` **or** demonstrated learning-progress (F7/F9) — i.e.
  the cheap, theatre-proof signals, **not** raw surprise;
- **(c) an explicit invocation** with `--goal`.

Default `k_fork = 2` (proposed — see §12, Decision A). The expense + GF together make forking rare and earned,
which is the literature's guard against *tunnel-vision-of-novelty* / fragmentation (F4 deceptive-objective
inverse).

### 4.6 Anti-progress-theatre (the learning-progress principle)
F7 gives the principled separation of real movement from self-asserted thin progress: **real movement is a
measurable decrease in a residual against a recorded prior state over time** — derivable from an append-only
log, unfakeable by a snapshot claim ("you cannot reduce a residual you never logged"). This both *re-justifies*
the existing "breaker resets on a FRONTIER reduction, not a residual-rename" rule (canonical §4.5) **and**
exposes a residual hole: today `progress △` resets the breaker (`MOVING_OUTCOMES = {banked, progress,
refuted}`), yet `progress` needs only a self-cited artifact — so repeated thin `progress` can perpetually
reset discipline without moving the open.

**Specified-but-deferred tightening (Decision C, resolved 2026-06-22 — defer):** *if* triggered, a `progress`
pull would reset the breaker **only** if it records a `frontier_after` reduction **or** is later
`--cites`-reused (learning-progress); a `progress` that does neither still logs as `△` but **no longer counts
as movement** for the breaker. This is a behavior change to a locked decision (canonical §15.1), so it is
**not** shipped now. **Instrument before enforce:** D2's reuse + learning-progress signals make theatre
*observable* — a run of breaker-resetting `progress` pulls with zero reuse and no `frontier_after` is its
measurable signature — so the rule above is held as a ready drop-in and flipped on only if that pattern
persists in a real campaign.

## 5. Data model (deltas to canonical §5 / `src/types.ts`)

**`Outcome`** gains `"discovery"`; `OUTCOME_GLYPH.discovery = "⟡"`.

**`LogRecord`** — `arm` becomes `string | null` (null **only** for discovery/fork records); two optional
fields added:
- `question?: string` — The Question (required for `outcome:"discovery"`).
- `cites?: string[]` — artifact refs this pull/discovery builds on (drives reuse + learning-progress).

A **discovery** record:
```json
{"ts":"…","cycle":41,"arm":null,"outcome":"discovery",
 "note":"diagonal of the transfer matrix is itself row-stochastic — unexpected",
 "question":"falsifier: exhibit a δ≤1/4 P whose diagonal is not stochastic; matters: gives a free invariant",
 "evidence":{"class":"side","tier":"T1","artifact":"proofs/obs-diag","verdict":"claimed"},
 "cites":[],"workers":[{"model":"opus","role":"prover"}],"p_true":0.2}
```

A **fork-promotion** record in the *parent* log (supersedes the discovery, marks it promoted):
```json
{"ts":"…","cycle":48,"arm":null,"outcome":"discovery","supersedes":41,
 "note":"promoted → fork","fork_to":{"path":"../diag-invariant","goal":"classify stochastic-diagonal idempotents"}}
```

**`ArmConfig`** gains `from_discovery?: number` (set by `fr arm add --from-discovery`; lets `derive` mark the
discovery promoted, purely).

**Child `portfolio.json`** gains `forked_from: { repo, goal, cycle, discovery }`.

**Derived (`DerivedState`)** gains `discoveries: Discovery[]`, each:
`{ cycle, observation, question, class, tier, artifact, reuse, learningProgress, surprise, status }` with
`status ∈ parked | promoted-arm | forked | decayed` — all recomputed, never stored.

## 6. CLI surface (deltas to canonical §6)

```
fr discover "<observation>" --question "<falsifier / why it matters>" \
            [--artifact <ref> --class <c> --tier <t>] [--cites <ref>]... [--p-true x]
fr arm add <id> --from-discovery <cycle> [--priority P] [--target "<open>"]   # Rung 2 (liberal)
fr fork <cycle> --goal "<new goal>" --frontier "<new open>" [--dest <path>] [--first-arm <id>:"<desc>"]
```

`fr discover` validates inline: requires `--question`; `progress`-style artifact rules do **not** apply (a
discovery may be artifact-less — it is `class=stated` until checked). `fr fork` enforces **GF** at write time
and fails closed with the unmet condition (e.g. *"discovery #41 has reuse 0 (<2) and no learning-progress —
not fork-eligible; promote-to-arm or accrue reuse first"*).

## 7. Referee additions (deltas to canonical §7)

- **G1 fix (loophole close).** "logged this turn" must count **arm-pulls only** — a turn that appends *only* a
  discovery has **not** logged its wave outcome. G1 fails unless ≥1 non-discovery record was appended this
  turn. (Otherwise a discovery could satisfy G1 and let the wave end undecided.)
- **Breaker neutrality.** Discovery records carry no arm and are skipped by the per-arm `stale` walk — no gate
  change needed beyond §4.2; covered by a perturbation test (L1).
- **GF — fork eligibility** (write-time, in `fr fork`): (a) resolvable `--frontier`, (b) `reuse ≥ k_fork` or
  learning-progress, (c) explicit `--goal`. Fail-closed.
- **Anti-laundering extension.** A discovery cannot self-tag `banked`/`audited` (it is `stated`/`claimed` until
  an independent verdict); a `refuted` counterexample is still `refuted`, never re-filed as a "discovery" to
  dodge the dead-routes ledger.

## 8. The board (delta to canonical §8)
A fourth, **bounded** block (token budget is load-bearing — canonical §8), shown only when non-empty,
newest-first, capped:
```
DISCOVERIES (off-goal, parked): 
  ⟡ obs-diag  side/T1  reuse×2  ⟲progress   "diagonal is row-stochastic"   [fork-eligible]
  ⟡ obs-spec  num/T2   reuse×0              "spectral gap tracks δ²"        [parked]
```
`reuse×n`, the `⟲` learning-progress mark, and the `[fork-eligible]` tag are all derived; notes truncated hard.

## 9. How the Laws hold
- **L2 (append-only / derived).** Discoveries, their ledger, and every signal are derived from `log.jsonl`;
  promotions and forks **supersede**, never mutate; the fork writes a *new* log, never edits the parent's.
- **L4 (pure core).** All signal derivation is a pure function of `(Portfolio, LogRecord[], Verdict[])`. The
  fork's filesystem scaffolding is an **edge** op (`store.ts` / `cli.ts`), exactly like `fr init` — no FS,
  clock, or LLM enters `derive`/`referee`/`board`.
- **Determinism / no deps / latency.** Signals are an O(log) join (reuse = artifact-ref match across records);
  the hot path still reads two files. Zero new runtime dependencies. Re-assert < 50 ms on the discovery board
  (acceptance §11).

## 10. Phasing
- **D1 — capture + ledger. ✅ built.** `fr discover` (+ The Question), `outcome:"discovery"`,
  breaker-neutrality, the derived ledger, the board block, G1 fix. Signals: **reuse** only.
- **D2 — promotion + signals. ✅ built.** `fr arm add --from-discovery` (Rung 2); learning-progress + surprise
  signals; decay policy (Decision B).
- **D3 — fork. ✅ built.** `fr fork`, GF, child scaffolding + provenance, the parent fork-marker record. The
  anti-theatre `progress` tightening (Decision C) is **deferred, not part of D3** — held as a ready drop-in,
  flipped on only if instrumentation shows persistent progress-theatre.

## 11. Acceptance / smoke test (TDD, L1 — failing test first, perturb load-bearing gates)
**Unit (no LLM):**
1. `fr discover "x" --question "q"` → appends `⟡`, `arm:null`; `fr check` G1 still **fails** if no arm-pull
   logged this turn (loophole closed) — *perturb G1 to count discoveries → test goes RED → restore.*
2. Two `died` pulls on A (no reduction) **plus** a `fr discover` between them → breaker still fires **G3** (the
   discovery did **not** reset `stale`) — *perturb the per-arm walk to include discoveries → RED → restore.*
3. `fr discover` without `--question` → rejected at write time.
4. Reuse: a later pull on arm **B** with `--cites obs-x` → `discoveries[obs-x].reuse == 1`; a `--cites` from a
   pull on the **same** source context does **not** count (cross-*thread* only).
5. `fr fork 41 --goal g --frontier f` with `reuse < k_fork` and no learning-progress → rejected (**GF**); after
   reuse reaches `k_fork` → scaffolds child `.frontier/` with copied config, seeded goal/frontier,
   `forked_from`, fresh empty log; parent log gets the supersession record.
6. `fr board` shows the discoveries block with `reuse×n` / `[fork-eligible]`; absent when no discoveries.
7. **Latency:** compiled-binary `board`/`check` cold-start < 50 ms with a discoveries ledger present.
8. *(If Decision C accepted)* a `progress` with no `frontier_after` and no later `--cites` reuse does **not**
   reset the breaker; one that reduces the frontier does.

## 12. Decisions (resolved)
- **A — `k_fork` (fork reuse threshold).** **Resolved 2026-06-22 — `reuse ≥ 2` OR demonstrated
  learning-progress (either suffices).** Rationale: 2 distinct threads reusing a result is POET's "transfer is
  load-bearing" signal (F9); requiring *both* would over-gate a genuinely cross-cutting
  one-reuse-plus-unstuck discovery. (Enforced by GF in D3.)
- **B — decay policy for un-reused, un-tested parked discoveries.** **Resolved 2026-06-22 — rigour-weighted
  decay that HIDES, never deletes.** A non-`T0` discovery with `reuse 0` older than `DECAY_AFTER_CYCLES = 8`
  → `status:decayed` (drops off the board tail), a `T0` one is sticky. Per the archive principle (F5) the log
  record always stays — decay only changes **surfacing**. (Built in D2: `derive.deriveDiscoveries`.)
- **C — fold in the `progress`-resets-breaker tightening (§4.6)?** **Resolved 2026-06-22 — DEFER, no change.**
  Progress-theatre is not (yet) a demonstrated failure mode, and editing a locked decision (canonical §15.1)
  speculatively isn't warranted; canonical §15.1 is **untouched**. The §4.6 rule is held as a ready drop-in.
  **Trigger to revisit:** D2's reuse + learning-progress signals instrument theatre directly — if a real
  campaign shows a persistent run of breaker-resetting `progress` pulls with zero reuse and no `frontier_after`
  reduction, flip the rule on then (grounded in F7). Instrument first, enforce only on evidence.

On acceptance, this PRD folds into the canonical PRD (§4 model, §5 data model, §6 CLI, §7 referee, §13
phasing, §15 locked decisions) and the model-side ritual in `CLAUDE.md` gains one line for `fr discover`.

## 13. Provenance (grounded in the lit review)
- **Capture-before-judging; near/distant analogy; openness-over-depth** — Dunbar & Blanchette (TICS 2001);
  "Serendipity in Science" (arXiv 2308.07519, preprint) — F1–F3.
- **Deceptive single objective; permanent-archive + k-NN novelty; transfer/promotion load-bearing** — Lehman &
  Stanley (EC 2011); Mouret & Clune (MAP-Elites); Wang et al. (POET) — F4, F5, F9.
- **Surprise as low-prior-but-occurred; learning-progress as the noisy-TV / progress-theatre fix** — Oudeyer &
  Kaplan; Pathak et al. (ICM 2017) — F6, F7.
- **"The Question" + method-vs-problem orientation + multiple working hypotheses** — Platt (Science 1964) — F8,
  F9.
- **Refuted / excluded:** CD-disruption index as a drop-in signal; "diversity beats direct optimization on the
  objective"; the IM typology as a turnkey formula menu (lit review, Refuted §).
- **Not yet grounded (honest gap):** Goodhart/Campbell/surrogation/McNamara on progress-theatre produced no
  verified claim in the first research pass; §4.6 rests on Platt's Question + learning-progress instead. A
  focused second pass (lit review open question 1) would firm this up before D3.
