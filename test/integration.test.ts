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

// ── D1: discovery capture + ledger ───────────────────────────────────────────

describe("D1 discovery", () => {
  test("fr discover appends a ⟡ record with arm:null and The Question", () => {
    init();
    beginTurn();
    const res = fr("discover", "diagonal is row-stochastic", "--question", "what would falsify it", "--artifact", "obs/diag", "--class", "side", "--tier", "T1");
    expect(res.code).toBe(0);
    const rec = JSON.parse(fs.readFileSync(path.join(frontierDir, "log.jsonl"), "utf8").trim());
    expect(rec.outcome).toBe("discovery");
    expect(rec.arm).toBeNull();
    expect(rec.question).toBe("what would falsify it");
    expect(rec.evidence.artifact).toBe("obs/diag");
  });

  test("fr discover without --question is rejected at write time", () => {
    init();
    beginTurn();
    const res = fr("discover", "an observation");
    expect(res.code).toBe(1);
    expect(res.stderr.toLowerCase()).toContain("question");
    expect(fs.existsSync(path.join(frontierDir, "log.jsonl"))).toBe(false);
  });

  test("a discovery-only turn still BLOCKS at the Stop hook (G1 counts arm-pulls)", () => {
    init();
    beginTurn();
    fr("discover", "off-goal observation", "--question", "q");
    const out = JSON.parse(fr("check", "--hook", "stop").stdout);
    expect(out.decision).toBe("block");
  });

  test("a later pull citing a discovery raises its reuse on the board", () => {
    init();
    beginTurn();
    fr("discover", "useful lemma", "--question", "q", "--artifact", "obs/lem", "--class", "side", "--tier", "T1");
    fr("log", "A", "progress", "used the lemma", "--artifact", "p/a", "--class", "af", "--tier", "T0", "--cites", "obs/lem", "--decide", "EXPLOIT", "A");
    const board = fr("board").stdout;
    expect(board).toContain("DISCOVERIES");
    expect(board).toContain("useful lemma");
    expect(board).toContain("reuse×1");
  });
});

// ── orient: a no-wave turn satisfies the Stop hook without faking an arm-pull ──

describe("orient (no-wave turn)", () => {
  test("fr orient appends an off-arm marker and lets the Stop hook pass", () => {
    init();
    beginTurn();
    const res = fr("orient", "familiarising with the project");
    expect(res.code).toBe(0);
    const rec = JSON.parse(fs.readFileSync(path.join(frontierDir, "log.jsonl"), "utf8").trim());
    expect(rec.outcome).toBe("orient");
    expect(rec.arm).toBeNull();
    expect(rec.decision).toBeNull();
    const out = JSON.parse(fr("check", "--hook", "stop").stdout);
    expect(out.decision).toBeUndefined(); // pass → {} (no block)
  });

  test("fr orient with no reason is rejected at write time", () => {
    init();
    beginTurn();
    const res = fr("orient");
    expect(res.code).toBe(1);
    expect(fs.existsSync(path.join(frontierDir, "log.jsonl"))).toBe(false);
  });

  test("two orient turns add ZERO pulls to any arm and never trip the breaker", () => {
    init();
    beginTurn();
    fr("orient", "reading docs");
    expect(JSON.parse(fr("check", "--hook", "stop").stdout).decision).toBeUndefined();
    beginTurn();
    fr("orient", "still reading");
    expect(JSON.parse(fr("check", "--hook", "stop").stdout).decision).toBeUndefined();
    // arm A was never funded — the board must still show it untried (??), not stalled.
    const board = fr("board").stdout;
    expect(board).toContain("A exploratory  untried ??");
    expect(board).toContain("NO-WAVE TURNS: ×2");
  });
});

// ── D2: promote-to-arm ───────────────────────────────────────────────────────

