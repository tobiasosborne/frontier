/**
 * frontier (`fr`) — the derived state (PURE).
 *
 * `derive(portfolio, log, verdicts, stripLen?) → DerivedState`. The append-only
 * log is the single source of truth (L2); EVERYTHING here is recomputed, never
 * stored. This module is pure and deterministic (L4 / Rule 5): NO fs, clock,
 * env, or network.
 *
 * Contract: docs/IMPL_PLAN.md §2 (`derive.ts`). Types: src/types.ts (imported, never redefined).
 */

import {
  OUTCOME_GLYPH,
  type Portfolio,
  type LogRecord,
  type Verdict,
  type DerivedState,
  type DerivedArm,
  type DeadRoute,
  type BankedResult,
  type Discovery,
  type Graduation,
  type ArmStatus,
  type Tier,
  type EvidenceClass,
} from "./types.ts";

const DEFAULT_STRIP_LEN = 6;

/** Lower number = stronger tier. T0 proof · T1 certified computation · T2 floats. */
const TIER_RANK: Record<Tier, number> = { T0: 0, T1: 1, T2: 2 };

/** A pull whose outcome is one of these always "moves" the frontier. */
const MOVING_OUTCOMES = new Set(["banked", "progress", "refuted"]);

/** `surprise` = a usable artifact landed despite a pre-registered prior at or below this (prd-discovery §4.3). */
const SURPRISE_PRIOR = 0.25;
/** A parked, reuse-0, non-T0 discovery older than this many cycles decays off the board tail (Decision B). */
const DECAY_AFTER_CYCLES = 8;

/** Map a raw model string to its provider family. */
function family(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("opus") || m.includes("sonnet") || m.includes("haiku") || m.includes("fable")) return "claude";
  if (m.includes("codex") || m.includes("gpt")) return "openai";
  if (m.includes("gemini")) return "google";
  return model;
}

export function derive(
  p: Portfolio,
  log: LogRecord[],
  verdicts: Verdict[],
  stripLen: number = DEFAULT_STRIP_LEN,
): DerivedState {
  // ── supersession: a record r with r.supersedes === c retires cycle c from the
  //    live view. The record stays in the log; we just don't count the superseded
  //    one as live.
  const superseded = new Set<number>();
  for (const r of log) {
    if (r.supersedes != null) superseded.add(r.supersedes);
  }
  const isLive = (r: LogRecord): boolean => !superseded.has(r.cycle);

  // ── per-arm derivation ──────────────────────────────────────────────────────
  const arms: DerivedArm[] = p.arms.map((arm) => deriveArm(arm, p, log, stripLen));

  // ── frontier trail: initial p.frontier, then distinct frontier_after values in
  //    log order; current frontier = last entry.
  const frontierTrail: string[] = [p.frontier];
  for (const r of log) {
    const fa = r.frontier_after;
    if (fa != null && fa !== frontierTrail[frontierTrail.length - 1]) {
      frontierTrail.push(fa);
    }
  }
  const frontier = frontierTrail[frontierTrail.length - 1]!;

  // ── dead routes: all refuted (residual = target) + all died (residual = at),
  //    deduped by residual, newest wins. (Superseded records are excluded.)
  const deadByResidual = new Map<string, DeadRoute>();
  for (const r of log) {
    if (!isLive(r)) continue;
    if (r.arm == null) continue; // off-arm (discovery) records never join the dead-routes ledger
    // `died` carries its residual in `at` (G5 guarantees it). `refuted` names the
    // killed thing in `target`, but operators naturally use `at`/note — so fall
    // back, otherwise a refutation silently misses the dead-routes ledger.
    let residual: string | null = null;
    if (r.outcome === "refuted") residual = r.target ?? r.at ?? (r.note.trim() || null);
    else if (r.outcome === "died") residual = r.at ?? (r.note.trim() || null);
    if (residual == null) continue;
    // newest wins: later log entries overwrite earlier ones for the same residual.
    deadByResidual.set(residual, {
      arm: r.arm,
      residual,
      reason: r.note,
      killedAtCycle: r.cycle,
      killedByWave: r.wave ?? null,
      outcome: r.outcome as "died" | "refuted",
    });
  }
  const deadRoutes = [...deadByResidual.values()];

  // ── banked ledger: live records with outcome === "banked". `verified` iff a
  //    verdict with result === "pass" and claim === artifact that is current.
  const banked: BankedResult[] = [];
  for (const r of log) {
    if (r.outcome !== "banked" || !isLive(r)) continue;
    if (r.arm == null) continue; // banked always names an arm; narrows arm to string
    const artifact = r.evidence?.artifact ?? null;
    const verified =
      artifact != null && verdicts.some((v) => v.result === "pass" && v.claim === artifact);
    banked.push({
      cycle: r.cycle,
      arm: r.arm,
      statement: r.note,
      artifact,
      tier: r.evidence?.tier ?? null,
      verified,
    });
  }

  const cycle = log.reduce((max, r) => (r.cycle > max ? r.cycle : max), 0);

  // ── discoveries ledger: live `discovery` records, with cross-thread `reuse`,
  //    learning-progress / surprise signals, and promotion/decay status
  //    (prd-discovery §4.2–4.4). Off-arm by construction, so neutral to every breaker.
  const discoveries = deriveDiscoveries(log, isLive, p.arms, cycle);

  // ── orient turns: live `orient` markers (no-wave turns — orientation / planning /
  //    answering the user). Off-arm, so excluded from every arm above; counted here only
  //    so the board can surface them factually (PRD §4.2). They are NOT pulls.
  const orientTurns = log.reduce((n, r) => (r.outcome === "orient" && isLive(r) ? n + 1 : n), 0);

  // ── graduations: live `graduate ↟` markers (forward seam → vibefeld). Off-arm by
  //    construction (arm:null), so excluded from every arm/breaker above. seam-sketch §2.1.
  const graduations = deriveGraduations(log, isLive);

  return { goal: p.goal, frontier, frontierTrail, arms, deadRoutes, banked, discoveries, orientTurns, graduations, cycle };
}

