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
  type ArmStatus,
  type Tier,
  type EvidenceClass,
} from "./types.ts";

const DEFAULT_STRIP_LEN = 6;

/** Lower number = stronger tier. T0 proof · T1 certified computation · T2 floats. */
const TIER_RANK: Record<Tier, number> = { T0: 0, T1: 1, T2: 2 };

/** A pull whose outcome is one of these always "moves" the frontier. */
const MOVING_OUTCOMES = new Set(["banked", "progress", "refuted"]);

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

  // ── discoveries ledger: live `discovery` records, with cross-thread `reuse`
  //    (prd-discovery §4.2). Off-arm by construction, so neutral to every breaker.
  const discoveries = deriveDiscoveries(log, isLive);

  const cycle = log.reduce((max, r) => (r.cycle > max ? r.cycle : max), 0);

  return { goal: p.goal, frontier, frontierTrail, arms, deadRoutes, banked, discoveries, cycle };
}

// ── discoveries ledger ───────────────────────────────────────────────────────

function deriveDiscoveries(log: LogRecord[], isLive: (r: LogRecord) => boolean): Discovery[] {
  const out: Discovery[] = [];
  for (const r of log) {
    if (r.outcome !== "discovery" || !isLive(r)) continue;
    const artifact = r.evidence?.artifact ?? null;
    // reuse = DISTINCT arms whose (non-discovery) pulls cite this discovery's artifact
    // — POET's "transfer is load-bearing" signal, cross-THREAD not citation count.
    let reuse = 0;
    if (artifact != null) {
      const citingArms = new Set<string>();
      for (const o of log) {
        if (o.outcome === "discovery" || o.arm == null) continue;
        if ((o.cites ?? []).includes(artifact)) citingArms.add(o.arm);
      }
      reuse = citingArms.size;
    }
    out.push({
      cycle: r.cycle,
      observation: r.note,
      question: r.question ?? "",
      class: r.evidence?.class ?? null,
      tier: r.evidence?.tier ?? null,
      artifact,
      reuse,
      status: "parked", // promoted-arm/forked/decayed are D2/D3
    });
  }
  return out;
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
