/**
 * validate.ts — PURE write-time validation for `fr log` (Pillar B).
 *
 * Mirrors the relevant referee gates so the model gets immediate feedback at `fr log` time
 * (PRD §6), not only at the Stop hook. Side-effect-free, deterministic (L4): NO fs / clock /
 * env / network. Returns {ok:true} or {ok:false, error:"<clear message>"}.
 *
 * Rejects: died-without-`at` · progress/banked-without-artifact · banked-without-passing
 * verdict · refuted-launder (evidence.verdict==="banked") · unknown arm id · missing
 * decision · decision.arm not a registered arm · breaker tripped (rec's arm is `stalled`
 * in derived state) and decision is not an escape (EXPLORE-different / PIVOT).
 */
import type {
  DecisionType,
  DerivedState,
  LogRecord,
  Portfolio,
  ValidationResult,
  Verdict,
} from "./types";

/** A decision escapes a tripped breaker iff it EXPLOREs a different arm or PIVOTs. */
function isEscape(type: DecisionType, decisionArm: string, currentArm: string): boolean {
  if (type === "PIVOT") return true;
  if (type === "EXPLORE" && decisionArm !== currentArm) return true;
  return false;
}

function hasPassingVerdict(verdicts: Verdict[], artifact: string | null): boolean {
  if (!artifact) return false;
  return verdicts.some((v) => v.result === "pass" && v.claim === artifact);
}

const reject = (error: string): ValidationResult => ({ ok: false, error });

export function validateLog(
  p: Portfolio,
  state: DerivedState,
  rec: LogRecord,
  verdicts: Verdict[],
): ValidationResult {
  // ── unknown arm id ──────────────────────────────────────────────────────────
  if (!p.arms.some((a) => a.id === rec.arm)) {
    return reject(`Unknown arm '${rec.arm}'. Register it with \`fr arm add ${rec.arm} …\` first.`);
  }

  // ── died without `at` ───────────────────────────────────────────────────────
  if (rec.outcome === "died" && !rec.at) {
    return reject("A ✗ died record needs a death certificate: add --at <residual>.");
  }

  // ── progress / banked without artifact ──────────────────────────────────────
  if ((rec.outcome === "progress" || rec.outcome === "banked") && !rec.evidence?.artifact) {
    return reject(
      `${rec.outcome === "banked" ? "▣ banked" : "△ progress"} needs a resolvable artifact: add --artifact <ref>.`,
    );
  }

  // ── refuted-launder ─────────────────────────────────────────────────────────
  if (rec.outcome === "refuted" && rec.evidence?.verdict === "banked") {
    return reject(
      "A ⊘ refuted record cannot carry a banked verdict — a residual cannot launder a failing oracle.",
    );
  }

  // ── banked without a passing verdict ────────────────────────────────────────
  if (rec.outcome === "banked" && !hasPassingVerdict(verdicts, rec.evidence?.artifact ?? null)) {
    return reject(
      "▣ banked needs a passing audit verdict from an oracle other than the author. Run `fr verify` or downgrade to △. (`fr help bank-gate`)",
    );
  }

  // ── missing decision ────────────────────────────────────────────────────────
  if (!rec.decision) {
    return reject("Every turn must end on a decision: --decide EXPLOIT|EXPLORE|PIVOT <arm>.");
  }

  // ── decision.arm not a registered arm ───────────────────────────────────────
  if (!p.arms.some((a) => a.id === rec.decision!.arm)) {
    return reject(`Decision targets unknown arm '${rec.decision.arm}'. Register it first.`);
  }

  // ── breaker tripped at write time ───────────────────────────────────────────
  // A pull that REDUCES the FRONTIER (records a fresh `frontier_after`) un-stalls
  // the arm (PRD §4.5: a productive death is the escape), so it is exempt — it may
  // keep EXPLOITing the newly-reduced open. Only a NON-reducing pull on a stalled
  // arm is held to the escape rule (EXPLORE-different / PIVOT). The Stop hook (G3)
  // remains the backstop for the tripping transition.
  const reducesFrontier = rec.frontier_after != null && rec.frontier_after !== state.frontier;
  const s = state.arms.find((a) => a.id === rec.arm);
  if (
    s &&
    s.status === "stalled" &&
    !reducesFrontier &&
    !isEscape(rec.decision.type, rec.decision.arm, rec.arm)
  ) {
    return reject(
      `Arm ${rec.arm} is stalled — its residual has survived the breaker threshold. ` +
        "Next cycle must EXPLORE a different arm or PIVOT (or reduce the FRONTIER with --frontier). (`fr help breaker`)",
    );
  }

  return { ok: true };
}