// ── discoveries ledger ───────────────────────────────────────────────────────

function deriveDiscoveries(
  log: LogRecord[],
  isLive: (r: LogRecord) => boolean,
  arms: Portfolio["arms"],
  currentCycle: number,
): Discovery[] {
  const promotedCycles = new Set<number>();
  for (const a of arms) if (a.from_discovery != null) promotedCycles.add(a.from_discovery);

  // fork-markers (records carrying `fork_of`) record that a discovery became a child campaign.
  const forkedCycles = new Set<number>();
  for (const r of log) if (isLive(r) && r.fork_of != null) forkedCycles.add(r.fork_of);

  const out: Discovery[] = [];
  for (const r of log) {
    if (r.outcome !== "discovery" || !isLive(r)) continue;
    if (r.fork_of != null) continue; // a fork-marker is not itself a ledger entry
    const artifact = r.evidence?.artifact ?? null;
    const tier = r.evidence?.tier ?? null;

    // reuse = DISTINCT arms whose (non-discovery) pulls cite this artifact (cross-THREAD,
    // not citation count). learningProgress = at least one of those citing pulls MOVED
    // (frontier reduction or banked/progress/refuted) — the discovery unstuck a thread (F7).
    let reuse = 0;
    let learningProgress = false;
    if (artifact != null) {
      const citingArms = new Set<string>();
      for (const o of log) {
        if (o.outcome === "discovery" || o.arm == null) continue;
        if (!(o.cites ?? []).includes(artifact)) continue;
        citingArms.add(o.arm);
        if (MOVING_OUTCOMES.has(o.outcome) || o.frontier_after != null) learningProgress = true;
      }
      reuse = citingArms.size;
    }

    // surprise = a usable artifact landed despite a low pre-registered prior (unexpected AND
    // relevant — F6). Advisory only, never gates.
    const surprise = artifact != null && r.p_true != null && r.p_true <= SURPRISE_PRIOR;

    // status: forked (became a child campaign) > promoted-arm (seeded an arm) > decayed
    // (parked, reuse-0, non-T0, aged past the window — Decision B) > parked.
    let status: Discovery["status"];
    if (forkedCycles.has(r.cycle)) {
      status = "forked";
    } else if (promotedCycles.has(r.cycle)) {
      status = "promoted-arm";
    } else if (reuse === 0 && tier !== "T0" && currentCycle - r.cycle >= DECAY_AFTER_CYCLES) {
      status = "decayed";
    } else {
      status = "parked";
    }

    out.push({
      cycle: r.cycle,
      observation: r.note,
      question: r.question ?? "",
      class: r.evidence?.class ?? null,
      tier,
      artifact,
      reuse,
      learningProgress,
      surprise,
      status,
    });
  }
  return out;
}

// ── graduations (forward seam → vibefeld) ──────────────────────────────────────

