/**
 * commands.ts — the `fr` command handlers (IMPURE edge, Pillar C).
 *
 * Each handler reads/writes `.frontier/` via store, runs the pure core (derive/validate/check/
 * board) or the oracle edge, and emits the result. cli.ts dispatches to these; cliutil.ts owns
 * argv parsing + the stdout/stderr writers.
 *
 * HOOK HYGIENE (L3 / PRD §11): `board --hook prompt` and `check --hook stop` print ONLY JSON to
 * stdout; every diagnostic → stderr. `check --hook stop` is FAIL-CLOSED: if `.frontier/` is
 * active and anything throws it BLOCKS the stop; if inert it prints `{}` (exit 0).
 *
 * STALENESS AT THE EDGE: `liveVerdicts` filters through `currentVerdicts` (resolving each claim's
 * live text from its artifact) before derive/check, so the pure core only ever sees CURRENT
 * verdicts — "presence === current" holds there.
 *
 * Contract: docs/IMPL_PLAN.md §2 (`cli.ts`). Types: src/types.ts (imported, never redefined).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  isActive,
  readPortfolio,
  writePortfolio,
  readLog,
  appendLog,
  readTurn,
  writeTurn,
  readVerdicts,
  writeVerdict,
} from "./store";
import { derive } from "./derive";
import { check } from "./referee";
import { validateLog, validateDiscover, validateOrient, validateFork, validateGraduate } from "./validate";
import { renderBoard, promptHook, stopPass, stopBlock, stopSoft } from "./board";
import { runOracle, currentVerdicts } from "./oracle";
import { out, err, parseArgs } from "./cliutil";
import type {
  Portfolio,
  LogRecord,
  Decision,
  DecisionType,
  Evidence,
  Outcome,
  Worker,
  Verdict,
  Verdictish,
} from "./types";

// ── shared helpers ────────────────────────────────────────────────────────────

/** Resolve a claim/artifact's live text: the artifact file's content if it exists, else the id. */
function claimText(dir: string, claim: string): string | null {
  const projectRoot = path.dirname(dir); // parent of .frontier/
  const abs = path.isAbsolute(claim) ? claim : path.join(projectRoot, claim);
  try {
    if (fs.statSync(abs).isFile()) return fs.readFileSync(abs, "utf8");
  } catch {
    /* not a file — fall through */
  }
  return claim; // an id with no backing file is still a stable claim text
}

/** Current (non-stale) verdicts, with each claim's live text resolved from its artifact. */
function liveVerdicts(dir: string): Verdict[] {
  return currentVerdicts(readVerdicts(dir), (claim) => claimText(dir, claim));
}

function defaultPortfolio(goal: string): Portfolio {
  return {
    goal,
    frontier: goal,
    config: { stale_threshold: 2, max_blocks_per_turn: 2, oracles: [] },
    arms: [],
  };
}

// ── init / arm / frontier ──────────────────────────────────────────────────────

export function cmdInit(dir: string, rest: string[]): number {
  const { pos } = parseArgs(rest);
  const goal = pos[0] ?? "";
  if (!goal) {
    err("usage: fr init \"<goal>\"");
    return 1;
  }
  writePortfolio(dir, defaultPortfolio(goal));
  out(`initialised .frontier/ — goal: ${goal}`);
  out('next: register approaches with `fr arm add <id> "<desc>"`, set the open with `fr frontier "<open>"`, then `fr help`.');
  return 0;
}

