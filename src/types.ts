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

/**
 * Outcome of one arm-pull. `died` is the modal, productive outcome (PRD §4.3).
 * `discovery` is OFF-ARM/OFF-FRONTIER — a parked off-goal result (prd-discovery §4.1); it
 * carries `arm: null` and is neutral to the breaker.
 * `orient` is OFF-ARM and NOT A WAVE — a no-wave turn marker (orientation / planning /
 * answering the user); it carries `arm: null` + no decision, satisfies G1, and is neutral
 * to every breaker (it is not a pull). PRD §4.2.
 */
export type Outcome =
  | "banked"
  | "progress"
  | "died"
  | "refuted"
  | "null"
  | "discovery"
  | "orient"
  | "graduate";

export const OUTCOME_GLYPH: Record<Outcome, string> = {
  banked: "▣",
  progress: "△",
  died: "✗",
  refuted: "⊘",
  null: "—",
  discovery: "⟡",
  orient: "·",
  graduate: "↟",
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
  arm: string | null; // arm id this pull funded; null ONLY for off-arm discovery records
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
  /** The Question (disprovability / why-it-matters). REQUIRED iff outcome === "discovery". prd-discovery §4.1. */
  question?: string;
  /** Artifact refs this pull/discovery builds on — drives the cross-thread `reuse` signal. prd-discovery §4.3. */
  cites?: string[];
  /** cycle of the discovery this record forked into a new campaign — an inert fork-marker. prd-discovery §4.5. */
  fork_of?: number;
  /** cycle of the result this record graduated to vibefeld — an inert forward-seam marker. seam-sketch §2.1. */
  graduates?: number;
  /** the vibefeld root-obligation ref a result was graduated INTO — set on the graduate marker. seam-sketch §2.1. */
  graduated_to?: string;
  /**
   * The vibefeld node/challenge ref this record was seeded BY (`fr ingest --write`). Backward-seam
   * provenance AND the idempotency key: a re-ingest whose `residualRef` already appears here is
   * skipped; a changed node (new contentHash → new ref) re-ingests. seam-sketch §2.2/§6.
   */
  from_vibefeld?: string;
}

