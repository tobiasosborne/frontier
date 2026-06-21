# Tutorial: a campaign end to end

This walks the whole loop on a real example — the **NPT bound entanglement conjecture** (do NPT
undistillable states exist? the candidate is NPT Werner states) — the campaign Frontier was first
dogfooded on. You don't need the physics; watch the *tool*.

Assumes `fr` is installed (`bun run install:global`). Run these from a fresh project directory.

## 1. Set up the portfolio

```bash
fr init "Decide the NPT bound entanglement conjecture: do NPT undistillable states exist?"

fr arm add A "n-undistillability hierarchy (DSSTT Schmidt-rank-2 criterion)" \
   --priority primary --target "is the candidate NPT Werner state n-undistillable for all n?"
fr arm add B "entanglement witnesses" --priority exploratory
fr arm add C "Schur-Weyl symmetry reduction of the 2-copy test" --priority support
fr arm add D "see-saw / SDP numerics" --priority exploratory

fr frontier "Is the candidate Werner state 2-undistillable? min over Schmidt-rank-2 ⟨ψ|(W^Γ)^⊗2|ψ⟩ ≥ 0?"
fr board
```

The board shows four arms, all `untried ??`, under the goal and the live open.

## 2. A wave lands → log progress

You dispatch a literature subagent; it returns a dossier confirming the reduction. Log one pull:

```bash
fr turn-begin   # (the UserPromptSubmit hook does this for you in a live session)
fr log A progress "DSSTT criterion + Werner reduction confirmed" \
   --artifact literature/dsstt.md --class lit --tier T2 --worker sonnet:lit --p-true 0.9 \
   --decide EXPLOIT A
```

`△ progress` needs `--artifact`; the dossier is it. The decision keeps funding A.

## 3. The bank gate

A numerics subagent computes that the candidate state is NPT (a checkable fact) and writes a verifier
script. First register it as an oracle (in `.frontier/portfolio.json` → `config.oracles`), then:

```bash
# this is REJECTED — no verdict yet:
fr log A banked "candidate is NPT" --artifact numerics:npt --class num --tier T1 --decide EXPLOIT A
#   ▣ banked needs a passing audit verdict … Run `fr verify` …

fr verify numerics:npt --oracle ptcheck          # runs your script; exit 0 → pass
fr log A banked "candidate is NPT (min PT eig -0.0256) and 1-undistillable" \
   --artifact numerics:npt --class num --tier T1 --worker codex:numerics --decide EXPLOIT A   # ✓
```

You can only *bank* what an external oracle agreed to. The board's `BANKED:` line now carries the result.

## 4. Reduce the frontier (and reset the breaker)

The n=1 case is settled, so the open shrinks. Record it on the pull:

```bash
fr log A progress "1-undistillability proven analytically" --artifact numerics/results.md \
   --class num --tier T1 \
   --frontier "Is the candidate 2-undistillable? (n=1 now settled)" \
   --decide EXPLOIT A
fr board    # OPEN shows the reduced question + the trail
```

## 5. An arm stalls → the breaker fires → PIVOT

You push arm C (the symmetry reduction). It dies at a wall — twice, on the same residual, with no
frontier reduction:

```bash
fr turn-begin
fr log C died "symmetry reduces the cost but not the constraint" \
   --at "Schmidt-rank-2 constraint is non-convex → only an SDP relaxation, not the exact min" \
   --worker opus:prover --decide EXPLOIT C        # stale → 1

fr turn-begin
fr log C died "second attack, same wall" \
   --at "Schmidt-rank-2 constraint is non-convex → only an SDP relaxation, not the exact min" \
   --worker codex:prover --decide EXPLOIT C        # stale → 2

fr check --hook stop
# {"decision":"block","reason":"Arm C's residual has survived 2 frontier-non-moving pulls.
#  Next cycle must EXPLORE a different arm or PIVOT."}
```

The turn won't end. You obey the breaker — PIVOT (same arm, new technique):

```bash
fr log C died "PIVOT: drop exact-min, pursue an SOS lower-bound certificate" \
   --at "...same wall..." --worker opus:prover --decide PIVOT C
fr check --hook stop      # {}  — the turn can close
```

(Note the board now reads `C ... residual stalled ×3 (2 families)` — two distinct model families hit
the same wall, the strongest signal that it's genuinely hard.)

## 6. Refute an over-claim → a dead route

The numerics also showed a *different* Werner state is NPT but **distillable** — refuting it as a
candidate:

```bash
fr log A refuted "α=-1 Werner is NPT but 1-DISTILLABLE — not a bound-entanglement candidate" \
   --artifact numerics/results.md --class num --tier T1 --decide EXPLORE B
```

`⊘ refuted` auto-adds a dead route so the swarm won't re-walk it.

## 7. Read the board

```bash
fr board
```
```
OPEN: Is the candidate 2-undistillable? (n=1 now settled)  (trail: … → …)
BANKED: candidate is NPT (min PT eig -0.0256) and 1-undistillable… [T1]
ARMS:
  A primary       4 pulls  △▣△⊘  best:T1  P~0.90  target …n-undistillable for all n?
  B exploratory   1 pulls  —      best:??
  C support       4 pulls  △✗✗✗  best:T2  target …Schur-Weyl reduction  residual stalled ×3 (2 families)
  D exploratory   untried ??
DEAD ROUTES (do not re-walk): Schmidt-rank-2 constraint non-convex… (c5); α=-1 Werner is 1-DISTILLABLE… (c8)
```

That single view — survived compaction, derived from the immutable log — is the whole campaign at a
glance: where the frontier sits, what's banked, which arm is stalling and how hard, and which walls are
already dead. In a live session it's injected into the orchestrator's context every turn, and the `Stop`
hook keeps the discipline whether the model feels like it or not.

## Where to go next

- [Concepts](concepts.md) — the *why* behind each piece.
- [CLI Reference](cli-reference.md) — every flag.
- [Deployment](deployment.md) — wiring the hooks and oracles into a real project.
- `fr help <topic>` — the same, from the binary.
