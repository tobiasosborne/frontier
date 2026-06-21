import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveFrontierDir,
  isActive,
  readPortfolio,
  writePortfolio,
  readLog,
  appendLog,
  readTurn,
  writeTurn,
  readVerdicts,
  writeVerdict,
} from "../src/store.ts";
import type { Portfolio, LogRecord, TurnState, Verdict } from "../src/types.ts";

// ── temp-dir helpers ─────────────────────────────────────────────────────────
const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fr-store-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

// ── fixtures ─────────────────────────────────────────────────────────────────
function samplePortfolio(): Portfolio {
  return {
    goal: "prove the conjecture",
    frontier: "(EX) one inequality",
    config: { stale_threshold: 2, max_blocks_per_turn: 2 },
    arms: [
      {
        id: "A",
        desc: "quasi-FF criteria",
        priority: "primary",
        target: "(EX)",
        kill: "multipliers blow up",
        created: "2026-06-21T10:00:00Z",
      },
    ],
  };
}

function sampleRecord(cycle: number): LogRecord {
  return {
    ts: "2026-06-21T10:42:00Z",
    cycle,
    wave: `w${cycle}`,
    arm: "A",
    target: "(EX)",
    outcome: "died",
    at: "loose bound",
    note: "selection proven irreducible",
    evidence: null,
    workers: [{ model: "opus", role: "prover" }],
    p_true: 0.48,
    p_audit: 0.3,
    decision: { type: "EXPLOIT", arm: "A" },
  };
}

// ── resolveFrontierDir ───────────────────────────────────────────────────────
describe("resolveFrontierDir", () => {
  test("honours $CLAUDE_PROJECT_DIR first", () => {
    const root = mkTmp();
    const got = resolveFrontierDir({ CLAUDE_PROJECT_DIR: root }, "/some/other/cwd");
    expect(got).toBe(path.join(root, ".frontier"));
  });

  test("walks up from cwd to find an existing .frontier/", () => {
    const root = mkTmp();
    const frontier = path.join(root, ".frontier");
    fs.mkdirSync(frontier);
    const deep = path.join(root, "a", "b", "c");
    fs.mkdirSync(deep, { recursive: true });
    const got = resolveFrontierDir({}, deep);
    expect(got).toBe(frontier);
  });

  test("falls back to <cwd>/.frontier when none found", () => {
    const root = mkTmp(); // no .frontier inside
    const got = resolveFrontierDir({}, root);
    expect(got).toBe(path.join(root, ".frontier"));
  });

  test("env wins even when a cwd-walk would also find one", () => {
    const envRoot = mkTmp();
    const cwdRoot = mkTmp();
    fs.mkdirSync(path.join(cwdRoot, ".frontier"));
    const got = resolveFrontierDir({ CLAUDE_PROJECT_DIR: envRoot }, cwdRoot);
    expect(got).toBe(path.join(envRoot, ".frontier"));
  });
});

// ── isActive ─────────────────────────────────────────────────────────────────
describe("isActive", () => {
  test("false when portfolio.json absent", () => {
    const dir = path.join(mkTmp(), ".frontier");
    fs.mkdirSync(dir);
    expect(isActive(dir)).toBe(false);
  });

  test("true once portfolio.json is written", () => {
    const dir = path.join(mkTmp(), ".frontier");
    writePortfolio(dir, samplePortfolio());
    expect(isActive(dir)).toBe(true);
  });
});

// ── portfolio round-trip ─────────────────────────────────────────────────────
describe("portfolio round-trip", () => {
  test("write then read is identity, and is pretty-printed", () => {
    const dir = path.join(mkTmp(), ".frontier");
    const p = samplePortfolio();
    writePortfolio(dir, p);
    expect(readPortfolio(dir)).toEqual(p);
    const raw = fs.readFileSync(path.join(dir, "portfolio.json"), "utf8");
    expect(raw).toContain("\n"); // pretty (multi-line)
    expect(raw).toContain("  "); // indented
  });
});

