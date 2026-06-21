# CLI reference

The binary is self-documenting — `fr help` for the overview, `fr help <command|topic>` to drill in.
This page is the complete reference. State lives in `.frontier/`, resolved from `$CLAUDE_PROJECT_DIR`
if set, else by walking up from the current directory.

## `fr init "<goal>"`
Create `.frontier/` and set the campaign goal (also the initial frontier). Idempotent-ish: writes
`portfolio.json` with default config (`stale_threshold: 2`, `max_blocks_per_turn: 2`).

## `fr arm add <id> "<desc>" [flags]` · `fr arm set <id> [flags]`
Register or re-aim an arm. Flags:
- `--priority <P>` — `primary | exploratory | support | background | logged | dead`.
- `--target "<open>"` — the named open this arm attacks.
- `--kill "<criterion>"` — the pre-registered abandonment condition.

`arm set` updates only the flags you pass.

## `fr frontier "<the single live named open>"`
Record a FRONTIER reduction — re-bases the campaign's current open. The board shows the reduction trail.

## `fr log <arm> <outcome> "<note>" [flags] --decide <TYPE> <next-arm>`
Append one cycle record (one arm-pull). The only required per-turn call.

- `<outcome>` — `banked | progress | died | refuted | null`.
- `--at "<residual>"` — the death certificate. **Required** for `died`.
- `--artifact <ref>` — a resolvable reference (path / id / arXiv / lemma). **Required** for `progress`/`banked`.
- `--class <c>` — evidence class (`lit | num | side | af | lean | …`, open vocabulary).
- `--tier <T0|T1|T2>` — rigour tier.
- `--worker <model:role>` — repeatable; e.g. `--worker opus:prover --worker codex:refuter`.
- `--p-true <x>` / `--p-audit <y>` — advisory credences (sort/salience only; never promote a result).
- `--frontier "<reduced open>"` — record a frontier reduction on this pull (resets the breaker; the
  derived open reflects it).
- `--supersedes <cycle>` — retire an earlier record by its cycle index (retraction / reopening a dead route).
- `--decide <EXPLOIT|EXPLORE|PIVOT> <next-arm>` — **required**; the turn ends on a decision.

**Write-time validation** (immediate rejection, exit 1): `died` without `--at`; `progress`/`banked` without
`--artifact`; `banked` without a passing verdict; a `refuted` carrying a banked verdict (laundering); an
unknown arm; a stalled arm with an `EXPLOIT` / `EXPLORE`-to-itself decision (use `EXPLORE`-different /
`PIVOT`, or reduce the frontier with `--frontier`).

## `fr verify <claim> --oracle <name>`
Run a registered oracle (argv, **no shell**; claim text on stdin) and record a verdict. Exit 0 → pass,
non-zero → fail. The only way to earn `▣ banked`. Oracles live in `.frontier/portfolio.json`:
```json
"config": { "oracles": [{ "name": "af", "cmd": ["python3", "/abs/check.py"], "inputs": ["/abs/in"] }] }
```
Verdicts are scrubbed (hashes + pass/fail) and bound to `claim_hash + oracle_digest + inputs_hash`; they go
**stale** when any of those change.

## `fr board [--hook prompt]`
Render the FRONTIER + portfolio scoreboard + dead routes (factual state). With `--hook prompt`, emit the
`UserPromptSubmit` JSON the hook injects (stdout is JSON-only).

## `fr check [--hook stop]`
The referee. With `--hook stop`, emit the Stop-hook JSON and exit 0. **Fail-closed:** a corrupt/unreadable
`.frontier/` → a `block`; inert `{}` when no campaign exists. You rarely call this by hand.

The gates, in order: **G1** logged-this-turn · **G5** `died` needs `--at` · **G2** `progress`/`banked` needs
an artifact · anti-laundering · **G2b** `banked` needs a verdict · **G3** the breaker · **G4** ends-on-a-decision.
The **loop guard**: after `max_blocks_per_turn` blocks in one turn, further checks emit a soft
`additionalContext` reminder instead of a hard block (keeping clear of Claude Code's 8-block session kill).

## `fr turn-begin`
Stamp the start of a turn (records the log length so `check` can tell whether you logged). Wired into the
`UserPromptSubmit` hook. **Fail-soft** — never crashes the hook chain.

## `fr status`
Human-readable summary (the board, unwrapped).

## `fr help [<command>|<topic>]`
The progressively-discoverable manual. Topics: `workflow outcomes breaker bank-gate evidence arms oracles
hooks` (plus every command name).

## Exit codes
`0` ok · `1` a write-time rejection (`fr log`) or a non-hook block · `2` unknown command. Hook subcommands
(`board --hook`, `check --hook`) always exit `0` and signal via the emitted JSON.
