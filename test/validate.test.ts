/**
 * validate.test.ts — red-green tests for the PURE write-time validator (Pillar B).
 *
 * Covers each IMPL_PLAN §2 `validate.ts` reject:
 *   died-without-`at` · progress/banked-without-artifact · banked-without-passing-verdict ·
 *   refuted-with-evidence.verdict==="banked" (launder) · unknown arm id · missing decision ·
 *   decision.arm not a registered arm · breaker tripped (rec's arm `stalled`) and decision
 *   not an escape — plus a happy-path {ok:true}.
 */
import { test, expect, describe } from "bun:test";
import { validateLog, validateDiscover, validateFork } from "../src/validate";
import type {
  Portfolio,
  DerivedState,
  DerivedArm,
  LogRecord,
  Verdict,
  Evidence,
  Decision,
  Discovery,
  Outcome,
} from "../src/types";

// ── fixture builders (inline, types only) ───────────────────────────────────

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
    discoveries: [],
    cycle: arms.length,
    ...over,
  };
}

function decision(type: Decision["type"], armId: string): Decision {
  return { type, arm: armId };
}

function evidence(over: Partial<Evidence> = {}): Evidence {
  return { class: "lit", tier: "T1", artifact: "path/to/x", ...over };
}

function rec(over: Partial<LogRecord> = {}): LogRecord {
  return {
    ts: "2026-01-02T00:00:00Z",
    cycle: 1,
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

// ── happy path ──────────────────────────────────────────────────────────────

describe("validateLog happy path", () => {
  test("a clean died+EXPLOIT record is ok", () => {
    const res = validateLog(portfolio(), state([arm()]), rec(), []);
    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
  });
});

// ── died without `at` ───────────────────────────────────────────────────────

describe("died-without-at", () => {
  test("rejects a died record with no residual", () => {
    const res = validateLog(portfolio(), state([arm()]), rec({ outcome: "died", at: null }), []);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at|residual|death/i);
  });
});

// ── progress / banked without artifact ──────────────────────────────────────

describe("progress/banked-without-artifact", () => {
  test("rejects progress with no evidence artifact", () => {
    const res = validateLog(
      portfolio(),
      state([arm()]),
      rec({ outcome: "progress", at: null, evidence: evidence({ artifact: null }) }),
      [],
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/artifact/i);
  });

  test("rejects banked with null evidence", () => {
    const res = validateLog(
      portfolio(),
      state([arm()]),
      rec({ outcome: "banked", at: null, evidence: null }),
      [passingVerdict("anything")],
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/artifact/i);
  });
});

// ── banked without a passing verdict ────────────────────────────────────────

describe("banked-without-passing-verdict", () => {
  test("rejects banked when no passing verdict exists for the artifact", () => {
    const res = validateLog(
      portfolio(),
      state([arm()]),
      rec({ outcome: "banked", at: null, evidence: evidence({ artifact: "thm/main" }) }),
      [],
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/verify|verdict|audit/i);
  });

  test("accepts banked when a passing verdict on the artifact exists", () => {
    const res = validateLog(
      portfolio(),
      state([arm()]),
      rec({ outcome: "banked", at: null, evidence: evidence({ artifact: "thm/main" }) }),
      [passingVerdict("thm/main")],
    );
    expect(res.ok).toBe(true);
  });
});

// ── launder ─────────────────────────────────────────────────────────────────

describe("refuted-launder", () => {
  test("rejects a refuted record whose evidence.verdict is 'banked'", () => {
    const res = validateLog(
      portfolio(),
      state([arm()]),
      rec({ outcome: "refuted", at: null, evidence: evidence({ verdict: "banked" }) }),
      [],
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/launder|banked|refut/i);
  });
});

// ── unknown arm id ──────────────────────────────────────────────────────────

describe("unknown-arm", () => {
  test("rejects a record whose arm is not registered", () => {
    const res = validateLog(
      portfolio(),
      state([arm()]),
      rec({ arm: "ZZZ", decision: decision("EXPLOIT", "A") }),
      [],
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/arm/i);
  });
});

// ── missing decision ────────────────────────────────────────────────────────

describe("missing-decision", () => {
  test("rejects a record with no decision", () => {
    const res = validateLog(portfolio(), state([arm()]), rec({ decision: null }), []);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/decision/i);
  });
});

// ── decision.arm not a registered arm ───────────────────────────────────────

describe("decision-arm-unregistered", () => {
  test("rejects a decision targeting an unregistered arm", () => {
    const res = validateLog(
      portfolio(),
      state([arm()]),
      rec({ decision: decision("EXPLORE", "ZZZ") }),
      [],
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/arm/i);
  });
});