export function cmdArm(dir: string, rest: string[]): number {
  const { pos, flags } = parseArgs(rest);
  const sub = pos[0];
  const id = pos[1];
  if ((sub !== "add" && sub !== "set") || !id) {
    err("usage: fr arm add|set <id> [\"<desc>\"] [--priority p] [--target t] [--kill k]");
    return 1;
  }
  const p = readPortfolio(dir);
  let arm = p.arms.find((a) => a.id === id);
  if (sub === "add") {
    if (arm) {
      err(`arm '${id}' already exists.`);
      return 1;
    }
    arm = {
      id,
      desc: pos[2] ?? "",
      priority: (flags.priority as Portfolio["arms"][number]["priority"]) ?? "exploratory",
      target: flags.target ?? null,
      kill: flags.kill ?? null,
      created: new Date(0).toISOString(), // deterministic placeholder; not used by the core
    };
    // Rung 2 — promote a parked discovery into a new arm (same goal). prd-discovery §4.4.
    if (flags["from-discovery"] !== undefined) {
      const cyc = Number(flags["from-discovery"]);
      const disc = readLog(dir).find((r) => r.outcome === "discovery" && r.cycle === cyc);
      if (!disc) {
        err(`no discovery at cycle ${cyc} to promote. Check \`fr board\` / \`fr status\`.`);
        return 1;
      }
      arm.from_discovery = cyc;
      if (!pos[2]) arm.desc = disc.note; // seed the arm's description from the observation
    }
    p.arms.push(arm);
  } else {
    if (!arm) {
      err(`unknown arm '${id}'. Add it with \`fr arm add ${id} …\` first.`);
      return 1;
    }
    if (flags.priority) arm.priority = flags.priority as typeof arm.priority;
    if ("target" in flags) arm.target = flags.target || null;
    if ("kill" in flags) arm.kill = flags.kill || null;
    if (pos[2]) arm.desc = pos[2];
  }
  writePortfolio(dir, p);
  out(`arm ${id}: ${arm.priority}${arm.target ? `  target ${arm.target}` : ""}`);
  return 0;
}

export function cmdFrontier(dir: string, rest: string[]): number {
  const { pos } = parseArgs(rest);
  const text = pos[0];
  if (!text) {
    err("usage: fr frontier \"<the single live named open>\"");
    return 1;
  }
  const p = readPortfolio(dir);
  p.frontier = text;
  writePortfolio(dir, p);
  out(`FRONTIER → ${text}`);
  return 0;
}

// ── log ────────────────────────────────────────────────────────────────────────

export function cmdLog(dir: string, rest: string[], now: string): number {
  const { pos, flags, workers, cites } = parseArgs(rest);
  const [arm, outcomeRaw, note] = pos;
  if (!arm || !outcomeRaw) {
    err("usage: fr log <arm> <outcome> \"<note>\" [flags] --decide <TYPE> <next-arm>");
    return 1;
  }
  const p = readPortfolio(dir);
  const log = readLog(dir);
  const verdicts = liveVerdicts(dir);
  const state = derive(p, log, verdicts);

  const rec = buildRecord(arm, outcomeRaw as Outcome, note ?? "", flags, workers, cites, log, now);
  const result = validateLog(p, state, rec, verdicts);
  if (!result.ok) {
    err(result.error ?? "rejected");
    return 1;
  }
  appendLog(dir, rec);
  // A `--frontier` reduction is recorded ONLY as the log record's `frontier_after`. The derived
  // current open (the trail's last entry — L2) reflects it, and crucially the breaker resets
  // because derive's per-arm walk seeds `runningFrontier` from the UNREDUCED `p.frontier` and
  // sees this record move it. We deliberately do NOT also mutate `p.frontier` here: the frozen
  // derive (Pillar A) treats `p.frontier` as the ORIGINAL open / staleness baseline, so
  // overwriting it would corrupt the breaker reset. (Standalone `fr frontier` re-bases the open;
  // a per-pull reduction lives in the log.) See the integration §14 #2 test.
  out(`logged ${arm} ${outcomeRaw}${rec.decision ? `  → ${rec.decision.type} ${rec.decision.arm}` : ""}`);
  return 0;
}