// ── log round-trip + append-only ─────────────────────────────────────────────
describe("log", () => {
  test("readLog is [] when absent", () => {
    const dir = path.join(mkTmp(), ".frontier");
    fs.mkdirSync(dir);
    expect(readLog(dir)).toEqual([]);
  });

  test("append-only: each append grows the log by exactly one, one object per line", () => {
    const dir = path.join(mkTmp(), ".frontier");
    fs.mkdirSync(dir);
    appendLog(dir, sampleRecord(1));
    expect(readLog(dir).length).toBe(1);
    appendLog(dir, sampleRecord(2));
    const after = readLog(dir);
    expect(after.length).toBe(2);
    expect(after[0]!.cycle).toBe(1);
    expect(after[1]!.cycle).toBe(2);
    // earlier line is byte-preserved (append-only, not rewritten)
    const lines = fs
      .readFileSync(path.join(dir, "log.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).cycle).toBe(1);
  });

  test("round-trips a full record losslessly", () => {
    const dir = path.join(mkTmp(), ".frontier");
    fs.mkdirSync(dir);
    const rec = sampleRecord(7);
    appendLog(dir, rec);
    expect(readLog(dir)[0]).toEqual(rec);
  });
});

// ── turn round-trip ──────────────────────────────────────────────────────────
describe("turn", () => {
  test("readTurn default when absent", () => {
    const dir = path.join(mkTmp(), ".frontier");
    fs.mkdirSync(dir);
    expect(readTurn(dir)).toEqual({ log_len_at_turn_start: 0, blocks_this_turn: 0 });
  });

  test("write then read is identity", () => {
    const dir = path.join(mkTmp(), ".frontier");
    fs.mkdirSync(dir);
    const t: TurnState = { log_len_at_turn_start: 36, blocks_this_turn: 1 };
    writeTurn(dir, t);
    expect(readTurn(dir)).toEqual(t);
  });
});

// ── verdicts round-trip ──────────────────────────────────────────────────────
describe("verdicts", () => {
  function sampleVerdict(claim: string, oracle: string): Verdict {
    return {
      claim,
      oracle,
      result: "pass",
      claim_hash: "abc",
      oracle_digest: "def",
      inputs_hash: "",
      ts: "2026-06-21T11:00:00Z",
    };
  }

  test("readVerdicts is [] when verdicts/ absent", () => {
    const dir = path.join(mkTmp(), ".frontier");
    fs.mkdirSync(dir);
    expect(readVerdicts(dir)).toEqual([]);
  });

  test("write then read round-trips a verdict", () => {
    const dir = path.join(mkTmp(), ".frontier");
    fs.mkdirSync(dir);
    const v = sampleVerdict("proofs/lem-x", "af");
    writeVerdict(dir, v);
    const got = readVerdicts(dir);
    expect(got.length).toBe(1);
    expect(got[0]).toEqual(v);
  });

  test("writeVerdict slugifies claim into the filename <claim-slug>.<oracle>.json", () => {
    const dir = path.join(mkTmp(), ".frontier");
    fs.mkdirSync(dir);
    writeVerdict(dir, sampleVerdict("proofs/lem-x", "af"));
    const files = fs.readdirSync(path.join(dir, "verdicts"));
    expect(files.length).toBe(1);
    // slug must contain no path separators and end with .<oracle>.json
    const f = files[0]!;
    expect(f).not.toContain("/");
    expect(f.endsWith(".af.json")).toBe(true);
  });

  test("two verdicts with distinct claim/oracle keys coexist", () => {
    const dir = path.join(mkTmp(), ".frontier");
    fs.mkdirSync(dir);
    writeVerdict(dir, sampleVerdict("proofs/lem-x", "af"));
    writeVerdict(dir, sampleVerdict("proofs/lem-y", "lean"));
    expect(readVerdicts(dir).length).toBe(2);
  });
});
