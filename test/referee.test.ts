/**
 * referee.test.ts — red-green tests for the PURE referee (Pillar B).
 *
 * Covers every bullet of the IMPL_PLAN §4 referee row:
 *   G1 (nothing logged) · G2 (progress no artifact) · G2b (banked no verdict; verdict→pass)
 *   G3 breaker (fires on stale+EXPLOIT; passes on EXPLORE-different / PIVOT; passes when a
 *   fresh residual reset stale) · G4 (no decision) · G5 (died no `at`) · anti-launder ·
 *   loop guard (blocks_this_turn ≥ max → status "soft" not "block").
 *
 * Fixtures are constructed inline from the TYPE contract only (no derive.ts dependency).
 */
import { test, expect, describe } from "bun:test";
import { check } from "../src/referee";
import type {
  DerivedState,
  DerivedArm,
  TurnState,
  LogRecord,
  Portfolio,
  Verdict,
  Evidence,
  Decision,
  Outcome,
} from "../src/types";

// ── fixture builders ────────────────────────────────────────────────────────

function portfolio(over: Partial<Portfolio> = {}): Portfolio {
  return {
    goal: "prove conjecture",
    frontier: "(EX)",
    config: { stale_threshold: 2, max_blocks_per_turn: 2 },
    arms: [
      { id: "A", desc: "arm a", priority: "primary", target: "(EX)", kill: null, created: "2026-01-01T00:00:00Z" },
      { id: "B", desc: "arm b", priority: "support", target: "(SB)", kill: null, created: "2026-01-01T00:00:00Z" },
    ],
    ...over,
  };
}

function arm(over: Partial<DerivedArm> = {}): DerivedArm {
  return {
    id: "A",
    desc: "arm a",
    priority: "primary",
    target: "(EX)",
    pulls: 1,
    strip: "✗",
    bestTier: null,
    bestClass: null,
    stale: 0,
    distinctFamilies: 1,
    status: "cold",
    aggP: null,
    lastResidual: null,
    ...over,
  };
}

function state(arms: DerivedArm[], over: Partial<DerivedState> = {}): DerivedState {
  return {
    goal: "prove conjecture",
    frontier: "(EX)",
    frontierTrail: ["(EX)"],
    arms,
    deadRoutes: [],
    banked: [],
    cycle: arms.length,
    ...over,
  };
}

function decision(type: Decision["type"], armId: string): Decision {
  return { type, arm: armId };
}

let cyc = 0;
function rec(over: Partial<LogRecord> = {}): LogRecord {
  cyc += 1;
  return {
    ts: "2026-01-02T00:00:00Z",
    cycle: cyc,
    arm: "A",
    target: "(EX)",
    outcome: "died" as Outcome,
    at: "residual-1",
    note: "n",
    evidence: null,
    workers: [{ model: "opus", role: "prover" }],
    decision: decision("EXPLOIT", "A"),
    ...over,
  };
}

function evidence(over: Partial<Evidence> = {}): Evidence {
  return { class: "lit", tier: "T1", artifact: "path/to/x", ...over };
}

function turn(over: Partial<TurnState> = {}): TurnState {
  return { log_len_at_turn_start: 0, blocks_this_turn: 0, ...over };
}

function passingVerdict(claim: string): Verdict {
  return {
    claim,
    oracle: "lean",
    result: "pass",
    claim_hash: "h",
    oracle_digest: "d",
    inputs_hash: "i",
    ts: "2026-01-02T00:00:00Z",
  };
}

// ── G1: nothing logged this turn ────────────────────────────────────────────

describe("G1 logged-this-turn", () => {
  test("blocks when no record was appended this turn", () => {
    const r = rec();
    const log = [r];
    // turn started at len 1 → nothing new this turn
    const res = check(state([arm()]), turn({ log_len_at_turn_start: 1 }), log, portfolio(), []);
    expect(res.status).toBe("block");
    expect(res.gate).toBe("G1");
    expect(res.reason).toContain("fr log");
  });
});

// ── G2: progress/banked needs a resolvable artifact ─────────────────────────

