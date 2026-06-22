/**
 * help.ts — the progressively-discoverable, AGENT-FACING manual baked into the CLI.
 *
 * `fr help`                  → a short overview + the per-turn ritual + a topic index.
 * `fr help <command|topic>`  → drill-down detail for one command or concept.
 *
 * Design: keep the top level SHORT (token-cheap, the first thing an agent sees) and let it
 * pull detail on demand. Errors elsewhere teach the immediate fix and point here for depth.
 * PURE (strings only) — no fs/clock/env. Types: none needed.
 */

export const OVERVIEW = `fr — frontier: the explore/exploit controller for an ORCHESTRATOR LLM running a
swarm of subagents against a hard conjecture. ONLY the orchestrator runs fr; subagents never
touch it. State lives in .frontier/ (append-only log.jsonl = the single source of truth).

THE PER-TURN RITUAL (this is the whole protocol):
  A turn is a WAVE. Dispatch subagents, harvest their results, then BEFORE the turn ends log
  ONE record per arm-pull and end on a decision:
    fr log <arm> <outcome> "<one clause>" [flags] --decide <EXPLOIT|EXPLORE|PIVOT> <next-arm>
  The Stop hook blocks the turn until you do. Outcomes:
    ▣ banked (needs \`fr verify\`)  △ progress (needs --artifact)  ✗ died (needs --at)
    ⊘ refuted  — null

COMMANDS  (\`fr help <name>\`):  init  arm  frontier  log  discover  verify  board  check  turn-begin  status  help
CONCEPTS  (\`fr help <topic>\`): workflow  outcomes  breaker  bank-gate  evidence  arms  frontier  discovery  oracles  hooks

The board (injected each turn) is your live FRONTIER + portfolio scoreboard + dead routes.`;

