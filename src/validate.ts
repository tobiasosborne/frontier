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
  Discovery,
  LogRecord,
  Portfolio,
  ValidationResult,
  Verdict,
} from "./types";

/** Decision A (prd-discovery §12): a discovery is fork-eligible at this much cross-thread reuse. */
const K_FORK = 2;

/** A decision escapes a tripped breaker iff it EXPLOREs a different arm or PIVOTs. */
function isEscape(type: DecisionType, decisionArm: string, currentArm: string | null): boolean {
  if (type === "PIVOT") return true;
  if (type === "EXPLORE" && decisionArm !== currentArm) return true;
  return false;
}

function hasPassingVerdict(verdicts: Verdict[], artifact: string | null): boolean {
  if (!artifact) return false;
  return verdicts.some((v) => v.result === "pass" && v.claim === artifact);
}

const reject = (error: string): ValidationResult => ({ ok: false, error });

/**
 * Write-time validation for `fr discover` (prd-discovery §4.1, §6). A capture is cheap and
 * liberal (notice-and-park), but it must carry the recognition step: an observation and
 * Platt's "The Question" (what would falsify it / why it matters). PURE.
 */
export function validateDiscover(rec: LogRecord): ValidationResult {
  if (!rec.note || !rec.note.trim()) {
    return reject('A discovery needs an observation: fr discover "<observation>" --question "…".');
  }
  if (!rec.question || !rec.question.trim()) {
    return reject(
      'A discovery needs --question "<what would falsify this / why it matters>" (Platt\'s The Question). (`fr help discovery`)',
    );
  }
  return { ok: true };
}

/**
 * Write-time validation for `fr orient` (PRD §4.2). A no-wave turn marker is cheap and liberal
 * (orientation / planning / answering the user), but it must carry a brief reason so the log
 * stays auditable — a no-wave escape must never be contentless. PURE.
 */
export function validateOrient(rec: LogRecord): ValidationResult {
  if (!rec.note || !rec.note.trim()) {
    return reject('A no-wave turn needs a brief reason: fr orient "<why this turn ran no wave>".');
  }
  return { ok: true };
}

/**
 * GF — fork eligibility (prd-discovery §4.5 / §12 Decision A). A discovery may seed a NEW campaign
 * only with (a) a stateable new frontier, (b) a new goal, and (c) enough interestingness:
 * cross-thread `reuse ≥ K_FORK` OR demonstrated learning-progress (NOT raw surprise). PURE.
 */
export function validateFork(
  disc: Discovery | undefined,
  goal: string,
  frontier: string,
): ValidationResult {
  if (!disc) {
    return reject("No such parked discovery to fork. Check `fr board` / `fr status`.");
  }
  if (!goal || !goal.trim()) {
    return reject('A fork needs a new --goal "<the child campaign\'s goal>".');
  }
  if (!frontier || !frontier.trim()) {
    return reject(
      'A fork needs a stateable new --frontier "<a reducible open>" — if you cannot state one, it is not a goal yet; promote-to-arm instead. (`fr help discovery`)',
    );
  }
  if (!(disc.reuse >= K_FORK || disc.learningProgress)) {
    return reject(
      `Discovery #${disc.cycle} is not fork-eligible: reuse ${disc.reuse} (need ≥ ${K_FORK}) and no learning-progress. Promote-to-arm or accrue cross-thread reuse first. (\`fr help discovery\`)`,
    );
  }
  return { ok: true };
}

/**
 * Forward-seam graduation gate (seam-sketch §2.1). Only a statable SURVIVOR graduates to vibefeld:
 * a ▣ banked result (already verified at write) or a ✗ died-at residual (a sharply-stated open).
 * A vibe — null/progress/refuted, or a died without --at — has nothing statable to hand the proof
 * layer. The litmus as a GRADUATION gate (when is a survivor ready to leave fr?), not a per-arm
 * admission gate. PURE.
 */
export function validateGraduate(src: LogRecord | undefined, ref: string): ValidationResult {
  if (!src) {
    return reject("No such cycle to graduate. Check `fr board` / `fr status`.");
  }
  if (src.outcome !== "banked" && src.outcome !== "died") {
    return reject(
      `Only a ▣ banked result or a ✗ died-at residual graduates — cycle ${src.cycle} is '${src.outcome}' (a statable survivor, not a vibe).`,
    );
  }
  if (src.outcome === "died" && !src.at) {
    return reject(
      `Cycle ${src.cycle} died without a stated residual — nothing statable to graduate. (a ✗ needs --at)`,
    );
  }
  if (!ref || !ref.trim()) {
    return reject('A graduation needs a target: fr graduate <cycle> --to "<vibefeld root ref>".');
  }
  return { ok: true };
}

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