describe("G2 progress/banked-backed", () => {
  test("blocks progress with no artifact", () => {
    const r = rec({ outcome: "progress", at: null, evidence: evidence({ artifact: null }), decision: decision("EXPLOIT", "A") });
    const res = check(state([arm()]), turn(), [r], portfolio(), []);
    expect(res.status).toBe("block");
    expect(res.gate).toBe("G2");
  });

  test("blocks progress with null evidence", () => {
    const r = rec({ outcome: "progress", at: null, evidence: null, decision: decision("EXPLOIT", "A") });
    const res = check(state([arm()]), turn(), [r], portfolio(), []);
    expect(res.status).toBe("block");
    expect(res.gate).toBe("G2");
  });

  test("progress WITH artifact passes G2 (and overall)", () => {
    const r = rec({ outcome: "progress", at: null, evidence: evidence({ artifact: "lemma/x" }), decision: decision("EXPLOIT", "A") });
    const res = check(state([arm()]), turn(), [r], portfolio(), []);
    expect(res.status).toBe("pass");
  });
});

// ── G2b: banked needs a passing verdict on the artifact ─────────────────────

describe("G2b banked-verified", () => {
  test("blocks banked when no passing verdict exists for its artifact", () => {
    const r = rec({ outcome: "banked", at: null, evidence: evidence({ artifact: "thm/main" }), decision: decision("EXPLOIT", "A") });
    const res = check(state([arm()]), turn(), [r], portfolio(), []); // no verdicts
    expect(res.status).toBe("block");
    expect(res.gate).toBe("G2b");
    expect(res.reason).toContain("fr verify");
  });

  test("blocks banked when a verdict exists but for a DIFFERENT claim", () => {
    const r = rec({ outcome: "banked", at: null, evidence: evidence({ artifact: "thm/main" }), decision: decision("EXPLOIT", "A") });
    const res = check(state([arm()]), turn(), [r], portfolio(), [passingVerdict("thm/other")]);
    expect(res.status).toBe("block");
    expect(res.gate).toBe("G2b");
  });

  test("blocks banked when the verdict for its claim is a FAIL", () => {
    const v = passingVerdict("thm/main");
    v.result = "fail";
    const r = rec({ outcome: "banked", at: null, evidence: evidence({ artifact: "thm/main" }), decision: decision("EXPLOIT", "A") });
    const res = check(state([arm()]), turn(), [r], portfolio(), [v]);
    expect(res.status).toBe("block");
    expect(res.gate).toBe("G2b");
  });

  test("banked WITH a passing verdict on its artifact passes", () => {
    const r = rec({ outcome: "banked", at: null, evidence: evidence({ artifact: "thm/main" }), decision: decision("EXPLOIT", "A") });
    const res = check(state([arm()]), turn(), [r], portfolio(), [passingVerdict("thm/main")]);
    expect(res.status).toBe("pass");
  });
});

// ── G3: circuit-breaker ─────────────────────────────────────────────────────

describe("G3 breaker", () => {
  test("fires when the newest arm is stale and the decision is EXPLOIT", () => {
    const r = rec({ outcome: "died", at: "residual-1", decision: decision("EXPLOIT", "A") });
    const st = state([arm({ stale: 2, status: "stalled" })]);
    const res = check(st, turn(), [r], portfolio(), []);
    expect(res.status).toBe("block");
    expect(res.gate).toBe("G3");
    expect(res.reason).toContain("EXPLORE");
  });

  test("fires on EXPLORE to the SAME arm (not an escape)", () => {
    const r = rec({ outcome: "died", at: "residual-1", arm: "A", decision: decision("EXPLORE", "A") });
    const st = state([arm({ stale: 2, status: "stalled" })]);
    const res = check(st, turn(), [r], portfolio(), []);
    expect(res.status).toBe("block");
    expect(res.gate).toBe("G3");
  });

  test("PASSES on EXPLORE to a DIFFERENT arm", () => {
    const r = rec({ outcome: "died", at: "residual-1", arm: "A", decision: decision("EXPLORE", "B") });
    const st = state([arm({ stale: 2, status: "stalled" }), arm({ id: "B", stale: 0 })]);
    const res = check(st, turn(), [r], portfolio(), []);
    expect(res.status).toBe("pass");
  });

  test("PASSES on PIVOT (even to the same arm)", () => {
    const r = rec({ outcome: "died", at: "residual-1", arm: "A", decision: decision("PIVOT", "A") });
    const st = state([arm({ stale: 2, status: "stalled" })]);
    const res = check(st, turn(), [r], portfolio(), []);
    expect(res.status).toBe("pass");
  });

  test("PASSES when a fresh residual reset stale below the threshold (arm not stalled)", () => {
    const r = rec({ outcome: "died", at: "residual-2", arm: "A", decision: decision("EXPLOIT", "A") });
    const st = state([arm({ stale: 0, status: "warm" })]);
    const res = check(st, turn(), [r], portfolio(), []);
    expect(res.status).toBe("pass");
  });
});