function buildRecord(
  arm: string,
  outcome: Outcome,
  note: string,
  flags: Record<string, string>,
  workers: string[],
  cites: string[],
  log: LogRecord[],
  now: string,
): LogRecord {
  const cycle = log.reduce((m, r) => Math.max(m, r.cycle), 0) + 1;
  let decision: Decision | null = null;
  if (flags.decide) decision = { type: flags.decide as DecisionType, arm: flags["decide-arm"]! };

  let evidence: Evidence | null = null;
  if (flags.artifact || flags.class || flags.tier || flags.verdict) {
    evidence = {
      class: (flags.class as Evidence["class"]) ?? "stated",
      tier: (flags.tier as Evidence["tier"]) ?? "T2",
      artifact: flags.artifact ?? null,
      verdict: (flags.verdict as Verdictish) ?? "claimed",
    };
  }
  const parsedWorkers: Worker[] = workers.map((w) => {
    const [model, role] = w.split(":");
    return { model: model ?? w, role: role ?? "worker" };
  });

  return {
    ts: now,
    cycle,
    arm,
    target: flags.target ?? null,
    outcome,
    at: flags.at ?? null,
    note,
    evidence,
    workers: parsedWorkers,
    p_true: flags["p-true"] !== undefined ? Number(flags["p-true"]) : null,
    p_audit: flags["p-audit"] !== undefined ? Number(flags["p-audit"]) : null,
    decision,
    frontier_after: flags.frontier ?? null,
    supersedes: flags.supersedes !== undefined ? Number(flags.supersedes) : null,
    wave: flags.wave,
    cites: cites.length ? cites : undefined,
  };
}

// ── discover (D1: off-goal capture) ─────────────────────────────────────────────

export function cmdDiscover(dir: string, rest: string[], now: string): number {
  const { pos, flags, workers, cites } = parseArgs(rest);
  const observation = pos[0];
  if (!observation) {
    err('usage: fr discover "<observation>" --question "<falsifier / why it matters>" [--artifact <ref> --class <c> --tier <t>] [--cites <ref>]...');
    return 1;
  }
  if (!isActive(dir)) {
    err("no .frontier/ here — run `fr init \"<goal>\"`.");
    return 1;
  }
  const log = readLog(dir);
  const rec = buildDiscovery(observation, flags, workers, cites, log, now);
  const result = validateDiscover(rec);
  if (!result.ok) {
    err(result.error ?? "rejected");
    return 1;
  }
  appendLog(dir, rec);
  out(`discovery ⟡ logged${rec.evidence?.artifact ? `  (${rec.evidence.artifact})` : ""} — parked off-goal`);
  return 0;
}

/** An off-arm, off-frontier discovery record (arm:null, no decision). prd-discovery §4.1/§5. */
function buildDiscovery(
  observation: string,
  flags: Record<string, string>,
  workers: string[],
  cites: string[],
  log: LogRecord[],
  now: string,
): LogRecord {
  const cycle = log.reduce((m, r) => Math.max(m, r.cycle), 0) + 1;

  let evidence: Evidence | null = null;
  if (flags.artifact || flags.class || flags.tier) {
    evidence = {
      class: (flags.class as Evidence["class"]) ?? "stated",
      tier: (flags.tier as Evidence["tier"]) ?? "T2",
      artifact: flags.artifact ?? null,
      verdict: "claimed", // a discovery is stated/claimed until externally checked (prd-discovery §4.1)
    };
  }
  const parsedWorkers: Worker[] = workers.map((w) => {
    const [model, role] = w.split(":");
    return { model: model ?? w, role: role ?? "worker" };
  });

  return {
    ts: now,
    cycle,
    arm: null, // OFF-ARM — neutral to every breaker (prd-discovery §4.2)
    target: null,
    outcome: "discovery",
    at: null,
    note: observation,
    question: flags.question ?? "",
    evidence,
    workers: parsedWorkers,
    p_true: flags["p-true"] !== undefined ? Number(flags["p-true"]) : null,
    p_audit: null,
    decision: null, // a discovery is not a turn-ending decision
    frontier_after: null,
    supersedes: null,
    wave: flags.wave,
    cites: cites.length ? cites : undefined,
  };
}

// ── orient (no-wave turn marker) ────────────────────────────────────────────────

