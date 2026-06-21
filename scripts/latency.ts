/**
 * latency.ts — the cold-start latency GATE for the hook path (PRD §11 / §14 #9).
 *
 * Builds the standalone binary, then times `fr board --hook prompt` and `fr check --hook stop`
 * cold starts (best of N runs) against a temp `.frontier/`. The hooks fire on every prompt and
 * every stop, so a slow binary stalls the host session. EXIT NON-ZERO if either exceeds 50 ms —
 * this is a real gate, not a report.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const BUDGET_MS = 50;
const RUNS = 5;

function build(): string {
  const outfile = path.resolve(import.meta.dir, "../dist/fr");
  const proc = Bun.spawnSync(
    ["bun", "build", path.resolve(import.meta.dir, "../src/index.ts"), "--compile", "--outfile", outfile],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (!proc.success) {
    console.error("build failed");
    process.exit(2);
  }
  return outfile;
}

/** Seed a minimal but non-trivial .frontier/ so derive/check do real work. */
function seedFrontier(): string {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "fr-latency-"));
  const dir = path.join(proj, ".frontier");
  fs.mkdirSync(dir, { recursive: true });
  const portfolio = {
    goal: "prove the conjecture",
    frontier: "(EX) one inequality",
    config: { stale_threshold: 2, max_blocks_per_turn: 2, oracles: [] },
    arms: [
      { id: "A", desc: "smearing", priority: "primary", target: "(EX)", kill: null, created: "1970-01-01T00:00:00Z" },
      { id: "B", desc: "numerics", priority: "exploratory", target: null, kill: null, created: "1970-01-01T00:00:00Z" },
    ],
  };
  fs.writeFileSync(path.join(dir, "portfolio.json"), JSON.stringify(portfolio, null, 2));
  const recs = Array.from({ length: 8 }, (_, i) => ({
    ts: "2026-06-21T10:00:00Z",
    cycle: i + 1,
    wave: `w${i + 1}`,
    arm: "A",
    target: "(EX)",
    outcome: "died",
    at: `residual-${i}`,
    note: "a dead wall",
    evidence: null,
    workers: [{ model: "opus", role: "prover" }],
    p_true: 0.4,
    p_audit: 0.2,
    decision: { type: "EXPLOIT", arm: "A" },
  }));
  fs.writeFileSync(path.join(dir, "log.jsonl"), recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(
    path.join(dir, "turn.json"),
    JSON.stringify({ log_len_at_turn_start: 8, blocks_this_turn: 0 }, null, 2),
  );
  return proj;
}

/** Best (minimum) cold-start wall time in ms over RUNS invocations. */
function timeBest(bin: string, proj: string, args: string[]): number {
  let best = Infinity;
  for (let i = 0; i < RUNS; i++) {
    const t0 = Bun.nanoseconds();
    const proc = Bun.spawnSync([bin, ...args], {
      cwd: proj,
      env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
      stdout: "ignore",
      stderr: "ignore",
    });
    const ms = (Bun.nanoseconds() - t0) / 1e6;
    if (!proc.success && args[0] === "board") {
      console.error(`board run failed (exit ${proc.exitCode})`);
      process.exit(2);
    }
    if (ms < best) best = ms;
  }
  return best;
}

const bin = build();
const proj = seedFrontier();
try {
  const board = timeBest(bin, proj, ["board", "--hook", "prompt"]);
  const checkMs = timeBest(bin, proj, ["check", "--hook", "stop"]);

  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  console.log(`cold-start (best of ${RUNS}):`);
  console.log(`  board --hook prompt : ${fmt(board)}  (budget ${BUDGET_MS} ms)`);
  console.log(`  check --hook stop   : ${fmt(checkMs)}  (budget ${BUDGET_MS} ms)`);

  const over: string[] = [];
  if (board > BUDGET_MS) over.push(`board ${fmt(board)}`);
  if (checkMs > BUDGET_MS) over.push(`check ${fmt(checkMs)}`);
  if (over.length > 0) {
    console.error(`LATENCY GATE FAILED: ${over.join("; ")} exceeds the ${BUDGET_MS} ms budget.`);
    process.exit(1);
  }
  console.log(`OK — both within the ${BUDGET_MS} ms hook-path budget.`);
} finally {
  try {
    fs.rmSync(proj, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