describe("D2 promote-to-arm", () => {
  test("fr arm add --from-discovery seeds a new arm and promotes the discovery off the parked tail", () => {
    init();
    beginTurn();
    fr("discover", "a reusable lemma", "--question", "q", "--artifact", "obs/lem", "--class", "side", "--tier", "T1");
    const add = fr("arm", "add", "P", "--from-discovery", "1");
    expect(add.code).toBe(0);
    const p = JSON.parse(fs.readFileSync(path.join(frontierDir, "portfolio.json"), "utf8"));
    const armP = p.arms.find((a: { id: string }) => a.id === "P");
    expect(armP).toBeDefined();
    expect(armP.from_discovery).toBe(1);
    expect(armP.desc).toContain("reusable lemma"); // desc seeded from the observation
    const board = fr("board").stdout;
    expect(board).toContain("P"); // the new arm is present
    expect(board).not.toContain("DISCOVERIES"); // promoted → no longer parked
  });

  test("fr arm add --from-discovery on a nonexistent cycle is rejected", () => {
    init();
    const add = fr("arm", "add", "P", "--from-discovery", "99");
    expect(add.code).toBe(1);
    expect(add.stderr.toLowerCase()).toContain("discovery");
  });
});

// ── D3: fork-to-goal ─────────────────────────────────────────────────────────

describe("D3 fork", () => {
  test("an ineligible discovery (low reuse, no learning-progress) cannot be forked", () => {
    init();
    beginTurn();
    fr("discover", "an early idea", "--question", "q", "--artifact", "obs/x");
    const res = fr("fork", "1", "--goal", "a new goal", "--frontier", "(NG) one open", "--dest", path.join(projDir, "child"));
    expect(res.code).toBe(1);
    expect(res.stderr.toLowerCase()).toMatch(/reuse|eligible|learning/);
    expect(fs.existsSync(path.join(projDir, "child", ".frontier"))).toBe(false);
  });

  test("an eligible discovery forks: scaffolds a child .frontier/ with provenance, drops off the parent board", () => {
    init();
    beginTurn();
    fr("discover", "a load-bearing lemma", "--question", "q", "--artifact", "obs/lem", "--class", "side", "--tier", "T1");
    // reuse across two distinct arms → reuse 2 → fork-eligible (Decision A)
    fr("log", "A", "died", "used it", "--at", "R1", "--cites", "obs/lem", "--decide", "EXPLOIT", "A");
    fr("log", "B", "died", "used it too", "--at", "R2", "--cites", "obs/lem", "--decide", "EXPLOIT", "B");

    const dest = path.join(projDir, "child-fork");
    const res = fr("fork", "1", "--goal", "classify stochastic-diagonal idempotents", "--frontier", "(SD) one classification", "--dest", dest);
    expect(res.code).toBe(0);

    const childPortfolioPath = path.join(dest, ".frontier", "portfolio.json");
    expect(fs.existsSync(childPortfolioPath)).toBe(true);
    const cp = JSON.parse(fs.readFileSync(childPortfolioPath, "utf8"));
    expect(cp.goal).toBe("classify stochastic-diagonal idempotents");
    expect(cp.frontier).toBe("(SD) one classification");
    expect(cp.forked_from.cycle).toBe(1);
    expect(cp.forked_from.goal).toBe("prove the conjecture");
    expect(cp.arms).toEqual([]); // fresh portfolio (no --first-arm given)
    // child has a FRESH log (the parent's records did not leak in)
    expect(fs.existsSync(path.join(dest, ".frontier", "log.jsonl"))).toBe(false);

    // parent: the discovery is now FORKED → no longer in the parked DISCOVERIES tail
    const board = fr("board").stdout;
    expect(board).not.toContain("a load-bearing lemma");
  });
});

// ── forward seam: fr graduate hands a survivor to vibefeld ────────────────────
describe("forward seam: fr graduate", () => {
  test("graduates a died-at residual, surfaces it on the board, rejects a bad cycle", () => {
    init();
    beginTurn();
    fr("log", "A", "died", "reduces to witness positivity", "--at", "witness positivity remains", "--decide", "EXPLORE", "B");
    const g = fr("graduate", "1", "--to", "af:root-1");
    expect(g.code).toBe(0);
    expect(g.stdout).toContain("graduated #1");
    expect(g.stdout).toContain("↟");

    const board = fr("board").stdout;
    expect(board).toContain("GRADUATED → vibefeld: ×1");
    expect(board).toContain("admitted 1"); // a died-at residual is non-T0 → admitted

    const bad = fr("graduate", "99", "--to", "af:x");
    expect(bad.code).toBe(1);
  });
});
