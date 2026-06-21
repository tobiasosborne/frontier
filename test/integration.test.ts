/**
 * integration.test.ts — the PRD §14 unit smoke-test (1–8), end-to-end through the real CLI.
 *
 * Each case spawns the compiled-from-source CLI (`bun run src/index.ts …`) against a FRESH temp
 * `.frontier/` (via $CLAUDE_PROJECT_DIR), exactly as the deployed binary runs under the hooks.
 * We assert on exit codes, stdout JSON (hook paths are JSON-only), and stderr diagnostics.
 *
 * Corrected breaker reconciliation (the load-bearing semantics):
 *  - §14 #2: two `died` pulls with NO frontier reduction trip G3; a `died` carrying
 *    `--frontier "<reduced>"` RESETS the breaker (check passes); a mere residual rename does NOT.
 *  - §14 #5: `banked` without a passing verdict → blocked; after `fr verify` passes → accepted;
 *    mutating the bound claim content → verdict stale → banked re-blocks.
 *  - §14 #7: loop guard (3rd block in a turn → soft/exit-0); fail-closed (corrupt log → block;
 *    absent `.frontier/` → `{}`).
 *  - §14 #8: `fr board` shows `??` for an untried arm + the dead-routes tail.
 */
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SRC = path.resolve(import.meta.dir, "../src/index.ts");

let projDir: string; // the fake project root; .frontier/ lives inside
let frontierDir: string;

