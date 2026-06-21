/**
 * oracle.test.ts — tests for the verify edge (Pillar C).
 *
 * `runOracle` spawns a registered command (argv, NO shell) with the claim text on stdin;
 * exit 0 → pass, non-zero → fail, spawn error → error. It hashes claim/oracle/inputs so a
 * verdict goes STALE when any of them change. `isStale` recomputes claim_hash and compares.
 * `currentVerdicts` filters to the non-stale verdicts (staleness resolved at the EDGE, so
 * the pure core's "presence === current" invariant holds — IMPL_PLAN §2 oracle.ts).
 */
import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runOracle, isStale, currentVerdicts } from "../src/oracle";
import type { OracleConfig, Verdict } from "../src/types";

const NOW = "2026-06-21T12:00:00Z";

const tmp: string[] = [];
function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fr-oracle-"));
  tmp.push(d);
  return d;
}
afterEach(() => {
  while (tmp.length) {
    try {
      fs.rmSync(tmp.pop()!, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

// ── runOracle exit-code → result mapping ─────────────────────────────────────

describe("runOracle", () => {
  test("exit 0 → pass", () => {
    const oracle: OracleConfig = { name: "ok", cmd: ["true"] };
    const v = runOracle("proofs/lem-x", oracle, "claim text", NOW);
    expect(v.result).toBe("pass");
    expect(v.claim).toBe("proofs/lem-x");
    expect(v.oracle).toBe("ok");
    expect(v.ts).toBe(NOW);
  });

  test("non-zero exit → fail", () => {
    const oracle: OracleConfig = { name: "no", cmd: ["false"] };
    expect(runOracle("proofs/lem-x", oracle, "claim text", NOW).result).toBe("fail");
  });

  test("spawn error (no such binary) → error", () => {
    const oracle: OracleConfig = { name: "missing", cmd: ["this-binary-does-not-exist-xyz"] };
    expect(runOracle("proofs/lem-x", oracle, "claim text", NOW).result).toBe("error");
  });

  test("claimText is delivered on stdin (oracle can read it)", () => {
    // grep -q reads stdin, exits 0 iff the pattern is found.
    const oracle: OracleConfig = { name: "grep", cmd: ["grep", "-q", "MAGIC"] };
    expect(runOracle("c", oracle, "before MAGIC after", NOW).result).toBe("pass");
    expect(runOracle("c", oracle, "no needle here", NOW).result).toBe("fail");
  });

  test("argv is run with NO shell — metacharacters are literal", () => {
    // If a shell were involved, `;` would chain `true`. With argv, grep gets ";" as a literal arg.
    const oracle: OracleConfig = { name: "g", cmd: ["grep", "-q", ";true"] };
    // stdin contains the literal `;true`, so the literal-arg match succeeds; chaining never happens.
    expect(runOracle("c", oracle, "x ;true y", NOW).result).toBe("pass");
    expect(runOracle("c", oracle, "x true y", NOW).result).toBe("fail");
  });
});

// ── hashing: claim_hash binds the verdict to the claim TEXT ───────────────────

describe("hashing", () => {
  test("claim_hash is sha256 of the claim TEXT, stable across runs", () => {
    const oracle: OracleConfig = { name: "ok", cmd: ["true"] };
    const a = runOracle("id", oracle, "same text", NOW);
    const b = runOracle("id", oracle, "same text", NOW);
    expect(a.claim_hash).toBe(b.claim_hash);
    expect(a.claim_hash).toHaveLength(64); // sha256 hex
  });

  test("different claim text → different claim_hash", () => {
    const oracle: OracleConfig = { name: "ok", cmd: ["true"] };
    const a = runOracle("id", oracle, "text one", NOW);
    const b = runOracle("id", oracle, "text two", NOW);
    expect(a.claim_hash).not.toBe(b.claim_hash);
  });

  test("oracle_digest is sha256 of the joined cmd", () => {
    const a = runOracle("id", { name: "x", cmd: ["true"] }, "t", NOW);
    const b = runOracle("id", { name: "x", cmd: ["true", "--flag"] }, "t", NOW);
    expect(a.oracle_digest).not.toBe(b.oracle_digest);
    expect(a.oracle_digest).toHaveLength(64);
  });

  test("inputs_hash is sha256 of concatenated input file contents, '' when none", () => {
    const dir = mkTmp();
    const f1 = path.join(dir, "a.txt");
    fs.writeFileSync(f1, "alpha");
    const withInputs: OracleConfig = { name: "x", cmd: ["true"], inputs: [f1] };
    const noInputs: OracleConfig = { name: "x", cmd: ["true"] };
    const a = runOracle("id", withInputs, "t", NOW);
    const b = runOracle("id", noInputs, "t", NOW);
    expect(a.inputs_hash).toHaveLength(64);
    expect(a.inputs_hash).not.toBe(b.inputs_hash);

    // mutating an input file changes the hash
    fs.writeFileSync(f1, "beta");
    const c = runOracle("id", withInputs, "t", NOW);
    expect(c.inputs_hash).not.toBe(a.inputs_hash);
  });
});

// ── isStale: claim text drift invalidates the verdict ─────────────────────────

describe("isStale", () => {
  test("fresh verdict is not stale against its own claim text", () => {
    const v = runOracle("id", { name: "ok", cmd: ["true"] }, "claim text", NOW);
    expect(isStale(v, "claim text")).toBe(false);
  });

  test("a verdict goes stale when the claim text changes", () => {
    const v = runOracle("id", { name: "ok", cmd: ["true"] }, "claim text", NOW);
    expect(isStale(v, "claim text MUTATED")).toBe(true);
  });
});

// ── currentVerdicts: staleness resolved AT THE EDGE ───────────────────────────

describe("currentVerdicts", () => {
  function passVerdict(claim: string, claimText: string): Verdict {
    return runOracle(claim, { name: "ok", cmd: ["true"] }, claimText, NOW);
  }

  test("filters out verdicts whose live claim text no longer matches", () => {
    const v1 = passVerdict("lemA", "text A"); // resolves to current text → kept
    const v2 = passVerdict("lemB", "text B"); // live text mutated → dropped
    const resolve = (claim: string): string =>
      claim === "lemA" ? "text A" : "text B MUTATED";
    const current = currentVerdicts([v1, v2], resolve);
    expect(current.map((v) => v.claim)).toEqual(["lemA"]);
  });

  test("a verdict whose claim can't be resolved (null) is treated as stale/dropped", () => {
    const v1 = passVerdict("lemA", "text A");
    const resolve = (): string | null => null; // claim text unresolvable
    expect(currentVerdicts([v1], resolve)).toEqual([]);
  });

  test("all-current verdicts pass through unchanged", () => {
    const v1 = passVerdict("lemA", "text A");
    const v2 = passVerdict("lemB", "text B");
    const resolve = (claim: string): string => (claim === "lemA" ? "text A" : "text B");
    expect(currentVerdicts([v1, v2], resolve).length).toBe(2);
  });
});
