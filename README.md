# Frontier

**The explore/exploit controller a language model structurally lacks.**

[![Bun](https://img.shields.io/badge/Bun-1.3-fbf0df?style=flat&logo=bun)](https://bun.sh)
[![License](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-136%20passing-success)](#)
[![Hook latency](https://img.shields.io/badge/hook-%3C50ms-success)](#)

```
   __                  _   _
  / _|_ __ ___  _ __ | |_(_) ___ _ __
 | |_| '__/ _ \| '_ \| __| |/ _ \ '__|
 |  _| | | (_) | | | | |_| |  __/ |
 |_| |_|  \___/|_| |_|\__|_|\___|_|

  Explore. Exploit. Don't tunnel-vision.
```

---

## The Dynamic

A transformer's default generation mode **is** exploitation: it greedily continues the current
line of reasoning. The active approach accumulates the most (and most recent) tokens, wins the
most attention mass, and pulls the next token toward more-of-the-same. The model has no intrinsic
memory of marginal returns and no exogenous boredom drive — so it rides one idea until it declares
victory or stalls. In a research swarm, the **orchestrator** is the one entity whose context grows
unbounded, so it's the one that tunnel-visions.

`fr` externalises the controller it's missing. Watch it work:

```
BOARD (injected into the orchestrator's context every turn):
  A primary       6 pulls  △▣△✗✗✗  best:T1  residual stalled ×2 (2 families)
  B exploratory   untried ??
  C support       3 pulls  △✗△      best:T2

The orchestrator wants to keep digging arm A:
  $ fr log A died "still stuck" --at "same wall" --decide EXPLOIT A

The Stop hook BLOCKS the turn — it cannot end:
  {"decision":"block","reason":"Arm A's residual has survived 2 frontier-non-moving
   pulls. Next cycle must EXPLORE a different arm or PIVOT."}

So it diversifies — and the turn closes:
  $ fr log A died "..." --at "same wall" --decide EXPLORE B      ✓
```

That block is the whole point: **a stop-loss the model cannot talk itself out of.**

---

## What is Frontier?

`fr` is a tiny command-line **explore/exploit controller** for an LLM running a swarm of
subagents against a hard, open problem (it was built for unproven conjectures in mathematical
physics, but the machinery is domain-agnostic). It gives the orchestrator three things it can't
hold on its own:

1. **A portfolio.** Approaches are *arms*; a turn is a *wave* of subagents; an outcome is a
   *return*. The orchestrator is a fund manager, not a researcher.
2. **A scoreboard, injected every turn.** A ~12-line FRONTIER + portfolio view lands in the
   recency slot via a Claude Code hook — the compaction-surviving big picture.
3. **A referee it cannot skip.** A `Stop` hook blocks the turn until this cycle is logged and
   the **circuit-breaker** is respected: an approach that stalls *must* yield to exploration.

**What makes it different:**

- **Externalises a real cognitive gap** — the missing marginal-returns memory and boredom drive,
  supplied as an append-only log + a derived board, not a prompt the model can ignore.
- **Non-skippable** — enforcement lives in a hook + exit codes, not in instructions.
- **Anti-self-grading** — "internal consistency ≠ correctness." A result is only *banked* when an
  **external oracle** (`fr verify`) passes; the model cannot rubber-stamp its own progress.
- **Append-only truth** — every view (staleness, dead routes, banked results) is *derived* from an
  immutable log, so a stale counter can't be quietly reset.
- **Self-teaching** — the full manual lives *in the binary*: `fr help` and progressive
  `fr help <topic>` drill-down, plus errors that coach the fix. Agents need no external docs.
- **Fast & self-contained** — one standalone binary, `<50 ms` on the hook path, zero runtime deps.

---

## Quick Start

```bash
# build + install `fr` onto PATH (Bun 1.3+ required to build; the binary itself has no deps)
git clone https://github.com/tobiasosborne/frontier.git
cd frontier && bun install && bun run install:global

# learn the protocol from the CLI itself
fr help

# start a campaign
fr init "prove <your conjecture>"
fr arm add A "literature + reductions" --priority primary --target "<the sub-goal>"
fr arm add B "numerics"                --priority exploratory
fr frontier "<the single live open question>"

# each turn (a "wave"): dispatch subagents, harvest, then log one pull per result
fr log A progress "lit confirms the reduction" --artifact lit/dossier.md --class lit --tier T2 \
       --worker sonnet:lit --decide EXPLOIT A

fr board        # see the FRONTIER + scoreboard + dead routes
fr status       # same, human-readable
```

Wire the three hooks (`hooks/settings.json` → your project's `.claude/settings.json`) and the
board injects itself every turn while the `Stop` hook enforces the protocol. See
[docs/deployment.md](docs/deployment.md).

---

## How It Works

```
                         +---------------------+
                         |     ORCHESTRATOR    |   <- the only one who runs `fr`
                         |  (holds the board)  |
                         +----------+----------+
                                    |  dispatches a WAVE
                +-------------------+-------------------+
                |                   |                   |
          +-----v-----+      +------v-----+      +------v-----+
          |  prover   |      |  refuter   |      |  lit/num   |   <- subagents: free of the tool,
          | (subagent)|      | (subagent) |      | (subagent) |      they return artifacts
          +-----+-----+      +------+-----+      +------+-----+
                |                   |                   |
                +-------------------+-------------------+
                                    |  orchestrator logs ONE pull per result
                          +---------v----------+
                          |   log.jsonl        |   append-only — the single source of truth
                          | (one record/pull)  |
                          +---------+----------+
                                    | derived (never stored)
              +---------------------+---------------------+
              |                     |                     |
        FRONTIER + board      circuit-breaker        dead-routes / banked
       (UserPromptSubmit)     (Stop hook)               ledgers
```

1. **Dispatch a wave** — subagents attack arms of the portfolio and hand back artifacts.
2. **Log the harvest** — one `fr log <arm> <outcome> … --decide …` per returned result.
3. **The board re-derives** — FRONTIER, per-arm staleness, dead routes, banked results.
4. **The Stop hook referees** — blocks the turn until you've logged and respected the breaker.
5. **The frontier reduces** — `conjecture → sub-lemma → one inequality`, banked piece by piece.

---

## Outcomes (rungs of a rigour ladder, not flat win/lose)

| Glyph | Outcome | Meaning | Requires |
|:---:|---|---|---|
| `▣` | **banked** | a result locked in | a passing independent `fr verify` |
| `△` | **progress** | a claimed result | a resolvable `--artifact` |
| `✗` | **died** | the *modal* outcome — died at a sharp named residual (not a failure!) | `--at "<residual>"` |
| `⊘` | **refuted** | a counterexample killed the target | the counterexample `--artifact` |
| `—` | **null** | genuinely nothing learned | — |

A **death that reduces the FRONTIER** is progress and resets the breaker. A death that merely
*renames* the residual does **not** — you can't paraphrase your way around the one rule. Decisions
are `EXPLOIT` (keep funding) · `EXPLORE` (fund a different arm) · `PIVOT` (same arm, new technique).

---

## A real board (from the dogfood campaign on the NPT bound entanglement conjecture)

```
OPEN: Is W_3(α*=-0.4) 2-undistillable? min over Schmidt-rank-2 ⟨ψ|(W_3^Γ)^⊗2|ψ⟩ ≥ 0 (n=1 settled)
BANKED: W_3(α*=-0.4) NPT (min PT eig -0.0256) AND 1-undistillable… [T1]
ARMS:
  A primary       4 pulls  △▣△⊘  best:T1  P~0.97  target ...n-undistillable for all n?
  B exploratory   1 pulls  —      best:??          target ...witness separating NPT-BE
  C support       4 pulls  △✗✗✗  best:T2  P~0.70  target ...Schur-Weyl reduction  residual stalled ×3 (2 families)
  D primary       2 pulls  ✗△     best:T2          target ...numerical lower bound
  E dead          untried ??
DEAD ROUTES (do not re-walk): Schmidt-rank-2 CONSTRAINT non-convex… (c7); α=-1 Werner is 1-DISTILLABLE… (c8)
```

A worked walkthrough is in [docs/tutorial.md](docs/tutorial.md).

---

## Documentation

| Document | What's in it |
|---|---|
| `fr help` | The CLI is self-documenting — start here, no docs required |
| [Concepts](docs/concepts.md) | Arms, frontier, the breaker, outcomes, the bank gate — the mental model |
| [Workflow](docs/workflow.md) | The orchestrator + swarm "wave" loop, and the Fable provenance |
| [CLI Reference](docs/cli-reference.md) | Every command, flag, and exit code |
| [Deployment](docs/deployment.md) | Install, hook wiring, oracles, fail-closed semantics |
| [Architecture](docs/architecture.md) | Pure-core-behind-edges, the data model, the design invariants |
| [Tutorial](docs/tutorial.md) | A full campaign, end to end |
| [PRD](docs/prd.md) | The full design rationale and locked decisions |
| [Contributing](CONTRIBUTING.md) | How to contribute (red-green TDD, the Laws) |

---

## Command reference

| Command | Description |
|---|---|
| `fr init "<goal>"` | Create `.frontier/`, set the goal |
| `fr arm add/set <id> …` | Register / re-aim an approach (priority, target, kill criterion) |
| `fr frontier "<open>"` | Record a FRONTIER reduction |
| `fr log <arm> <outcome> "<note>" … --decide <T> <arm>` | Append one cycle record (the per-turn call) |
| `fr orient "<why>"` | Record a no-wave turn (orientation / planning) — satisfies the Stop hook, not a pull |
| `fr verify <claim> --oracle <name>` | Run an oracle → verdict (the only way to earn `▣ banked`) |
| `fr board [--hook prompt]` | Render the scoreboard (hook form = UserPromptSubmit JSON) |
| `fr check [--hook stop]` | The referee (hook form = Stop JSON; fail-closed) |
| `fr turn-begin` | Stamp turn start (UserPromptSubmit) |
| `fr status` | Human-readable summary |
| `fr help [<command>\|<topic>]` | The progressively-discoverable manual |

---

## Project status

**Working (MVP):** the full command surface; the five-rung outcome ladder; the frontier-stall
breaker + `PIVOT`; the bank gate (`fr verify` + hash-bound, stale-on-change verdicts); dead-routes
and banked ledgers; supersession; the loop guard; fail-closed/fail-soft hooks; the in-CLI manual.
183 tests; `<50 ms` hook path; dogfood-validated on a real conjecture campaign.

**Roadmap:** rigour-weighted decaying optimism for untried arms (the one real bandit term);
`fr lessons` (cross-campaign recurring-dead-route mining); multi-arm allocation accounting; a
lab-book render (`.frontier/` → STATE.md/HANDOFF.md); cross-validating `--artifact` against a
project's claim ledger.

---

## Philosophy

> Prompts are requests, not guarantees. A model will not reliably self-enforce a discipline you
> put in its context — so don't put it there. Put it in a hook.

Frontier doesn't ask the model to explore. It makes *not* exploring impossible to get away with,
and makes *progress* mean something an external oracle agreed to. The model keeps its creativity;
it just loses the ability to fool itself about where it stands.

It is itself an artifact of the workflow it encodes: built by an orchestrator coordinating a swarm
of coding subagents under red-green TDD, then dogfooded on a live conjecture — which is how the
two bugs that survived the test suite got caught.

---

## Requirements

- **Build:** [Bun](https://bun.sh) 1.3+ (`bun run build` / `install.sh`).
- **Run:** nothing — the compiled binary embeds its runtime.
- **Hooks:** [Claude Code](https://claude.com/claude-code) (the `SessionStart`/`UserPromptSubmit`/`Stop` hooks).

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).

---

<p align="center"><i>Explore. Exploit. The model keeps the creativity; the hook keeps the discipline.</i></p>
