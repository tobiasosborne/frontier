/**
 * board.ts — the PURE board renderer + hook JSON wrappers (Pillar C).
 *
 * `renderBoard(state)` turns a DerivedState into the factual FRONTIER + portfolio
 * scoreboard the orchestrator reads each turn (PRD §8). The wrappers shape hook stdout.
 *
 * PURE / deterministic (L4 / Rule 5): NO fs, clock, env, or network. A function of its
 * inputs only — same DerivedState → same text → same compiled-binary behaviour.
 *
 * FACTUAL PHRASING ONLY (PRD §8): imperative text trips Claude Code's prompt-injection
 * defence and gets surfaced to the user instead of used as context. The board states
 * what IS (counts, residuals, glyph strips); it never tells the model what to do. A test
 * asserts no imperative tokens appear. Untried arms render `??`.
 *
 * Contract: docs/IMPL_PLAN.md §2 (`board.ts`). Types: src/types.ts (imported, never redefined).
 */

import type {
  DerivedState,
  DerivedArm,
  DeadRoute,
  BankedResult,
  Discovery,
  PromptHookOutput,
  StopHookOutput,
} from "./types";

const DEFAULT_MAX_DEAD = 6;
const DEFAULT_MAX_DISC = 6;
/** Hard note truncation so a single arm line can't blow the token budget. */
const NOTE_CAP = 60;

export interface BoardOpts {
  maxArms?: number;
  maxDead?: number;
  maxDisc?: number;
}

export function renderBoard(state: DerivedState, opts: BoardOpts = {}): string {
  const maxArms = opts.maxArms ?? state.arms.length;
  const maxDead = opts.maxDead ?? DEFAULT_MAX_DEAD;
  const maxDisc = opts.maxDisc ?? DEFAULT_MAX_DISC;

  const lines: string[] = [];

  // ── FRONTIER + OPEN + trail ──────────────────────────────────────────────
  lines.push(`FRONTIER — goal: ${state.goal}`);
  // The trail is meaningful only once a reduction has happened (length > 1).
  const trailClause =
    state.frontierTrail.length > 1 ? `  (trail: ${state.frontierTrail.join(" → ")})` : "";
  lines.push(`OPEN: ${state.frontier}${trailClause}`);

  // ── BANKED ───────────────────────────────────────────────────────────────
  if (state.banked.length > 0) {
    lines.push(`BANKED: ${state.banked.map(bankedClause).join("; ")}`);
  }

  // ── ARMS (one line each) ─────────────────────────────────────────────────
  lines.push("ARMS:");
  for (const a of state.arms.slice(0, maxArms)) {
    lines.push(`  ${armLine(a)}`);
  }

  // ── DEAD ROUTES tail ─────────────────────────────────────────────────────
  if (state.deadRoutes.length > 0) {
    const shown = state.deadRoutes.slice(0, maxDead).map(deadClause).join("; ");
    lines.push(`DEAD ROUTES (do not re-walk): ${shown}`);
  }

  // ── DISCOVERIES tail (off-goal — prd-discovery §8) ───────────────────────
  // Only PARKED discoveries surface; promoted/forked/decayed are tracked in the
  // ledger but drop off the board (decay changes surfacing, not the record — Decision B).
  const parked = state.discoveries.filter((d) => d.status === "parked");
  if (parked.length > 0) {
    const shown = parked.slice(0, maxDisc).map(discoveryClause).join("; ");
    lines.push(`DISCOVERIES (off-goal, parked): ${shown}`);
  }

  return lines.join("\n");
}

// ── per-element rendering (all FACTUAL — state, never instruction) ───────────

function armLine(a: DerivedArm): string {
  // Untried arms render `??` and sort to prominence (diversification mandate, PRD §4.6).
  if (a.status === "untried" || a.pulls === 0) {
    const target = a.target ? `  target ${a.target}` : "";
    return `${a.id} ${a.priority}  untried ??${target}`;
  }

  const parts: string[] = [`${a.id} ${a.priority}`, `${a.pulls} pulls`];

  // glyph strip (empty → ?? as a visible placeholder rather than blank)
  parts.push(a.strip === "" ? "??" : a.strip);

  // best evidence rung reached — `??` when no progress/banked pull has landed.
  parts.push(`best:${a.bestTier ?? "??"}`);

  // aggregated P(true) — advisory salience only (PRD §15.2), shown when present.
  if (a.aggP != null) parts.push(`P~${a.aggP.toFixed(2)}`);

  if (a.target) parts.push(`target ${a.target}`);

  // residual-survival is FACTUAL state: "stalled ×k" + distinct-family count.
  if (a.status === "stalled") {
    const fam = a.distinctFamilies > 1 ? ` (${a.distinctFamilies} families)` : "";
    parts.push(`residual stalled ×${a.stale}${fam}`);
  } else if (a.lastResidual) {
    parts.push(`residual ${truncate(a.lastResidual)}`);
  }

  return parts.join("  ");
}

function bankedClause(b: BankedResult): string {
  const tier = b.tier ? ` [${b.tier}]` : "";
  const flag = b.verified ? "" : " (unverified)";
  return `${truncate(b.statement)}${tier}${flag}`;
}

function deadClause(d: DeadRoute): string {
  const wave = d.killedByWave ? ` (${d.killedByWave})` : ` (c${d.killedAtCycle})`;
  return `${truncate(d.residual)}${wave}`;
}

/** A parked discovery, factual: ⟡ <obs> [class/tier] reuse×N [⟲] [surprise]. (prd-discovery §8) */
function discoveryClause(d: Discovery): string {
  const rung = d.tier ? ` [${d.class ?? "?"}/${d.tier}]` : "";
  const lp = d.learningProgress ? " ⟲" : "";
  const sp = d.surprise ? " surprise" : "";
  return `⟡ ${truncate(d.observation)}${rung}  reuse×${d.reuse}${lp}${sp}`;
}

/** Word-aware truncation: back up to the last space if one is reasonably close,
 *  so a clipped note ends on a word boundary rather than mid-word. */
function truncate(s: string): string {
  if (s.length <= NOTE_CAP) return s;
  const cut = s.slice(0, NOTE_CAP - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > NOTE_CAP * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

// ── hook JSON wrappers (the ONLY thing that goes to hook stdout) ──────────────

export function promptHook(
  text: string,
  event: "UserPromptSubmit" | "SessionStart" = "UserPromptSubmit",
): PromptHookOutput {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

/** Stop hook: the turn may end (exit 0, empty body). */
export function stopPass(): StopHookOutput {
  return {};
}

/** Stop hook: hard block with an imperative next-step reason (allowed for blocks — PRD §7). */
export function stopBlock(reason: string): StopHookOutput {
  return { decision: "block", reason };
}

/** Stop hook: loop-guard / soft reminder delivered as context, not a block (exit 0). */
export function stopSoft(text: string): StopHookOutput {
  return { hookSpecificOutput: { hookEventName: "Stop", additionalContext: text } };
}