export function cmdOrient(dir: string, rest: string[], now: string): number {
  const { pos } = parseArgs(rest);
  const reason = pos[0];
  if (!reason) {
    err('usage: fr orient "<why this turn ran no wave>"  (orientation / planning / answering the user)');
    return 1;
  }
  if (!isActive(dir)) {
    err("no .frontier/ here — run `fr init \"<goal>\"`.");
    return 1;
  }
  const log = readLog(dir);
  const rec = buildOrient(reason, log, now);
  const result = validateOrient(rec);
  if (!result.ok) {
    err(result.error ?? "rejected");
    return 1;
  }
  appendLog(dir, rec);
  out("orient · logged — no-wave turn recorded (off-arm, not a pull)");
  return 0;
}

/** An off-arm, off-frontier no-wave marker (arm:null, no decision) — satisfies G1, never a pull. PRD §4.2. */
function buildOrient(reason: string, log: LogRecord[], now: string): LogRecord {
  return {
    ts: now,
    cycle: log.reduce((m, r) => Math.max(m, r.cycle), 0) + 1,
    arm: null, // OFF-ARM — neutral to every breaker; not counted in any arm's pulls
    target: null,
    outcome: "orient",
    at: null,
    note: reason,
    evidence: null,
    workers: [],
    p_true: null,
    p_audit: null,
    decision: null, // a no-wave turn ends on no decision (G4 does not apply)
    frontier_after: null,
    supersedes: null,
  };
}

// ── fork (D3: promote a discovery into a NEW campaign) ──────────────────────────

export function cmdFork(dir: string, rest: string[], now: string): number {
  const { pos, flags } = parseArgs(rest);
  const cycleArg = pos[0];
  if (!cycleArg) {
    err('usage: fr fork <cycle> --goal "<new goal>" --frontier "<new open>" [--dest <path>] [--first-arm <id>:"<desc>"]');
    return 1;
  }
  if (!isActive(dir)) {
    err("no .frontier/ here — run `fr init \"<goal>\"`.");
    return 1;
  }
  const cycle = Number(cycleArg);
  const p = readPortfolio(dir);
  const log = readLog(dir);
  const state = derive(p, log, liveVerdicts(dir));
  const disc = state.discoveries.find((d) => d.cycle === cycle);
  const goal = flags.goal ?? "";
  const frontier = flags.frontier ?? "";

  // GF — fork eligibility (pure). prd-discovery §4.5 / §12 Decision A.
  const elig = validateFork(disc, goal, frontier);
  if (!elig.ok) {
    err(elig.error ?? "rejected");
    return 1;
  }
  const d = disc!; // defined past the eligibility check

  // dest: explicit --dest (abs or project-relative), else a sibling dir from the goal slug.
  const projectRoot = path.dirname(dir);
  const dest = flags.dest
    ? path.isAbsolute(flags.dest)
      ? flags.dest
      : path.join(projectRoot, flags.dest)
    : path.join(path.dirname(projectRoot), slug(goal));
  const childFrontier = path.join(dest, ".frontier");
  if (fs.existsSync(childFrontier)) {
    err(`destination already has a .frontier/: ${childFrontier}. Pick another --dest.`);
    return 1;
  }

  // inherited dependencies — BY REFERENCE (the child re-banks via its own oracle). Snapshot, not a link.
  const discRec = log.find((r) => r.outcome === "discovery" && r.cycle === cycle);
  const inherits = [discRec?.evidence?.artifact ?? null, ...(discRec?.cites ?? [])].filter(
    (x): x is string => !!x,
  );

  // optional seed arm: --first-arm id:"<desc>"
  const arms: Portfolio["arms"] = [];
  if (flags["first-arm"]) {
    const idx = flags["first-arm"].indexOf(":");
    const id = idx >= 0 ? flags["first-arm"].slice(0, idx) : flags["first-arm"];
    const fdesc = idx >= 0 ? flags["first-arm"].slice(idx + 1) : "";
    arms.push({ id, desc: fdesc || d.observation, priority: "primary", target: frontier, kill: null, created: new Date(0).toISOString() });
  }

  const child: Portfolio = {
    goal,
    frontier,
    config: { ...p.config }, // copy the rig (oracles / thresholds)
    arms,
    forked_from: { repo: projectRoot, goal: p.goal, cycle, discovery: d.artifact ?? d.observation, inherits },
  };

  fs.mkdirSync(childFrontier, { recursive: true });
  writePortfolio(childFrontier, child); // fresh campaign; no log.jsonl until its first pull

  // parent: an INERT fork-marker (outcome discovery + fork_of, no decision) so the discovery
  // derives status "forked" — genealogy survives on BOTH sides, neither log mutates (L2).
  const marker: LogRecord = {
    ts: now,
    cycle: log.reduce((m, r) => Math.max(m, r.cycle), 0) + 1,
    arm: null,
    target: null,
    outcome: "discovery",
    at: null,
    note: `promoted → fork: ${dest}`,
    evidence: null,
    workers: [],
    decision: null,
    fork_of: cycle,
  };
  appendLog(dir, marker);

  out(`forked discovery #${cycle} → ${childFrontier}`);
  out(`next: open a NEW Claude Code session rooted at ${dest} — its own orchestrator. fr prepared the fork; it does not launch it.`);
  return 0;
}