function deriveGraduations(log: LogRecord[], isLive: (r: LogRecord) => boolean): Graduation[] {
  const byCycle = new Map<number, LogRecord>();
  for (const r of log) byCycle.set(r.cycle, r);

  // newest marker per SOURCE cycle wins (a re-graduation supersedes an earlier ref).
  const byGraduated = new Map<number, Graduation>();
  for (const m of log) {
    if (!isLive(m) || m.outcome !== "graduate") continue;
    if (m.graduates == null || m.graduated_to == null) continue;
    const src = byCycle.get(m.graduates);
    const tier = src?.evidence?.tier ?? null;
    byGraduated.set(m.graduates, {
      cycle: m.graduates,
      arm: src?.arm ?? null,
      statement: src?.note ?? m.note,
      vibefeldRef: m.graduated_to,
      tier,
      // trust conservation: only a T0 proof enters vibefeld clean; anything weaker is admitted.
      initialTaint: tier === "T0" ? "clean" : "admitted",
    });
  }
  return [...byGraduated.values()];
}

// ── per-arm derivation ─────────────────────────────────────────────────────────

function deriveArm(
  arm: Portfolio["arms"][number],
  p: Portfolio,
  log: LogRecord[],
  stripLen: number,
): DerivedArm {
  const pulls = log.filter((r) => r.arm === arm.id); // oldest → newest

  // running staleness walk
  let runningFrontier = p.frontier;
  let stale = 0;
  // `stallRunModels` = the workers across the trailing run of pulls counted into
  // `stale` (reset whenever a pull moves the frontier).
  let stallRunModels: string[] = [];

  let bestTierRank = Infinity;
  let bestTier: Tier | null = null;
  let bestClass: EvidenceClass | null = null;

  const pSum: number[] = [];

  for (const r of pulls) {
    // A `died`/`null` pull RESETS staleness ONLY if it genuinely advances the
    // problem: a FRONTIER reduction (`frontier_after` differs) or a moving
    // outcome (banked/progress/refuted). Renaming/paraphrasing the `at` residual
    // does NOT reset — otherwise the model could paraphrase its way around the
    // one non-skippable rule (PRD §4.5). The `at` residual remains the death
    // certificate (G5, dead-routes), it just doesn't drive the breaker.
    const frontierMoved =
      r.frontier_after != null && r.frontier_after !== runningFrontier;
    const moves = MOVING_OUTCOMES.has(r.outcome) || frontierMoved;

    if (moves) {
      stale = 0;
      stallRunModels = [];
    } else {
      stale += 1;
      for (const w of r.workers) stallRunModels.push(w.model);
    }

    // update running context AFTER deciding movement
    if (r.frontier_after != null) runningFrontier = r.frontier_after;

    // best tier/class — only progress/banked pulls contribute evidence rungs
    if ((r.outcome === "progress" || r.outcome === "banked") && r.evidence) {
      const rank = TIER_RANK[r.evidence.tier];
      if (rank < bestTierRank) {
        bestTierRank = rank;
        bestTier = r.evidence.tier;
        bestClass = r.evidence.class;
      }
    }

    if (r.p_true != null) pSum.push(r.p_true);
  }

  // strip: last `stripLen` outcome glyphs, newest last
  const glyphs = pulls.map((r) => OUTCOME_GLYPH[r.outcome]);
  const strip = glyphs.slice(Math.max(0, glyphs.length - stripLen)).join("");

  const distinctFamilies = new Set(stallRunModels.map(family)).size;

  const aggP = pSum.length === 0 ? null : pSum.reduce((a, b) => a + b, 0) / pSum.length;

  const last = pulls[pulls.length - 1];
  const lastResidual = lastResidualOf(pulls);

  const status = statusOf(arm, pulls, stale, p.config.stale_threshold, last);

  return {
    id: arm.id,
    desc: arm.desc,
    priority: arm.priority,
    target: arm.target,
    pulls: pulls.length,
    strip,
    bestTier,
    bestClass,
    stale,
    distinctFamilies,
    status,
    aggP,
    lastResidual,
  };
}

/** Most recent non-null residual (`at`) on the arm, else null. */
function lastResidualOf(pulls: LogRecord[]): string | null {
  for (let i = pulls.length - 1; i >= 0; i--) {
    const at = pulls[i]!.at;
    if (at != null) return at;
  }
  return null;
}

function statusOf(
  arm: Portfolio["arms"][number],
  pulls: LogRecord[],
  stale: number,
  threshold: number,
  last: LogRecord | undefined,
): ArmStatus {
  // `dead` is an explicit operator decision and outranks `untried`: a killed arm
  // must not masquerade as an unexplored opportunity (`??`).
  if (arm.priority === "dead") return "dead";
  if (pulls.length === 0) return "untried";
  if (stale >= threshold) return "stalled";
  if (last) {
    if (last.outcome === "banked" || last.outcome === "progress") return "hot";
    if (last.outcome === "died" && last.at != null) return "warm";
  }
  return "cold";
}
