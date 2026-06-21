# Deployment

## Install `fr` once

```bash
bun install              # dev tooling to build (typescript, @types/bun); the binary has zero runtime deps
bun run install:global   # build + copy onto PATH
```

`install:global` runs `install.sh`, which builds a standalone binary (`dist/fr`, embeds the Bun runtime)
and installs it to:
- `/usr/local/bin` if writable (all users) — run with `sudo` to force this;
- otherwise `~/.local/bin` (this user).

Override with `FR_INSTALL_DIR=/path bun run install:global`. Confirm with `which fr` and `fr help`.

## Per-project setup (no binary copy needed)

From inside the target project:

```bash
fr init "prove <conjecture>"
fr arm add A "<approach>" --priority primary --target "<open>" --kill "<criterion>"
fr frontier "<the single live named open>"
```

The append-only `.frontier/log.jsonl` and `portfolio.json` **are** the campaign record — commit them. Only
`.frontier/bin/` (if you use the self-contained variant) and raw verdict logs are gitignored.

## Wire the hooks

Merge the three entries from [`hooks/settings.json`](../hooks/settings.json) into the project's
`.claude/settings.json` under `"hooks"`:

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "fr board --hook prompt" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "fr turn-begin && fr board --hook prompt" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "fr check --hook stop" }] }]
  }
}
```

- **SessionStart / UserPromptSubmit** inject the board into the recency slot; `UserPromptSubmit` also stamps
  the turn. Mind the 30 s `UserPromptSubmit` timeout — the hot path is `<50 ms`, well clear.
- **Stop** runs the referee: block-with-reason on a violation, self-limited by the loop guard.
- Hooks are snapshotted at session start — run `/hooks` to review after editing.

### PATH-independent fallback

If the hook shell can't see your PATH (so bare `fr` won't resolve), use
[`hooks/settings.selfcontained.json`](../hooks/settings.selfcontained.json) instead — it calls
`$CLAUDE_PROJECT_DIR/.frontier/bin/fr`. Then also drop the binary in place:

```bash
mkdir -p /path/to/target/.frontier/bin && cp dist/fr /path/to/target/.frontier/bin/fr
```

## Orchestrator-only

Install the hooks **only in the orchestrator's session**. Subagents run in their own sessions without these
hooks and never touch `fr`. Even if a stray session has them, they're inert unless
`.frontier/portfolio.json` exists.

## Fail-closed / fail-soft semantics

- `fr check --hook stop` is **fail-closed**: if `.frontier/` is active but unreadable (e.g. a corrupt
  `log.jsonl`), it **blocks** the turn rather than letting a broken referee wave work through.
- `fr turn-begin` and `fr board` are **fail-soft**: on the same corruption they warn to stderr and emit
  valid fallback JSON / stay silent — they never leak a stack trace to stdout (which would break the hook).

## Oracles (for the bank gate)

Register oracles under `config.oracles` in `.frontier/portfolio.json`:

```json
"config": {
  "stale_threshold": 2,
  "max_blocks_per_turn": 2,
  "oracles": [
    { "name": "af",      "cmd": ["af", "check", "--workspace", "/abs/proofs/lem-x"] },
    { "name": "ptcheck", "cmd": ["python3", "/abs/numerics/verify_npt.py"], "inputs": ["/abs/numerics/werner.json"] }
  ]
}
```

`cmd` runs as argv (no shell); the claim text is fed on stdin; exit 0 → pass. **Use absolute paths** — the
working directory isn't guaranteed under the hook. Good oracles read *persisted* state (a file, a build
result), not the model's in-session belief; that's what makes the bank gate worth anything.

## Live smoke test

After wiring, open a Claude Code session in the project and confirm:
1. the board appears at SessionStart and before each prompt (as factual state, not a flagged injection);
2. driving an arm to the stall threshold makes the Stop hook block with the breaker reason;
3. a subagent session never triggers the hook, and the loop guard keeps you clear of the 8-block kill.