/** A filesystem-safe slug of a goal string, for the default fork destination. */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "fork";
}

// ── graduate (forward seam: hand a survivor to vibefeld) ────────────────────────

export function cmdGraduate(dir: string, rest: string[], now: string): number {
  const { pos, flags } = parseArgs(rest);
  const cycleArg = pos[0];
  if (!cycleArg) {
    err('usage: fr graduate <cycle> --to "<vibefeld root ref>"');
    return 1;
  }
  if (!isActive(dir)) {
    err("no .frontier/ here — run `fr init \"<goal>\"`.");
    return 1;
  }
  const cycle = Number(cycleArg);
  const log = readLog(dir);
  const src = log.find((r) => r.cycle === cycle);
  const ref = flags.to ?? "";

  const result = validateGraduate(src, ref);
  if (!result.ok) {
    err(result.error ?? "rejected");
    return 1;
  }
  const s = src!; // defined past the gate
  const tier = s.evidence?.tier ?? null;
  const taint = tier === "T0" ? "clean" : "admitted";

  // An INERT forward marker (off-arm, no decision) so the graduation DERIVES without mutating the
  // log (L2). Like the fork-marker it is breaker-neutral and not a pull. seam-sketch §2.1.
  const marker: LogRecord = {
    ts: now,
    cycle: log.reduce((m, r) => Math.max(m, r.cycle), 0) + 1,
    arm: null,
    target: null,
    outcome: "graduate",
    at: null,
    note: `graduated #${cycle} → ${ref}`,
    evidence: null,
    workers: [],
    decision: null,
    graduates: cycle,
    graduated_to: ref,
  };
  appendLog(dir, marker);

  // Print the GraduationToken the operator seeds vibefeld with (`af init`). fr PREPARES the
  // hand-off; it does not run vibefeld.
  out(`graduated #${cycle} ↟ ${ref}`);
  out(`  statement : ${s.note}`);
  out(`  provenance: arm ${s.arm ?? "—"} · ${s.evidence?.class ?? "stated"}/${tier ?? "—"} · cycle ${cycle}`);
  out(
    taint === "clean"
      ? "  enter vibefeld as: a clean leaf (T0 proof)"
      : "  enter vibefeld as: ADMITTED — introduces taint (not a T0 proof; vibefeld must discharge it)",
  );
  return 0;
}

// ── verify (the bank gate's only execution path) ───────────────────────────────

export function cmdVerify(dir: string, rest: string[], now: string): number {
  const { pos, flags } = parseArgs(rest);
  const claim = pos[0];
  const oracleName = flags.oracle;
  if (!claim || !oracleName) {
    err("usage: fr verify <claim> --oracle <name>");
    return 1;
  }
  const p = readPortfolio(dir);
  const oracle = (p.config.oracles ?? []).find((o) => o.name === oracleName);
  if (!oracle) {
    err(`unknown oracle '${oracleName}'. Register it under config.oracles in portfolio.json.`);
    return 1;
  }
  const text = claimText(dir, claim) ?? claim;
  const verdict = runOracle(claim, oracle, text, now);
  writeVerdict(dir, verdict);
  out(`verify ${claim} via ${oracleName}: ${verdict.result}`);
  return verdict.result === "error" ? 1 : 0;
}