beforeEach(() => {
  projDir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-int-"));
  frontierDir = path.join(projDir, ".frontier");
});
afterEach(() => {
  try {
    fs.rmSync(projDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the CLI with $CLAUDE_PROJECT_DIR pointed at the temp project. */
function fr(...args: string[]): RunResult {
  const proc = Bun.spawnSync(["bun", "run", SRC, ...args], {
    cwd: projDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projDir },
  });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

/** turn-begin then board re-stamp, so the next `check` diffs against a clean turn start. */
function beginTurn(): void {
  fr("turn-begin");
}

function init(): void {
  fr("init", "prove the conjecture");
  fr("arm", "add", "A", "smearing", "--target", "T1");
  fr("arm", "add", "B", "numerics");
}

// ── §14 #1: init + arm add scaffolds the portfolio ───────────────────────────

describe("§14 #1 init + arm add", () => {
  test("creates .frontier/portfolio.json with the goal and two arms", () => {
    init();
    expect(fs.existsSync(path.join(frontierDir, "portfolio.json"))).toBe(true);
    const p = JSON.parse(fs.readFileSync(path.join(frontierDir, "portfolio.json"), "utf8"));
    expect(p.goal).toBe("prove the conjecture");
    expect(p.arms.map((a: { id: string }) => a.id).sort()).toEqual(["A", "B"]);
  });
});

// ── §14 #2: the breaker reconciliation (the corrected semantics) ─────────────

describe("§14 #2 breaker: trips on stall, resets on frontier reduction", () => {
  test("two died pulls (no frontier reduction) + same-arm EXPLOIT → check blocks G3", () => {
    init();
    beginTurn();
    fr("log", "A", "died", "first wall", "--at", "R1", "--decide", "EXPLOIT", "A");
    fr("log", "A", "died", "same wall again", "--at", "R1", "--decide", "EXPLOIT", "A");
    const res = fr("check", "--hook", "stop");
    expect(res.code).toBe(0); // hook always exits 0
    const out = JSON.parse(res.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("EXPLORE");
  });

  test("a mere residual RENAME does NOT reset the breaker (still blocks)", () => {
    init();
    beginTurn();
    fr("log", "A", "died", "wall", "--at", "R1", "--decide", "EXPLOIT", "A");
    fr("log", "A", "died", "renamed wall", "--at", "R2-paraphrased", "--decide", "EXPLOIT", "A");
    const out = JSON.parse(fr("check", "--hook", "stop").stdout);
    expect(out.decision).toBe("block");
  });

  test("a died carrying --frontier <reduced> RESETS the breaker → check passes", () => {
    init();
    beginTurn();
    fr("log", "A", "died", "wall", "--at", "R1", "--decide", "EXPLOIT", "A");
    // This death reduces the FRONTIER → stale resets → breaker not tripped.
    fr("log", "A", "died", "wall, but open reduced", "--at", "R1", "--frontier", "(EX) reduced open", "--decide", "EXPLOIT", "A");
    const out = JSON.parse(fr("check", "--hook", "stop").stdout);
    expect(out.decision).toBeUndefined(); // pass → {} (no block)
    // the reduction is the log's frontier_after; the DERIVED current open (L2 — trail's last
    // entry, not p.frontier, which derive treats as the staleness baseline) reflects it.
    const board = fr("board").stdout;
    expect(board).toContain("(EX) reduced open");
  });
});

// ── §14 #3: a died that EXPLOREs a different arm passes ───────────────────────

describe("§14 #3 died + EXPLORE-different passes", () => {
  test("stalled arm A, decide EXPLORE B → check passes", () => {
    init();
    beginTurn();
    fr("log", "A", "died", "w", "--at", "R1", "--decide", "EXPLOIT", "A");
    fr("log", "A", "died", "w", "--at", "R1", "--decide", "EXPLOIT", "A"); // now stalled
    beginTurn();
    const log = fr("log", "A", "died", "loose bound", "--at", "R1", "--decide", "EXPLORE", "B");
    expect(log.code).toBe(0); // write-time validation accepts the escape
    const out = JSON.parse(fr("check", "--hook", "stop").stdout);
    expect(out.decision).toBeUndefined();
  });
});

// ── §14 #4: progress needs an artifact (write-time G2) ───────────────────────

describe("§14 #4 progress needs an artifact", () => {
  test("progress without --artifact is rejected at write time (stderr, exit 1)", () => {
    init();
    beginTurn();
    const res = fr("log", "A", "progress", "a numeric hit", "--decide", "EXPLOIT", "A");
    expect(res.code).toBe(1);
    expect(res.stderr.toLowerCase()).toContain("artifact");
    expect(res.stdout.trim()).toBe(""); // nothing on stdout for a rejected log
    // nothing was appended
    expect(fs.existsSync(path.join(frontierDir, "log.jsonl"))).toBe(false);
  });

  test("progress WITH --artifact/--class/--tier is accepted as △", () => {
    init();
    beginTurn();
    const res = fr("log", "A", "progress", "a real lemma", "--artifact", "proofs/lem-x", "--class", "af", "--tier", "T0", "--decide", "EXPLOIT", "A");
    expect(res.code).toBe(0);
    const log = fs.readFileSync(path.join(frontierDir, "log.jsonl"), "utf8").trim();
    const rec = JSON.parse(log);
    expect(rec.outcome).toBe("progress");
    expect(rec.evidence.artifact).toBe("proofs/lem-x");
    expect(rec.evidence.tier).toBe("T0");
  });
});

// ── §14 #5: banked needs a verdict; mutate-claim → stale → re-blocks ──────────

describe("§14 #5 banked needs a passing non-stale verdict", () => {
  function writeArtifact(rel: string, content: string): string {
    const abs = path.join(projDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
  }

  test("banked with no verdict is rejected at write time (G2b)", () => {
    init();
    writeArtifact("proofs/lem-x", "theorem statement v1");
    beginTurn();
    const res = fr("log", "A", "banked", "main thm", "--artifact", "proofs/lem-x", "--decide", "EXPLOIT", "A");
    expect(res.code).toBe(1);
    expect(res.stderr.toLowerCase()).toMatch(/verify|verdict|banked/);
  });

  test("after a passing fr verify, banked is accepted (△→▣); mutating the claim re-blocks", () => {
    init();
    // register a trivially-passing oracle in the portfolio config
    const p = JSON.parse(fs.readFileSync(path.join(frontierDir, "portfolio.json"), "utf8"));
    p.config.oracles = [{ name: "af", cmd: ["true"] }];
    fs.writeFileSync(path.join(frontierDir, "portfolio.json"), JSON.stringify(p, null, 2));

    writeArtifact("proofs/lem-x", "theorem statement v1");
    const verify = fr("verify", "proofs/lem-x", "--oracle", "af");
    expect(verify.code).toBe(0);
    expect(verify.stdout.toLowerCase()).toContain("pass");
    // verdict persisted
    expect(fs.readdirSync(path.join(frontierDir, "verdicts")).length).toBe(1);

    // now banked is accepted at write time AND at check time
    beginTurn();
    const banked = fr("log", "A", "banked", "main thm", "--artifact", "proofs/lem-x", "--decide", "EXPLOIT", "A");
    expect(banked.code).toBe(0);
    const checkOk = JSON.parse(fr("check", "--hook", "stop").stdout);
    expect(checkOk.decision).toBeUndefined();

    // MUTATE the bound claim content → the verdict's claim_hash no longer matches → stale.
    writeArtifact("proofs/lem-x", "theorem statement v2 — MUTATED");
    const checkStale = JSON.parse(fr("check", "--hook", "stop").stdout);
    expect(checkStale.decision).toBe("block"); // G2b re-blocks: verdict is stale
  });
});

// ── §14 #6: refuted self-tagging banked → anti-laundering reject ──────────────

describe("§14 #6 anti-laundering", () => {
  test("a refuted record that self-tags verdict=banked is rejected at write time", () => {
    init();
    beginTurn();
    const res = fr("log", "A", "refuted", "counterexample", "--artifact", "cex/x", "--verdict", "banked", "--decide", "EXPLOIT", "A");
    expect(res.code).toBe(1);
    expect(res.stderr.toLowerCase()).toMatch(/launder|banked|refuted/);
  });
});

// ── §14 #7: loop guard + fail-closed ─────────────────────────────────────────

describe("§14 #7 loop guard + fail-closed", () => {
  test("the 3rd block in a turn becomes a soft additionalContext (exit 0, no block)", () => {
    init();
    beginTurn(); // turn started with empty log; nothing logged this turn → G1 blocks
    // block #1
    const b1 = JSON.parse(fr("check", "--hook", "stop").stdout);
    expect(b1.decision).toBe("block");
    // block #2
    const b2 = JSON.parse(fr("check", "--hook", "stop").stdout);
    expect(b2.decision).toBe("block");
    // block #3 → loop guard: soft, no decision
    const b3 = JSON.parse(fr("check", "--hook", "stop").stdout);
    expect(b3.decision).toBeUndefined();
    expect(b3.hookSpecificOutput?.hookEventName).toBe("Stop");
    expect(b3.hookSpecificOutput?.additionalContext).toBeDefined();
  });

  test("fail-closed: a corrupt log.jsonl makes check BLOCK (active .frontier/)", () => {
    init();
    fs.writeFileSync(path.join(frontierDir, "log.jsonl"), "{ this is not valid json\n");
    const res = fr("check", "--hook", "stop");
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason.toLowerCase()).toContain("frontier check failed");
  });

  test("inert: absent .frontier/ → check prints {} and exits 0", () => {
    // no init — .frontier/ does not exist
    const res = fr("check", "--hook", "stop");
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({});
  });
});

// ── §14 #8: board renders ?? for untried + the dead-routes tail ───────────────

describe("§14 #8 board: ?? untried + dead routes", () => {
  test("fr board shows the untried arm as ?? and lists a dead route", () => {
    init();
    beginTurn();
    fr("log", "A", "died", "a dead wall", "--at", "coefficient-only LP", "--decide", "EXPLORE", "B");
    const res = fr("board");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("??"); // arm B is untried
    expect(res.stdout).toContain("DEAD ROUTES");
    expect(res.stdout).toContain("coefficient-only LP");
  });

  test("board --hook prompt prints ONLY the UserPromptSubmit JSON to stdout", () => {
    init();
    const res = fr("board", "--hook", "prompt");
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout); // parses cleanly → no stray stdout bytes
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(out.hookSpecificOutput.additionalContext).toContain("FRONTIER");
  });
});