const TOPICS: Record<string, string> = {
  init: `fr init "<goal>"
  Create .frontier/ and set the campaign goal (and the initial frontier).
  Next: \`fr arm add\` your approaches, then \`fr frontier "<the live open>"\`.`,

  arm: `fr arm add <id> "<desc>" [--priority P] [--target "<open>"] [--kill "<criterion>"]
fr arm set <id> [--priority P] [--target "<open>"] [--kill "<criterion>"]
  Register / re-aim an approach ("arm"). P ∈ primary | exploratory | support | background |
  logged | dead (graded funding — demote, don't delete). --target = the named open this arm
  attacks; --kill = the pre-registered condition to abandon it.  (\`fr help arms\`)`,

  frontier: `fr frontier "<the single live named open>"
  Record a FRONTIER reduction — the one open problem the campaign is currently on. As waves
  reduce it (conjecture → sub-lemma → one inequality), update it. A reduction also RESETS the
  breaker on the arm that achieved it (a productive death).  (\`fr help breaker\`)`,

  log: `fr log <arm> <banked|progress|died|refuted|null> "<note>" \\
       [--at "<residual>"] [--artifact <ref> --class <c> --tier T0|T1|T2] \\
       [--worker model:role]... [--p-true x] [--p-audit y] \\
       [--frontier "<reduced open>"] [--supersedes <cycle>] \\
       --decide <EXPLOIT|EXPLORE|PIVOT> <next-arm>
  Append ONE cycle record (one arm-pull) — the only required per-turn call. Validated at write:
  △/▣ need --artifact; ▣ needs a passing \`fr verify\`; ✗ needs --at; a stalled arm rejects
  EXPLOIT / EXPLORE-to-itself (use EXPLORE-different / PIVOT, or reduce the frontier).
  e.g.  fr log A progress "lit confirms reduction" --artifact lit/x.md --class lit --tier T2 --decide EXPLOIT A
        fr log C died "symmetry fails" --at "constraint non-convex" --worker opus:prover --decide PIVOT C
  (\`fr help outcomes\`, \`fr help evidence\`)`,

  discover: `fr discover "<observation>" --question "<falsifier / why it matters>" \\
       [--artifact <ref> --class <c> --tier T0|T1|T2] [--cites <ref>]...
  Park an OFF-GOAL discovery — an interesting/useful side result the current FRONTIER did not
  ask for. Off-arm and breaker-NEUTRAL: it neither resets nor trips the stall breaker, and it
  does NOT count as your turn's wave outcome (still log an arm-pull). --question is required
  (Platt's "The Question": what would falsify it / why it matters) and is the bar for promotion.
  A discovery is class=stated until externally checked. Later arm-pulls that --cites its artifact
  raise its cross-thread "reuse" on the board.  (\`fr help discovery\`)`,

  verify: `fr verify <claim> --oracle <name>
  Run a registered oracle (argv, NO shell; claim text on stdin) → a PASS/FAIL verdict, the
  ONLY way to earn ▣ banked. Register oracles under config.oracles in .frontier/portfolio.json.
  Verdicts are hash-bound and go STALE if the claim/oracle/inputs change (re-verify).
  (\`fr help bank-gate\`, \`fr help oracles\`)`,

  board: `fr board [--hook prompt]
  Render the FRONTIER + portfolio scoreboard + dead routes (factual state). With --hook prompt,
  emit the UserPromptSubmit JSON the hook injects each turn.`,

  check: `fr check [--hook stop]
  The referee. With --hook stop, emit Stop-hook JSON and exit 0. FAIL-CLOSED: a corrupt/
  unreadable .frontier/ BLOCKS; inert ({}) when no campaign exists. You rarely call it by
  hand — the Stop hook does.`,

  "turn-begin": `fr turn-begin
  Stamp the start of a turn so the Stop hook can tell whether you logged this turn. Wired into
  the UserPromptSubmit hook; rarely called by hand.`,

  status: `fr status
  Human-readable summary (the board, unwrapped). Use it to re-orient.`,

  help: `fr help [<command>|<topic>]
  This manual. \`fr help\` = overview + ritual; \`fr help <name>\` = drill in.
  Topics: workflow outcomes breaker bank-gate evidence arms frontier oracles hooks.`,

  workflow: `THE WORKFLOW (orchestrator + swarm)
  You are the orchestrator. Each turn is a WAVE: brief and dispatch subagents (provers,
  refuters, literature/numerics scouts), harvest what they return, and log one arm-pull per
  result. Subagents do the object-level work and hand back artifacts; YOU keep the big picture
  and are the only one who runs fr. The board (injected each turn) is your portfolio; the
  append-only log survives context compaction so you never lose the thread. Drive the FRONTIER
  down, bank what an oracle verifies, and let the breaker pull you off any approach that stalls.`,

  outcomes: `OUTCOMES (rungs of a rigour ladder, not flat win/lose)
  ▣ banked   a result LOCKED IN — needs a passing independent \`fr verify\` (the strong reward)
  △ progress a claimed result with a real --artifact (weak/decaying until verified)
  ✗ died     the MODAL outcome: an attempt died at a sharp, named residual (--at). NOT a
             failure — it narrows the frontier and feeds the dead-routes ledger.
  ⊘ refuted  a counterexample killed the target (auto-adds a dead route)
  — null     genuinely nothing learned (the breaker punishes runs of these)
  A death that REDUCES the frontier (--frontier) resets the breaker; one that just renames the
  --at residual does not.  (\`fr help breaker\`)`,

  breaker: `THE CIRCUIT-BREAKER (the one non-negotiable rule)
  An arm "stalls" after k=2 consecutive pulls that do NOT reduce the FRONTIER. A stalled arm
  cannot be EXPLOITed (nor EXPLORE-to-itself): the Stop hook BLOCKS until you EXPLORE a
  DIFFERENT arm or PIVOT (same problem, changed technology). Resets only on a moving outcome
  (banked/progress/refuted) or a real frontier reduction (--frontier) — NOT on paraphrasing the
  --at residual (that would let you dodge the breaker, so it is ignored). The board shows
  "residual stalled ×k (N families)": one wall surviving attacks by different model families is
  the strongest signal to switch.`,

  "bank-gate": `THE BANK GATE (anti self-grading)
  Internal consistency ≠ correctness. fr check certifies provenance/protocol, NOT math truth.
  △ progress only needs a resolvable --artifact. ▣ banked needs a PASSING, non-stale verdict
  from \`fr verify\` against an oracle OTHER than the author (reviewer ≠ author). A residual
  can't launder a failing oracle; a failing exit can't be upgraded by self-report; verdicts go
  stale when the claim/oracle/inputs change.  (\`fr help oracles\`)`,

  evidence: `EVIDENCE: --class + --tier
  --class (open vocabulary): lit (local ground truth) · num (numerics) · side (side-conjecture)
    · af (adversarial-proof rigour) · lean (machine-checked) · …
  --tier (rigour): T0 proof/theorem · T1 certified computation (exact / interval+error theorem)
    · T2 floats & literature numerics.
  The board shows each arm's BEST tier reached. A numeric △ is weak; a verified ▣ at T0 is strong.`,

  discovery: `DISCOVERY (off-goal results, parked)
  The breaker measures progress against the locked FRONTIER, so a genuine OFF-goal result reads
  as "no progress" and could even trip it — the anti-tunnel-vision rule is also anti-serendipity.
  \`fr discover\` gives off-goal results their own channel: a ⟡ record that is breaker-NEUTRAL,
  trusted WEAKER than a banked result (class=stated until checked), and parked in a discoveries
  ledger on the board. Capture is cheap; --question (Platt's The Question) is the recognition
  step. A discovery earns promotion by cross-thread "reuse" — a later pull on a DIFFERENT arm
  citing it (--cites). (Promotion to a new arm/goal is a later phase.)  (\`fr help breaker\`)`,

  arms: `ARMS (the portfolio)
  Each arm is one approach, with a priority (primary/exploratory/support/background/logged/dead
  — graded funding: demote rather than kill), a --target (the named open it attacks), and a
  --kill criterion. Untried arms render "??" and sort to prominence (a diversification nudge).
  \`fr arm add\` to register, \`fr arm set\` to re-weight / re-aim.`,

  oracles: `ORACLES (for the bank gate)
  Register under config.oracles in .frontier/portfolio.json:
    "oracles": [{ "name": "af", "cmd": ["python3", "/abs/path/check.py"], "inputs": ["/abs/in"] }]
  cmd runs as argv (NO shell); the claim text is fed on stdin; exit 0 → pass, non-zero → fail.
  Use ABSOLUTE paths (cwd isn't guaranteed under the hook). \`fr verify <claim> --oracle af\`
  records a hash-bound verdict that earns ▣ banked.  (\`fr help bank-gate\`)`,

  hooks: `HOOKS (orchestrator-only, file-gated, fail-closed)
  Three Claude Code hooks (hooks/settings.json → your project's .claude/settings.json):
    SessionStart / UserPromptSubmit → inject the board (your big picture, recency slot)
    Stop → run the referee; block the turn until this cycle is logged + the breaker respected
  INERT unless .frontier/portfolio.json exists, so subagent / other sessions cost nothing.
  Only the orchestrator session installs them.`,
};

/** Resolve a help request to text + exit code. No topic → the overview. */
export function help(topic?: string): { text: string; code: number } {
  if (!topic) return { text: OVERVIEW, code: 0 };
  const key = topic.replace(/^-+/, "").toLowerCase();
  const t = TOPICS[key];
  if (t) return { text: t, code: 0 };
  return { text: `no help topic '${topic}'.\nTry: fr help [ ${Object.keys(TOPICS).join(" ")} ]`, code: 0 };
}