// ── board / check / turn-begin / status ────────────────────────────────────────

export function cmdBoard(dir: string, rest: string[]): number {
  const hook = rest.includes("--hook"); // `board --hook prompt`
  if (!isActive(dir)) {
    if (hook) out(JSON.stringify(promptHook(""))); // inert: empty context
    else err("no .frontier/ here — run `fr init \"<goal>\"`.");
    return 0;
  }
  try {
    const p = readPortfolio(dir);
    const text = renderBoard(derive(p, readLog(dir), liveVerdicts(dir)));
    if (hook) out(JSON.stringify(promptHook(text)));
    else out(text);
  } catch (e) {
    // Fail-soft on the injection path (L3): a corrupt/unreadable .frontier/ must
    // NEVER leak a stack trace to stdout — that would break the UserPromptSubmit
    // hook's JSON. Warn to stderr; emit a valid fallback. (The Stop `check` stays
    // fail-CLOSED and still blocks on the same corruption.)
    const msg = e instanceof Error ? e.message : String(e);
    err(`frontier board failed: ${msg}`);
    if (hook) out(JSON.stringify(promptHook("frontier: scoreboard temporarily unreadable.")));
  }
  return 0;
}

export function cmdCheck(dir: string, rest: string[]): number {
  const hook = rest.includes("--hook"); // `check --hook stop`
  if (hook) {
    // ── FAIL-CLOSED hook path ──────────────────────────────────────────────
    if (!isActive(dir)) {
      out(JSON.stringify(stopPass())); // inert: {} exit 0
      return 0;
    }
    try {
      const p = readPortfolio(dir);
      const log = readLog(dir);
      const turn = readTurn(dir);
      const verdicts = liveVerdicts(dir);
      const res = check(derive(p, log, verdicts), turn, log, p, verdicts);
      if (res.status === "block") {
        writeTurn(dir, { ...turn, blocks_this_turn: turn.blocks_this_turn + 1 });
        out(JSON.stringify(stopBlock(res.reason ?? "blocked")));
      } else if (res.status === "soft") {
        out(JSON.stringify(stopSoft(res.reason ?? "")));
      } else {
        out(JSON.stringify(stopPass()));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out(JSON.stringify(stopBlock(`frontier check failed: ${msg}`)));
    }
    return 0;
  }
  // ── human (non-hook) path ──────────────────────────────────────────────────
  if (!isActive(dir)) {
    err("no .frontier/ here.");
    return 0;
  }
  const p = readPortfolio(dir);
  const log = readLog(dir);
  const verdicts = liveVerdicts(dir);
  const res = check(derive(p, log, verdicts), readTurn(dir), log, p, verdicts);
  out(`${res.status}${res.gate ? ` [${res.gate}]` : ""}${res.reason ? `: ${res.reason}` : ""}`);
  return res.status === "block" ? 1 : 0;
}

export function cmdTurnBegin(dir: string): number {
  if (!isActive(dir)) return 0; // inert
  try {
    writeTurn(dir, { log_len_at_turn_start: readLog(dir).length, blocks_this_turn: 0 });
  } catch (e) {
    // Fail-soft (L3): a corrupt log must not crash the `turn-begin && board` hook
    // chain. Warn to stderr, stamp a conservative turn.json (treat as "nothing
    // logged yet"); the Stop `check` stays fail-closed and blocks on the corruption.
    const msg = e instanceof Error ? e.message : String(e);
    err(`frontier turn-begin failed: ${msg}`);
    writeTurn(dir, { log_len_at_turn_start: 0, blocks_this_turn: 0 });
  }
  return 0; // always exit 0 (JSON-silent) so `&& board` still runs
}

export function cmdStatus(dir: string): number {
  if (!isActive(dir)) {
    out("no active .frontier/ — run `fr init \"<goal>\"`.");
    return 0;
  }
  const p = readPortfolio(dir);
  out(renderBoard(derive(p, readLog(dir), liveVerdicts(dir))));
  return 0;
}
