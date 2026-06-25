/**
 * referee.ts — the PURE adjudicator behind `fr check` (Pillar B).
 *
 * `check` is a deterministic, side-effect-free function of its inputs (L4): NO fs / clock /
 * env / network. It certifies PROVENANCE and PROTOCOL, never mathematical truth (anti-gaming
 * principle). It never throws on well-typed input — fail-closed is the CLI's job, not ours.
 *
 * Gates run in the IMPL_PLAN §2 order; the FIRST failing gate determines the result:
 *   G1 logged-this-turn · G5 died-needs-residual · G2 progress/banked-backed ·
 *   G_launder anti-laundering · G2b banked-verified · G3 breaker · G4 ends-on-decision.
 *
 * Loop guard: if `turn.blocks_this_turn >= p.config.max_blocks_per_turn`, a would-be
 * {status:"block"} is emitted as {status:"soft"} instead (keeping the gate + reason).
 */
import type {
  CheckResult,
  DecisionType,
  DerivedState,
  LogRecord,
  Portfolio,
  TurnState,
  Verdict,
} from "./types";

/** A decision is an "escape" from a tripped breaker iff it EXPLOREs a different arm or PIVOTs. */
function isEscape(type: DecisionType, decisionArm: string, currentArm: string | null): boolean {
  if (type === "PIVOT") return true;
  if (type === "EXPLORE" && decisionArm !== currentArm) return true;
  return false;
}

/** Is there a passing verdict whose claim is exactly `artifact`? (Staleness recompute is oracle.ts's job.) */
function hasPassingVerdict(verdicts: Verdict[], artifact: string | null): boolean {
  if (!artifact) return false;
  return verdicts.some((v) => v.result === "pass" && v.claim === artifact);
}

export function check(
  state: DerivedState,
  turn: TurnState,
  log: LogRecord[],
  p: Portfolio,
  verdicts: Verdict[],
): CheckResult {
  const guardTripped = turn.blocks_this_turn >= p.config.max_blocks_per_turn;

  // A failing gate routes through here: block, or soft if the loop guard is tripped.
  const fail = (gate: string, reason: string): CheckResult => ({
    status: guardTripped ? "soft" : "block",
    gate,
    reason,
  });

  const newThisTurn = log.slice(turn.log_len_at_turn_start);
  // Off-arm records (`discovery ⟡`, `orient ·`, `graduate ↟`) are NOT a wave outcome and carry no
  // decision, so the decision-bearing gates (G3/G4) read the newest ARM-PULL, and G1 counts
  // arm-pulls only (a turn that logs only a discovery/graduate has not logged its wave). prd-discovery §7.
  const isPull = (r: LogRecord): boolean =>
    r.outcome !== "discovery" && r.outcome !== "orient" && r.outcome !== "graduate";
  const newPulls = newThisTurn.filter(isPull);
  // A no-wave turn (orientation / planning / answering the user) is accounted for by an explicit
  // `orient ·` marker — off-arm, breaker-neutral, and NOT a pull. It satisfies G1 without
  // faking an arm-pull (PRD §4.2); the wave gates below have nothing to adjudicate.
  const newOrients = newThisTurn.filter((r) => r.outcome === "orient");
  let newest: LogRecord | undefined;
  for (let i = log.length - 1; i >= 0; i--) {
    if (isPull(log[i]!)) {
      newest = log[i];
      break;
    }
  }

  // ── G1 logged-this-turn ────────────────────────────────────────────────────
  // The turn must be affirmatively accounted for: a wave (≥1 arm-pull) OR an explicit
  // no-wave `orient` marker. A turn that logs nothing — or only a discovery — still blocks.
  if (newPulls.length === 0 && newOrients.length === 0) {
    return fail("G1", "No wave outcome logged this turn. Record it with `fr log …` (or `fr orient` if no wave ran).");
  }

  // A no-wave (orient-only) turn is now accounted for; there is no wave to adjudicate, so the
  // remaining gates (G5/G2/G_launder/G2b/G3/G4) do not apply — return pass. (Crucially this
  // keeps G4's "ends on a decision" from firing on a legitimate first-turn orient.)
  if (newPulls.length === 0) {
    return { status: "pass" };
  }

  // ── G5 died-needs-residual ──────────────────────────────────────────────────
  for (const r of newThisTurn) {
    if (r.outcome === "died" && !r.at) {
      return fail(
        "G5",
        `Arm ${r.arm}'s ✗ died record needs a death certificate. Add the residual with --at <residual>.`,
      );
    }
  }

  // ── G2 progress/banked-backed ───────────────────────────────────────────────
  for (const r of newThisTurn) {
    if ((r.outcome === "progress" || r.outcome === "banked") && !r.evidence?.artifact) {
      return fail(
        "G2",
        `${r.outcome === "banked" ? "▣ banked" : "△ progress"} needs a resolvable artifact. Add --artifact <ref>.`,
      );
    }
  }

  // ── G_launder anti-laundering ───────────────────────────────────────────────
  for (const r of newThisTurn) {
    if (r.outcome === "refuted" && r.evidence?.verdict === "banked") {
      return fail(
        "G_launder",
        "A refuted counterexample cannot carry a banked verdict. A residual cannot launder a failing oracle.",
      );
    }
  }

  // ── G2b banked-verified ─────────────────────────────────────────────────────
  for (const r of newThisTurn) {
    if (r.outcome === "banked" && !hasPassingVerdict(verdicts, r.evidence?.artifact ?? null)) {
      return fail(
        "G2b",
        "`▣ banked` needs an audit verdict from an oracle other than the author. Run `fr verify` or downgrade to `△`.",
      );
    }
  }

  // ── G3 breaker ──────────────────────────────────────────────────────────────
  if (newest && newest.decision) {
    const armId = newest.arm;
    const s = state.arms.find((a) => a.id === armId);
    if (s && s.stale >= p.config.stale_threshold) {
      const d = newest.decision;
      if (!isEscape(d.type, d.arm, armId)) {
        return fail(
          "G3",
          `Arm ${armId}'s residual has survived ${s.stale} frontier-non-moving pulls. ` +
            "Next cycle must EXPLORE a different arm or PIVOT.",
        );
      }
    }
  }

  // ── G4 ends-on-decision ─────────────────────────────────────────────────────
  if (!newest || !newest.decision) {
    return fail("G4", "End the turn on EXPLOIT|EXPLORE|PIVOT <arm>.");
  }

  return { status: "pass" };
}
