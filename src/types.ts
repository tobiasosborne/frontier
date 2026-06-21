/**
 * frontier (`fr`) — the shared type contract.
 *
 * SINGLE SOURCE OF TRUTH. Every module imports from here and never redefines a type.
 * Pure modules (derive/referee/validate/board) depend ONLY on these types — no FS/clock/env.
 *
 * See docs/prd.md (§4 model, §5 data model, §7 referee) and docs/IMPL_PLAN.md.
 */

// ────────────────────────────────────────────────────────────────────────────
// Vocabulary
// ────────────────────────────────────────────────────────────────────────────

/** Outcome of one arm-pull. `died` is the modal, productive outcome (PRD §4.3). */
export type Outcome = "banked" | "progress" | "died" | "refuted" | "null";

export const OUTCOME_GLYPH: Record<Outcome, string> = {
  banked: "▣",
  progress: "△",
  died: "✗",
  refuted: "⊘",
  null: "—",
};

/** Evidence class is an OPEN vocabulary; these are the well-known kinds. */
export type EvidenceClass = "lit" | "num" | "side" | "af" | "lean" | "stated" | (string & {});

/** Rigour tier, orthogonal to class. T0 proof · T1 certified computation · T2 floats/guidance. */
export type Tier = "T0" | "T1" | "T2";

/** Graded funding state of an arm (not binary alive/dead — PRD §4.1). */
export type Priority = "primary" | "exploratory" | "support" | "background" | "logged" | "dead";

/** Promotion status of a result on the rigour ladder (PRD §2). */
export type Verdictish = "claimed" | "audited" | "banked";

/** The decision every turn ends on (PRD §4.4). PIVOT = same problem, changed technology. */
export type DecisionType = "EXPLOIT" | "EXPLORE" | "PIVOT";

// ────────────────────────────────────────────────────────────────────────────
// Stored state (.frontier/)
// ────────────────────────────────────────────────────────────────────────────

export interface Evidence {
  class: EvidenceClass;
  tier: Tier;
  /** A resolvable ref: repo-relative path | registry id | arXiv/DOI | Lean lemma. null if none. */
  artifact: string | null;
  /** Promotion status of the result this evidence backs. Defaults to "claimed". */
  verdict?: Verdictish;
}

export interface Worker {
  /** e.g. "opus" | "sonnet" | "codex" | "gemini". */
  model: string;
  /** e.g. "prover" | "refuter" | "auditor" | "lit" | "numerics". */
  role: string;
}

export interface Decision {
  type: DecisionType;
  /** The next arm id to fund. For PIVOT this may equal the current arm. */
  arm: string;
}

/** One append-only record per arm-pull (one wave may append several). PRD §5. */
export interface LogRecord {
  ts: string; // ISO-8601
  cycle: number; // monotone index, 1-based
  wave?: string; // optional wave label e.g. "w37"
  arm: string; // arm id this pull funded
  target: string | null; // the named open this pull attacked
  outcome: Outcome;
  /** Death certificate — the residual it died at. REQUIRED iff outcome === "died". */
  at: string | null;
  note: string;
  evidence: Evidence | null;
  workers: Worker[];
  p_true?: number | null; // advisory only (PRD §15.2); never promotes a result
  p_audit?: number | null; // advisory only
  decision: Decision | null;
  /** The FRONTIER one-liner AFTER this pull, set only when the pull reduced it. */
  frontier_after?: string | null;
  /** cycle index of a prior record this one supersedes (retraction/downgrade). */
  supersedes?: number | null;
}

export interface ArmConfig {
  id: string;
  desc: string;
  priority: Priority;
  target: string | null;
  kill: string | null; // pre-registered kill criterion
  created: string; // ISO-8601
}

/** A registered external oracle for `fr verify` (PRD §7). Runs as argv, NO shell. */
export interface OracleConfig {
  name: string;
  cmd: string[]; // argv; exit 0 → pass, non-zero → fail
  inputs?: string[]; // optional input file paths folded into inputs_hash
}

export interface Config {
  stale_threshold: number; // default 2 (PRD §15.1)
  max_blocks_per_turn: number; // default 2 (loop guard, PRD §7)
  evidence_bar?: Record<string, string>;
  oracles?: OracleConfig[];
}

export interface Portfolio {
  goal: string;
  frontier: string; // the single live named open (current)
  config: Config;
  arms: ArmConfig[];
}

/** Ephemeral per-turn state stamped by `turn-begin`, diffed by `check`. PRD §5. */
export interface TurnState {
  log_len_at_turn_start: number;
  blocks_this_turn: number;
}

/** A scrubbed, hash-bound oracle verdict (PRD §7). Goes stale when any hash changes. */
export interface Verdict {
  claim: string; // claim/result id (an artifact ref)
  oracle: string; // oracle name
  result: "pass" | "fail" | "error";
  claim_hash: string;
  oracle_digest: string;
  inputs_hash: string;
  ts: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Derived state (computed from the log; NEVER stored — L2)
// ────────────────────────────────────────────────────────────────────────────

export type ArmStatus = "hot" | "warm" | "cold" | "stalled" | "dead" | "untried";

export interface DerivedArm {
  id: string;
  desc: string;
  priority: Priority;
  target: string | null;
  pulls: number;
  /** Trailing glyph strip, newest last, capped (default 6). */
  strip: string;
  bestTier: Tier | null; // best evidence rung reached
  bestClass: EvidenceClass | null;
  /** Consecutive trailing frontier-non-moving pulls (the breaker's input). PRD §4.5. */
  stale: number;
  /** Distinct model families that hit the current trailing residual (board signal). */
  distinctFamilies: number;
  status: ArmStatus;
  aggP: number | null; // aggregated P(true), advisory/sort only
  lastResidual: string | null;
}

export interface DeadRoute {
  arm: string;
  residual: string; // keyed on `at` (died) or target (refuted)
  reason: string;
  killedAtCycle: number;
  killedByWave: string | null;
  outcome: Extract<Outcome, "died" | "refuted">;
}

export interface BankedResult {
  cycle: number;
  arm: string;
  statement: string;
  artifact: string | null;
  tier: Tier | null;
  verified: boolean; // has a passing, non-stale verdict
}

export interface DerivedState {
  goal: string;
  frontier: string;
  frontierTrail: string[]; // ordered sequence of frontier reductions
  arms: DerivedArm[];
  deadRoutes: DeadRoute[];
  banked: BankedResult[];
  cycle: number; // last cycle index seen (0 if empty)
}

// ────────────────────────────────────────────────────────────────────────────
// Referee
// ────────────────────────────────────────────────────────────────────────────

export type CheckStatus = "pass" | "block" | "soft";

export interface CheckResult {
  status: CheckStatus;
  gate?: string; // e.g. "G3"
  /** Imperative next-step instruction — allowed for blocks/soft (delivered to the model). */
  reason?: string;
}

/** Result of write-time validation for `fr log`. */
export interface ValidationResult {
  ok: boolean;
  error?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Hook JSON output shapes (PRD §5/§7/§9)
// ────────────────────────────────────────────────────────────────────────────

export interface PromptHookOutput {
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit" | "SessionStart";
    additionalContext: string;
  };
}

export interface StopHookOutput {
  decision?: "block";
  reason?: string;
  hookSpecificOutput?: { hookEventName: "Stop"; additionalContext: string };
}