export interface ArmConfig {
  id: string;
  desc: string;
  priority: Priority;
  target: string | null;
  kill: string | null; // pre-registered kill criterion
  created: string; // ISO-8601
  /** cycle of the discovery this arm was promoted from (`fr arm add --from-discovery`). prd-discovery §4.4. */
  from_discovery?: number;
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

/** Provenance stamped on a forked child campaign (prd-discovery §4.5). Snapshot, not a live link. */
export interface ForkedFrom {
  repo: string; // parent project root
  goal: string; // parent goal
  cycle: number; // the discovery cycle that seeded this campaign
  discovery: string | null; // the seeding discovery's artifact or observation
  inherits: string[]; // cited artifact refs inherited BY REFERENCE (child re-banks via its own oracle)
}

export interface Portfolio {
  goal: string;
  frontier: string; // the single live named open (current)
  config: Config;
  arms: ArmConfig[];
  /** Set only on a child campaign materialised by `fr fork` (prd-discovery §4.5). */
  forked_from?: ForkedFrom;
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

/** Promotion state of an off-goal discovery (prd-discovery §4.4). D1 only yields `parked`. */
export type DiscoveryStatus = "parked" | "promoted-arm" | "forked" | "decayed";

/** A parked off-goal discovery, derived from `discovery ⟡` records (prd-discovery §4.2). */
export interface Discovery {
  cycle: number;
  observation: string; // the note
  question: string; // The Question (falsifier / why it matters)
  class: EvidenceClass | null;
  tier: Tier | null;
  artifact: string | null;
  /** Cross-thread reuse: distinct arms whose pulls `cites` this discovery's artifact. prd-discovery §4.3. */
  reuse: number;
  /** A citing pull MOVED (reduced the frontier / banked / progressed) — it unstuck a thread. F7. */
  learningProgress: boolean;
  /** Landed a usable artifact despite a low pre-registered `p_true` (advisory; unexpected AND relevant). F6. */
  surprise: boolean;
  status: DiscoveryStatus;
}

/** Forward-seam trust label: a graduated result's initial taint in vibefeld, derived from its fr tier. seam-sketch §3. */
export type ForwardTaint = "clean" | "admitted";

/** A forward-seam graduation: an fr survivor handed to vibefeld as a root obligation. seam-sketch §2.1. */
export interface Graduation {
  cycle: number; // the fr cycle whose result graduated
  arm: string | null; // the arm that produced it (banked/died name an arm)
  statement: string; // the proposition handed to vibefeld (the source record's note)
  vibefeldRef: string; // the graduated_to ref
  tier: Tier | null; // fr tier of the graduated result
  initialTaint: ForwardTaint; // clean IFF tier T0 (a proof); else admitted — trust conservation
}

// ────────────────────────────────────────────────────────────────────────────
// Backward seam (vibefeld → fr): the structured "richer return type" fr reads,
// and the reopened obligations it maps to. seam-sketch §2.2/§3/§6.
// ────────────────────────────────────────────────────────────────────────────

/** A vibefeld node's epistemic state (`af status --format json`). concepts.md §states. */
export type VibefeldEpistemic = "pending" | "validated" | "admitted" | "refuted" | "archived";

/** A vibefeld node's taint state — how much unearned trust it carries. concepts.md §taint. */
export type VibefeldTaint = "clean" | "self_admitted" | "tainted" | "unresolved";

/** Challenge severity; `critical`/`major` BLOCK acceptance, `minor`/`note` are advisory. */
export type ChallengeSeverity = "critical" | "major" | "minor" | "note" | (string & {});

/** One vibefeld proof node, scrubbed to what the seam needs. seam-sketch §6. */
export interface VibefeldNode {
  id: string; // hierarchical, e.g. "1.1.2"
  statement: string;
  epistemic: VibefeldEpistemic;
  taint: VibefeldTaint;
  contentHash: string;
  /** A LEAF has no descendant node (no other id begins `${id}.`). A taint residual is a leaf. */
  isLeaf: boolean;
}

/** One vibefeld challenge against a node. seam-sketch §2.2. */
export interface VibefeldChallenge {
  id: string;
  nodeId: string;
  status: "open" | "resolved" | "withdrawn" | (string & {});
  severity: ChallengeSeverity;
  reason: string;
}

/** The structured verdict fr reads from a vibefeld workspace (an oracle of a richer return type). */
export interface VibefeldState {
  afDir: string;
  nodes: VibefeldNode[];
  challenges: VibefeldChallenge[];
}

/**
 * A reopened obligation crossing BACK from vibefeld into fr (seam-sketch §2.2). Each is
 * type-identical to an fr `died-at` residual — an obligation newly sharpened, not discharged.
 * `crack` (a critical gap in a node fr had BANKED → supersession) is deferred to the write
 * increment: it needs the cross-ledger join to fr's banked ledger (the credit-assignment loop).
 */
export type ResidualKind = "gap" | "taint" | "refutation";

/** What fr obligation a residual would become when the write path lands. */
export type ResidualLanding = "arm" | "discovery" | "refuted";

export interface ResidualToken {
  kind: ResidualKind;
  statement: string; // the gap / admitted lemma / dead approach
  lands: ResidualLanding;
  provenance: { afDir: string; nodeId: string; challengeId: string | null; contentHash: string };
  /**
   * Trust conservation (seam-sketch §3): the CEILING tier fr may grant anything citing this.
   * `T2` for a tainted/admitted lemma (can NEVER support a banked/T0 fr result); `null` for a
   * `gap` (a fresh open, banks nothing) or a `refutation` (a dead-route). NEVER T0 — that would
   * be the trust-upgrade hole the whole anti-gaming spine exists to prevent (§8).
   */
  cap: Tier | null;
}

export interface DerivedState {
  goal: string;
  frontier: string;
  frontierTrail: string[]; // ordered sequence of frontier reductions
  arms: DerivedArm[];
  deadRoutes: DeadRoute[];
  banked: BankedResult[];
  discoveries: Discovery[]; // parked off-goal results (prd-discovery §4.2)
  orientTurns: number; // count of no-wave `orient ·` markers (off-arm, not pulls). PRD §4.2.
  graduations: Graduation[]; // survivors handed to vibefeld (forward seam). seam-sketch §2.1.
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
