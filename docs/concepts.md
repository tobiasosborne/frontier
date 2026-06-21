# Concepts

The mental model in one line: **the orchestrator is a fund manager, not a researcher.** Arms are
positions, a pull is capital, evidence is returns, the circuit-breaker is a stop-loss. Everything
else follows from that.

## The portfolio: arms

An **arm** is one approach to the problem. You register arms up front and re-aim them as you learn:

```bash
fr arm add A "n-undistillability hierarchy" --priority primary \
   --target "is W_d 2-undistillable?" --kill "a Schmidt-rank-2 witness is found"
fr arm set A --priority support     # demote, don't delete
```

Each arm carries:

- **priority** — `primary | exploratory | support | background | logged | dead`. Funding is
  *graded*: you demote a fading arm to a "cheap background probe" rather than killing it outright.
- **target** — the named open question this arm is currently attacking.
- **kill** — a pre-registered condition under which the arm should be abandoned (so the decision is
  made *before* sunk cost clouds it).

Untried arms render `??` on the board and sort to prominence — a standing nudge toward
diversification, so the roads not taken keep some attention mass.

## The frontier

The **frontier** is the single live open question the *whole campaign* is currently on. Research
progress is the frontier *shrinking*: a big conjecture reduces to a sub-lemma, which reduces to one
inequality. You record each reduction:

```bash
fr frontier "Is W_3(α*=-0.4) 2-undistillable? min over Schmidt-rank-2 ⟨ψ|(W^Γ)^⊗2|ψ⟩ ≥ 0"
```

The board shows the current open plus the **reduction trail** (`conjecture → (TREE) → (SB) → (EX)`).
Reducing the frontier is the only thing that counts as *real* progress for the breaker (below).

## Outcomes: a rigour ladder

A pull's outcome is not a flat win/lose. It's a rung:

| Glyph | Outcome | Meaning |
|:---:|---|---|
| `▣` | banked | locked in — survived an external oracle |
| `△` | progress | a claimed result with a cited artifact (weak, decaying until verified) |
| `✗` | died | the **modal** outcome: died at a sharp, named residual |
| `⊘` | refuted | a counterexample killed the target |
| `—` | null | genuinely nothing learned |

**`died` is success, not failure.** In real research most attempts die — but a good death dies at a
*precisely stated wall* (`--at "the path-product floor Π_C ≳ τ − O(Lδ)"`), which narrows the problem
and becomes a permanent constraint in the dead-routes ledger. A campaign is a chain of productive
deaths punctuated by the occasional bank.

### Evidence: class + tier

Every `△`/`▣` cites evidence with a **class** (`lit · num · side · af · lean · …`, an open
vocabulary) and a **tier**:

- **T0** — proof / theorem.
- **T1** — certified computation (exact arithmetic, or interval arithmetic with a proven error bound).
- **T2** — floats, DMRG, literature numerics ("guidance"; never a proof ingredient).

The board shows each arm's *best tier reached*. A numeric `△` at T2 is a weak signal that decays; a
verified `▣` at T0 is sticky.

## The circuit-breaker (the one non-negotiable rule)

An arm **stalls** after `k = 2` consecutive pulls that do **not reduce the frontier**. A stalled arm
cannot be `EXPLOIT`ed (nor `EXPLORE`d-to-itself): the `Stop` hook blocks the turn until the next
decision is `EXPLORE` to a *different* arm or `PIVOT` (same problem, changed technique).

Two design choices matter:

- **It resets on frontier reduction, not on a renamed residual.** A productive death that records a
  `--frontier` reduction un-stalls the arm. A death that just paraphrases the `--at` text does not —
  otherwise the model could dodge the breaker by rewording. The breaker watches *progress*, not prose.
- **It counts independent attacks.** The board annotates `stalled ×k (N families)` — the same wall
  surviving attacks by *different model families* is the strongest signal that it's time to switch.

The breaker's job is to interrupt over-concentration. It does **not** judge the mathematics — a death
might mean "this approach is exhausted" or "this approach is right but the test is too strict," and
that judgement stays with you. The breaker just refuses to let you keep pouring capital into a
position that isn't moving.

## The bank gate (anti self-grading)

**Internal consistency ≠ correctness.** A self-consistent log can converge cleanly on a *wrong* reading
of the problem. So `fr check` certifies provenance and protocol — never mathematical truth. The only
thing that reaches toward truth is `fr verify`, which runs an **external oracle**:

```bash
# register an oracle in .frontier/portfolio.json → config.oracles, then:
fr verify numerics:werner-npt --oracle ptcheck   # runs your script; exit 0 → pass
fr log A banked "W_3 is NPT" --artifact numerics:werner-npt --class num --tier T1 --decide EXPLOIT A
```

A `▣ banked` is rejected — at write time *and* at the Stop hook — unless a **passing, non-stale**
verdict exists from an oracle *other than the author* (reviewer ≠ author). Verdicts are bound to a
hash of the claim, the oracle command, and its inputs; change any of them and the verdict goes
**stale**, re-blocking the bank until you re-verify. A residual can't launder a failing oracle, and a
non-zero exit can never be upgraded to a pass by self-reported output.

The honest limit: `fr` can't prove an oracle is *sound*. It makes a wrong claim *hard*, not impossible.

## Dead routes & supersession

Every `died` and `refuted` populates the **dead-routes ledger** — "do not re-walk," keyed on the
residual and tagged with the cycle that killed it. The board shows it so the swarm doesn't re-attack a
known wall.

Research isn't monotone, so the log is append-only with **supersession**, not overwrite. A later record
can retire an earlier one (`--supersedes <cycle>`) — to retract an over-claim, or to *reopen* a dead
route when new input arrives. The historical attempt still happened (it stays in the log and still
counts toward an arm's staleness); only the *live* banked/dead-route ledgers update.

## The board

The board is the orchestrator's externalised big picture, injected into context every turn:

```
OPEN: <the current frontier>  (trail: <reductions>)
BANKED: <locked results> [tier]
ARMS:
  A primary  6 pulls  △▣△✗✗✗  best:T1  P~0.85  target <…>  residual stalled ×2 (2 families)
  B exploratory  untried ??
DEAD ROUTES (do not re-walk): <residual> (c7); <residual> (c9)
```

It is **factual state, never an instruction** — deliberately. Imperative text ("you must switch now")
trips Claude Code's prompt-injection defence and gets surfaced to the user instead of used as context.
The board states what *is*; the `Stop` hook's block reason is the only place an imperative belongs.

For a long campaign the board is a net *token saving*: ~12 derived lines that survive context
compaction replace the paragraphs of "where was I again?" the orchestrator would otherwise regenerate.
