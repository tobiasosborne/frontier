# The fr ⇄ vibefeld seam — an exploratory design sketch

> **Status: EXPLORATION → increments 1–2 BUILT.** This began as a pre-canonical thinking artifact
> (`docs/research/`, parallel to `discovery-ledger-lit-review.md`); the canonical design remains
> `docs/prd.md`. **Forward increment 1 (§2.1, §5, §9) is implemented and green:** `fr graduate <cycle>
> --to <ref>`, the off-arm breaker-neutral `graduate ↟` outcome, the derived `graduations` view +
> `tier→initialTaint` conservation, and the `GRADUATED → vibefeld` board line. **Backward increment 1
> (§2.2/§3/§6 — the READ-ONLY parser) is now also built and green** (IMPL_PLAN §11): `fr ingest
> <af-dir>` runs `af` as a structured oracle, maps its derived state → `ResidualToken`s (a `refuted`
> node → `refutation`; an open critical/major challenge → `gap`; an admitted/tainted leaf → `taint`
> capped at T2 — the never-upgrade `taint→cap` conservation), and REPORTS them; it writes no records
> yet. **Still exploratory / unbuilt:** the ingest WRITE path (append the tokens as arms/discoveries/
> refuted records, hash-bound for idempotent re-ingest — the `currentVerdicts` twin), the `crack →
> supersedes` credit-assignment loop (§2.2/§4), and the statability-tightening of the log gate (§9).

## 0. The one-line architecture

`fr` and `vibefeld` are the two halves of one pipeline: `fr` is the **discovery/search controller**
over an *open* conjecture (which decomposition to even attempt, under unknown structure);
`vibefeld` is the **contract-carrying adversarial DAG** that *discharges* a chosen argument. They
are already the same event-sourced architecture (append-only log as sole truth, everything derived).
The missing piece is not contracts-on-arms — it is the **typed door between them**, and the cleanest
way to model that door is:

> **`vibefeld` is, to `fr`, an oracle of a richer return type.**
> `fr verify` runs an oracle that returns a *scalar* verdict (`pass | fail | error`).
> `fr ingest` runs `vibefeld` as an oracle that returns a *structured* verdict — a set of
> **graduation/residual tokens** — scrubbed and hash-bound exactly like a `Verdict`.

That framing keeps the entire seam inside `fr`'s existing spine (oracle edge + hash-bound verdicts +
pure `derive`), inventing no new subsystem and breaking no Law.

## 1. The picture

```
        fr  (search / portfolio / bandit)                 vibefeld (af)  (proof DAG / discharge)
        ─────────────────────────────────                 ────────────────────────────────────
        goal · frontier(string) · arms                    root obligation · nodes · challenges
        outcomes: banked/progress/died/refuted            states: validated/admitted/refuted/...
        bank gate (terminal oracle)                       per-node adversarial verifier · taint
                    │                                                    ▲
                    │   ── fr graduate <cycle> --to <af> ──────────────▶ │   FORWARD: an OBLIGATION
                    │        carries: statement + provenance              │   tier ↦ initial taint
                    │        (a banked result or a statable died-at)      │
                    │                                                     │
                    │ ◀──────────────── fr ingest <af> ───────────────── │   BACKWARD: a RESIDUAL
                    ▼        carries: gap / tainted-leaf / refutation     ▼   taint ↦ capped tier
        new arm · discovery · refuted dead-route · supersession
                    │
                    └──▶ credit assignment: a CRACKED graduation supersedes the arm that banked it
```

The conserved quantity on every arrow is **trust** (`fr` tier/class ⇄ `vibefeld` taint). The seam
is a *monotone, never-upgrading* map — the same "signal may only downgrade" invariant `fr` already
enforces internally, now closed across two ledgers.

## 2. What crosses, and its type

### 2.1 Forward (`fr` → `vibefeld`): a **GraduationToken** — an *obligation*