// ── G4: turn ends on a decision ─────────────────────────────────────────────

describe("G4 ends-on-decision", () => {
  test("blocks when the newest record has no decision", () => {
    const r = rec({ outcome: "died", at: "residual-1", decision: null });
    const res = check(state([arm()]), turn(), [r], portfolio(), []);
    expect(res.status).toBe("block");
    expect(res.gate).toBe("G4");
    expect(res.reason).toMatch(/EXPLOIT|EXPLORE|PIVOT/);
  });
});

// ── G5: died needs a residual ───────────────────────────────────────────────

describe("G5 died-needs-residual", () => {
  test("blocks a died record with no `at`", () => {
    const r = rec({ outcome: "died", at: null, decision: decision("EXPLOIT", "A") });
    const res = check(state([arm()]), turn(), [r], portfolio(), []);
    expect(res.status).toBe("block");
    expect(res.gate).toBe("G5");
  });
});

// ── anti-launder ────────────────────────────────────────────────────────────

describe("G_launder anti-laundering", () => {
  test("blocks a refuted record whose evidence.verdict is 'banked'", () => {
    const r = rec({ outcome: "refuted", at: null, evidence: evidence({ verdict: "banked" }), decision: decision("EXPLOIT", "A") });
    const res = check(state([arm()]), turn(), [r], portfolio(), []);
    expect(res.status).toBe("block");
    expect(res.gate).toBe("G_launder");
  });

  test("refuted WITHOUT a banked verdict passes the launder gate", () => {
    const r = rec({ outcome: "refuted", at: null, evidence: evidence({ verdict: "claimed" }), decision: decision("EXPLOIT", "A") });
    const res = check(state([arm()]), turn(), [r], portfolio(), []);
    expect(res.status).toBe("pass");
  });
});

// ── happy path ──────────────────────────────────────────────────────────────

describe("pass", () => {
  test("a clean died+EXPLOIT on a non-stale arm passes", () => {
    const r = rec({ outcome: "died", at: "residual-1", decision: decision("EXPLOIT", "A") });
    const res = check(state([arm()]), turn(), [r], portfolio(), []);
    expect(res.status).toBe("pass");
    expect(res.gate).toBeUndefined();
  });
});

// ── loop guard: blocks_this_turn ≥ max → soft not block ──────────────────────

describe("loop guard", () => {
  test("downgrades a block to SOFT when blocks_this_turn >= max_blocks_per_turn", () => {
    // G1 would block (nothing logged this turn), but the guard is tripped.
    const r = rec();
    const res = check(
      state([arm()]),
      turn({ log_len_at_turn_start: 1, blocks_this_turn: 2 }),
      [r],
      portfolio({ config: { stale_threshold: 2, max_blocks_per_turn: 2 } }),
      [],
    );
    expect(res.status).toBe("soft");
    expect(res.gate).toBe("G1");
    expect(res.reason).toBeDefined();
  });

  test("still soft-downgrades a G3 breaker block under the guard", () => {
    const r = rec({ outcome: "died", at: "residual-1", decision: decision("EXPLOIT", "A") });
    const st = state([arm({ stale: 2, status: "stalled" })]);
    const res = check(st, turn({ blocks_this_turn: 5 }), [r], portfolio(), []);
    expect(res.status).toBe("soft");
    expect(res.gate).toBe("G3");
  });

  test("a pass is never affected by the guard", () => {
    const r = rec({ outcome: "died", at: "residual-1", decision: decision("EXPLOIT", "A") });
    const res = check(state([arm()]), turn({ blocks_this_turn: 9 }), [r], portfolio(), []);
    expect(res.status).toBe("pass");
  });
});