// ── validateDiscover (D1): capture ritual ───────────────────────────────────

describe("validateDiscover", () => {
  function disc(over: Partial<LogRecord> = {}): LogRecord {
    return rec({
      arm: null,
      outcome: "discovery",
      at: null,
      decision: null,
      note: "an off-goal observation",
      question: "what would falsify this / why it matters",
      ...over,
    });
  }

  test("rejects a discovery with no observation", () => {
    const res = validateDiscover(disc({ note: "" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/observation/i);
  });

  test("rejects a discovery with no --question (Platt's The Question)", () => {
    const res = validateDiscover(disc({ question: "" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/question/i);
  });

  test("accepts a well-formed discovery", () => {
    const res = validateDiscover(disc());
    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
  });
});

// ── validateFork (GF — D3 fork eligibility) ─────────────────────────────────

describe("validateFork", () => {
  function disc(over: Partial<Discovery> = {}): Discovery {
    return {
      cycle: 1, observation: "obs", question: "q", class: "side", tier: "T1",
      artifact: "obs/x", reuse: 2, learningProgress: false, surprise: false, status: "parked",
      ...over,
    };
  }

  test("rejects when the discovery does not exist", () => {
    expect(validateFork(undefined, "new goal", "(NG) open").ok).toBe(false);
  });

  test("rejects without a new goal", () => {
    expect(validateFork(disc(), "", "(NG) open").ok).toBe(false);
  });

  test("rejects without a stateable new frontier", () => {
    const r = validateFork(disc(), "new goal", "");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/frontier/i);
  });

  test("rejects when not interesting enough (reuse<2 and no learning-progress)", () => {
    const r = validateFork(disc({ reuse: 1, learningProgress: false }), "new goal", "(NG) open");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/reuse|eligible|learning/i);
  });

  test("accepts at reuse >= 2 (Decision A)", () => {
    expect(validateFork(disc({ reuse: 2 }), "new goal", "(NG) open").ok).toBe(true);
  });

  test("accepts on learning-progress even with reuse < 2 (Decision A)", () => {
    expect(validateFork(disc({ reuse: 0, learningProgress: true }), "new goal", "(NG) open").ok).toBe(true);
  });
});

// ── breaker tripped at write time ───────────────────────────────────────────

describe("breaker-tripped", () => {
  test("rejects EXPLOIT when the record's arm is stalled in derived state", () => {
    const res = validateLog(
      portfolio(),
      state([arm({ status: "stalled", stale: 2 })]),
      rec({ outcome: "died", at: "residual-1", decision: decision("EXPLOIT", "A") }),
      [],
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/EXPLORE|PIVOT|stall|breaker/i);
  });

  test("rejects EXPLORE-to-same-arm when the arm is stalled", () => {
    const res = validateLog(
      portfolio(),
      state([arm({ status: "stalled", stale: 2 })]),
      rec({ outcome: "died", at: "residual-1", arm: "A", decision: decision("EXPLORE", "A") }),
      [],
    );
    expect(res.ok).toBe(false);
  });

  test("accepts EXPLORE-to-different-arm when the arm is stalled (escape)", () => {
    const res = validateLog(
      portfolio(),
      state([arm({ status: "stalled", stale: 2 }), arm({ id: "B", status: "cold" })]),
      rec({ outcome: "died", at: "residual-1", arm: "A", decision: decision("EXPLORE", "B") }),
      [],
    );
    expect(res.ok).toBe(true);
  });

  test("accepts PIVOT when the arm is stalled (escape)", () => {
    const res = validateLog(
      portfolio(),
      state([arm({ status: "stalled", stale: 2 })]),
      rec({ outcome: "died", at: "residual-1", arm: "A", decision: decision("PIVOT", "A") }),
      [],
    );
    expect(res.ok).toBe(true);
  });

  test("accepts EXPLOIT on a stalled arm when the pull REDUCES the frontier (productive death, PRD §4.5)", () => {
    const res = validateLog(
      portfolio(),
      state([arm({ status: "stalled", stale: 2 })]), // state.frontier === "(EX)"
      rec({
        outcome: "died",
        at: "residual-1",
        arm: "A",
        frontier_after: "(EX) reduced to one scalar", // ≠ state.frontier ⇒ reduction ⇒ exempt
        decision: decision("EXPLOIT", "A"),
      }),
      [],
    );
    expect(res.ok).toBe(true);
  });
});