Emitted when an arm produces a survivor worth proving rigorously: a `banked` result, **or** a
`died-at` residual that has become *statable as a claim* (the litmus, applied as a **graduation
gate**, not a per-arm admission gate). Shape:

```
GraduationToken {
  statement   : string            // the proposition vibefeld must discharge
  provenance  : { repo, cycle, arm, class, tier, artifact, verdictHash? }
  // ↓ the conservation rule, computed AT THE EDGE (graduate), never in the pure core:
  initialTaint: derived from tier  // T0+banked(lean) → clean leaf
                                   // T1 (certified computation) → validated-but-computational (low taint)
                                   // T2 / stated / progress → admitted (introduces taint)
}
```

In `vibefeld` terms this seeds `af init --conjecture "<statement>"` (or a sub-root), with the node's
starting epistemic state set by `initialTaint`. **A weak `fr` result cannot enter `vibefeld` as a
clean leaf** — that is the forward half of trust conservation.

### 2.2 Backward (`vibefeld` → `fr`): a **ResidualToken** — a *reopened obligation*

`vibefeld` surfaces three kinds of thing `fr` should act on. Each is **type-identical to an `fr`
`died-at` residual** (an obligation *newly sharpened*, not discharged):

| vibefeld event | ResidualToken kind | lands in `fr` as |
|---|---|---|
| critical/major `gap` or `completeness` challenge | `gap` | a **new arm** (`--target "<gap>"`) *or* a **discovery** (`--question "<gap>"`) |
| a `tainted`/`admitted` leaf that never cleans | `taint` | a **discovery** (off-goal lemma other arms may `--cites`) |
| a `refuted` node | `refutation` | a **`refuted` dead-route** (prunes `fr`'s space — this *is* progress) |
| a **graduated survivor cracks** (critical gap in a node `fr` had `banked`) | `crack` | a **supersession** of the banking record (see §4) |

```
ResidualToken {
  statement : string                  // the gap / missing lemma / dead approach
  kind      : "gap" | "taint" | "refutation" | "crack"
  provenance: { afDir, nodeId, challengeId?, contentHash }
  // ↓ conservation: taint ↦ the CEILING tier fr may grant anything citing this, set AT THE EDGE (ingest)
  cap       : tier ceiling           // tainted vibefeld lemma → caps at progress/T2, can't support banked/T0
}
```

Trust conservation backward: a critical `gap` returns as an **open** residual (frontier-non-reducing;
banks nothing — it cannot launder a passing `fr` verdict). A `refutation` returns as `refuted` (a dead
route, which *sharpens* the frontier by elimination — `fr`'s modal good outcome, preserved).

## 3. The conserved currency: `tier` ⇄ `taint`

This is the load-bearing elegance. `fr`'s `Tier`/`Verdictish` and `vibefeld`'s `taint` are two
encodings of *one* quantity — **how much unearned trust is in this result** — and the seam is the
order-preserving, never-increasing map between them:

```
   fr (banked, T0/lean)  ──▶  vibefeld clean leaf            vibefeld validated→Lean export ──▶ fr T0/banked
   fr (banked, T1)       ──▶  vibefeld validated/low-taint   vibefeld validated (LLM-only)  ──▶ fr audited (NOT banked)
   fr (progress/T2/stated)──▶ vibefeld admitted (taint)      vibefeld tainted/admitted leaf ──▶ fr caps at progress/T2
```

Two anti-gaming guards, both already native to `fr`:

1. **A `vibefeld` `validated/clean` maps to `fr` `audited`, never `banked`** — because `vibefeld`'s
   verifier is an *adversarial LLM* ("procedural rigor, not semantic soundness"), the same bounded
   trust as `fr`'s own non-Lean oracles. **Only a `vibefeld` proof that exports to a machine-checked
   Lean term earns `fr` `T0`/`banked`.** This keeps "only an external oracle reaches toward truth"
   intact across the seam.
2. **Conservation is enforced AT THE EDGE** (`graduate` maps tier→taint; `ingest` maps taint→tier),
   so the **pure core never sees live `vibefeld` state** — it only ever sees a normal `fr` tier on a
   normal record. This is the exact pattern `oracle.ts` already uses for verdict staleness
   (`currentVerdicts` resolves staleness at the edge; the pure core's invariant is "a verdict's
   presence === it is current"). The seam's invariant is the twin: "a record's tier === the trust
   already conserved across any crossing."

## 4. The genuinely new capability: credit assignment (the feedback edge)

Today `fr`'s reward is terminal (bank gate) + frontier-reduction; once a survivor graduates, `fr`
loses sight of it. The seam closes the loop and gives `fr` the *grounded intermediate signal* the
"contract" argument was groping toward — but located correctly (on the seam, via **supersession**)
instead of incorrectly (as a per-node bonus inside `fr`, which would Goodhart the search).

- **Negative (the important one).** `vibefeld` finds a **critical gap in a graduated survivor** → the
  banking `fr` result was not sound. `ingest` writes an `fr` record with
  `supersedes: <banking-cycle>`, outcome `refuted`/`died`. `fr`'s existing supersession path
  (`derive.isLive` → `banked` + `deadRoutes`) recomputes: the arm's `bestTier` drops, the banked
  ledger loses that entry, the frontier may **re-open**. This is *retroactive credit assignment from
  a downstream discharge to an upstream bet* — `fr`'s `supersedes` field already exists for exactly
  "banked-then-retracted."
- **Positive.** `vibefeld` validates a graduated survivor to a Lean-export proof → `ingest` writes a
  superseding record promoting the result's recorded tier (e.g. `T1`→`T0`). LLM-only validation
  promotes only to `audited` (guard §3.1).

Note this is the *only* place an intermediate reward can soundly live for `fr`: terminal-plus-
downstream-feedback, never per-node. It is also potential-shaped — it moves the recorded residual,
which is what `fr`'s breaker already keys on.

## 5. What the PURE core needs (minimal, additive — L2/L4 intact)

No new stored state; everything stays derived. The additions parallel the discovery feature's
`question`/`cites`/`fork_of`/`from_discovery` precisely.

**`types.ts` (additive fields + one derived view):**

```ts
// on LogRecord — inert provenance markers, folded over the log exactly like fork_of:
graduated_to?: string;     // the vibefeld ref this result was graduated INTO (forward marker)
from_vibefeld?: string;    // the vibefeld node/challenge ref this record was seeded BY (backward)

// on ArmConfig — parallels from_discovery:
from_vibefeld?: string;    // the vibefeld gap that promoted this arm

// new derived view in DerivedState:
graduations: Graduation[];

interface Graduation {
  cycle: number; arm: string | null; statement: string;
  vibefeldRef: string;
  status: "open" | "validated" | "cracked" | "tainted";  // derived from markers + supersessions
  tier: Tier | null;
}
```

**`derive.ts`:** compute `graduations` as a pure fold over records carrying `graduated_to` /
`from_vibefeld`, joined with supersessions that reference them (same machinery as `banked` /
`deadRoutes` / `discoveries`). A `graduated_to` marker is **inert** (like `fork_of`: not itself a
ledger entry, skipped in the per-arm pulls/strip/stale walk). **No change to the breaker or the bank
gate.** A backward residual is just a new open `target` (or a fresh arm); a crack flows through the
existing supersession path.

**`board.ts`:** one new line, e.g. `GRADUATED: ×N (▣2 validated · ⚠1 cracked · ⟳1 open)`, so the
seam stays *visible* — same principle as `NO-WAVE TURNS: ×N` and the PARKED-discoveries line.

## 6. What the EDGE needs (impure — the only place the outside world is touched)

A thin edge, modeled on `oracle.ts` / `fr verify` (run argv, scrub to hash-bound tokens):

- **`fr graduate <cycle> --to <af-dir>`** — forward. Reads the `fr` result, maps `tier → initialTaint`,
  seeds the `vibefeld` root (`af init …`), writes the `graduated_to` marker to `fr`'s log.
- **`fr ingest <af-dir>`** — backward. Runs `af` as argv, reads its *derived* state, scrubs gaps /
  taints / refutations / cracks newer than the last ingest into hash-bound ResidualTokens, maps
  `taint → cap`, and appends them as arms / discoveries / `refuted` records / supersessions.

`fr ingest` **is** a structured oracle. Generalize `OracleConfig` minimally so an oracle may declare a
`kind: "scalar" | "structured"`; `runOracle` keeps returning a `Verdict` for the bank gate, and a
sibling `runStructuredOracle` returns a `ResidualToken[]` scrubbed and hash-bound to
`(afLedgerHash, nodeId, contentHash)` so re-ingest is idempotent and **stale tokens are dropped at
the edge** — verbatim the `currentVerdicts` discipline. The pure core never imports `af`.

## 7. The alternative: one shared ledger (tighter coupling)

Instead of two ledgers exchanging hash-bound refs, `fr` and `vibefeld` could write **one** append-only
event log with a discriminated record `kind`, each tool's `derive` ignoring the other's kinds. Cleaner
conceptually (trust conservation becomes a single intra-log invariant; no scrub/hash-binding across a
boundary) but it **couples deployment and release cadence** of two tools that are currently
independent binaries in different languages (Bun/TS vs Go). Recommendation for a sketch: prefer the
**two-ledgers-as-oracle** version (§0–6) — it respects both tools' independence, reuses `fr`'s oracle
edge wholesale, and degrades gracefully (no `af` present → `fr` is unaffected, exactly as today). Keep
the shared-ledger variant on the table only if the two tools later merge.

## 8. Honest failure modes (what this sketch does NOT solve)

- **Over-graduation.** The forward gate must be the *statability* litmus (only `banked` or a
  statable `died-at` graduates); a fuzzy residual stays an `fr` target. Without that guard, `graduate`
  floods `vibefeld` with vibes — the exact thing the litmus exists to stop.
- **Laundering across the seam.** Already guarded (§3.1: LLM-only `validated` → `audited`, not
  `banked`; only Lean-export earns `T0`). If that guard is relaxed, the seam becomes a trust-upgrade
  hole — the single thing the whole anti-gaming spine exists to prevent.
- **Taint-snapshot staleness.** An `fr` record's tier is a *snapshot* of `vibefeld` taint at ingest;
  if the proof later changes, the snapshot is stale. Resolved by **re-ingest** (the tokens are
  hash-bound to the `af` ledger state), exactly like verdict staleness — the pure core never chases
  live `vibefeld` state.
- **What it still cannot do:** detect that a *fully-green `vibefeld` subgraph attacks the wrong
  problem* (the global-doom failure no per-node verifier catches). That remains `fr`'s job, via the
  *global* frontier signal — which is precisely why reward must stay on the frontier, never on
  node-closure. The seam carries trust; it does not carry strategic judgment.

## 9. The smallest honest first step — increment 1 (BUILT)

> **Implemented.** `fr graduate` + the `graduate ↟` marker + derived `graduations` + the board line
> shipped as increment 1 (forward provenance marker only). The statability-tightening of the log
> gate below is the deliberate NEXT increment, not bundled in.

Not the whole seam. Just the **forward provenance marker** + the **statability graduation gate**:
generalize `died-at`'s death-certificate discipline so every non-null pull names a *falsifiable*
post-state, and let `fr graduate` emit a `GraduationToken` for the survivors. That is a pure tightening
of what `fr` already has, requires no `vibefeld` changes, and makes the seam's forward half real before
committing to the backward `ingest` machinery. The credit-assignment loop (§4) is the high-value
follow-on, but it depends on `ingest` and should not be attempted first.
