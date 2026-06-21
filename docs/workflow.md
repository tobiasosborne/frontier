# Workflow

## The orchestrator + swarm

Frontier assumes a specific shape of work: **one orchestrator coordinating a swarm of disposable
subagents.**

- **The orchestrator** holds the big picture and is the *only* entity that runs `fr`. It is also the
  only entity with the over-exploitation disease, because it's the only one whose context accumulates
  across a long campaign.
- **Subagents** (provers, refuters, literature/numerics scouts) are short-lived, fresh-context probes.
  They do the object-level work and hand back artifacts. They never touch `fr` — they *are* the
  exploration mechanism, and the controller is attached precisely to the entity that needs it.

This is why the hooks are **file-gated**: they're inert unless `.frontier/portfolio.json` exists, so a
subagent session (or any unrelated session) costs nothing.

## A turn is a wave

Each turn follows the same loop:

```
1. BRIEF + DISPATCH   spin up subagents across one or more arms of the portfolio
2. HARVEST            collect what they return (a dossier, a numeric result, a proof sketch, a counterexample)
3. LOG                fr log <arm> <outcome> "<note>" [evidence] --decide <EXPLOIT|EXPLORE|PIVOT> <next-arm>
                      — one record per arm-pull (a wave may log several)
4. REDUCE             if a result shrinks the open problem: fr frontier "<the reduced open>"
5. BANK               if a result is checkable: fr verify <claim> --oracle <name>, then log it as ▣ banked
```

Before the turn can end, the `Stop` hook runs the referee. It blocks unless you logged this turn and
respected the breaker. You don't call `fr check` yourself — the hook does.

## Choosing the next decision

Every `fr log` ends on a decision. Pick it from the board:

- **EXPLOIT `<same arm>`** — the arm is producing; keep funding it. (Disallowed if the arm is stalled.)
- **EXPLORE `<different arm>`** — fund a neglected or untried arm. The breaker *forces* this when the
  current arm stalls. Untried `??` arms are the natural targets.
- **PIVOT `<arm>`** — same problem, changed technique (e.g. "drop the exact-min approach, pursue an SOS
  certificate"). The escape hatch when an arm is right but its current attack is exhausted.

Signals on the board:

- An arm `stalled ×k (N families)` — especially with `N ≥ 2` — is telling you to switch.
- An arm whose `best:` tier keeps climbing (T2 → T1 → T0) is worth exploiting.
- A long run of `△`/`✗` with no frontier reduction is capital that isn't compounding.

## Resilience

The append-only log *is* your checkpoint. Because the board re-derives from `log.jsonl`, you re-orient
after any interruption (a context compaction, a crashed subagent, a multi-day gap) by reading the board —
not by trusting a lossy conversation summary. Keep waves bounded (one question per subagent, a short
runtime) so an interruption loses at most one pull. When the swarm is unreachable, the orchestrator can
still log local work (a hand numeric, a derivation) as pulls.

## Provenance: what this emulates

The workflow isn't invented — it's reverse-engineered from a discipline the model **Fable 5**
spontaneously ran as an orchestrator across multi-day conjecture campaigns: numbered "waves" of
parallel subagents against a single named open problem, progressively reduced
(`conjecture → (TREE) → (SB) → (EX) → one inequality`); `died-at` as the modal, productive outcome;
a `claimed → audited → banked` rigour ladder gated by a hostile audit from a *different* model family
(the "two-family bar"); an explicit dead-routes ledger; and a resilience protocol for outages.

Fable ran all of this as hand-maintained markdown discipline. Frontier captures it as a tool: the same
structure, but enforced and derived instead of trusted and hand-kept. The gate mechanics (fail-closed
file-gated hook, the pure-adjudicator / external-verifier split, hash-bound stale-on-change verdicts,
"internal convergence ≠ correctness") are adapted from [`bean`](https://github.com/grainulation/bean),
an independent capture of the same behaviour from the task-convergence angle.
