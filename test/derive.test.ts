import { test, expect, describe } from "bun:test";
import { derive } from "../src/derive.ts";
import type {
  Portfolio,
  LogRecord,
  Verdict,
  Evidence,
  Worker,
  Decision,
  Outcome,
  Tier,
  EvidenceClass,
} from "../src/types.ts";

// ── fixture builders ─────────────────────────────────────────────────────────
function portfolio(over: Partial<Portfolio> = {}): Portfolio {
  return {
    goal: "prove the conjecture",
    frontier: "(EX) one inequality",
    config: { stale_threshold: 2, max_blocks_per_turn: 2 },
    arms: [
      { id: "A", desc: "arm A", priority: "primary", target: "(EX)", kill: null, created: "2026-06-21T10:00:00Z" },
      { id: "B", desc: "arm B", priority: "exploratory", target: null, kill: null, created: "2026-06-21T10:00:00Z" },
    ],
    ...over,
  };
}

let cycleCounter = 0;
function rec(over: Partial<LogRecord> = {}): LogRecord {
  cycleCounter += 1;
  return {
    ts: "2026-06-21T10:00:00Z",
    cycle: over.cycle ?? cycleCounter,
    wave: `w${over.cycle ?? cycleCounter}`,
    arm: "A",
    target: "(EX)",
    outcome: "died",
    at: null,
    note: "note",
    evidence: null,
    workers: [{ model: "opus", role: "prover" }],
    p_true: null,
    p_audit: null,
    decision: { type: "EXPLOIT", arm: "A" },
    ...over,
  };
}

function ev(over: Partial<Evidence> = {}): Evidence {
  return { class: "af", tier: "T0", artifact: "proofs/lem-x", verdict: "claimed", ...over };
}

function armOf(state: ReturnType<typeof derive>, id: string) {
  const a = state.arms.find((x) => x.id === id);
  if (!a) throw new Error(`no arm ${id}`);
  return a;
}

// ── staleness ────────────────────────────────────────────────────────────────
describe("staleness", () => {
  test("every died pull that does not reduce the frontier increments — incl. the first", () => {
    const log: LogRecord[] = [
      rec({ outcome: "died", at: "R1" }), // no frontier reduction → 1
      rec({ outcome: "died", at: "R1" }), // → 2 (trips k=2, matches PRD §14 #2)
    ];
    const s = derive(portfolio(), log, []);
    expect(armOf(s, "A").stale).toBe(2);
  });

  test("increments on null-outcome pulls that do not move the frontier", () => {
    const log: LogRecord[] = [
      rec({ outcome: "null", at: null }), // → 1
      rec({ outcome: "null", at: null }), // → 2
    ];
    expect(armOf(derive(portfolio(), log, []), "A").stale).toBe(2);
  });

  test("does NOT reset on a died at a NEW residual — paraphrasing can't dodge the breaker", () => {
    const log: LogRecord[] = [
      rec({ outcome: "died", at: "R1" }), // → 1
      rec({ outcome: "died", at: "R2" }), // new residual but NO frontier reduction → still increments → 2
    ];
    expect(armOf(derive(portfolio(), log, []), "A").stale).toBe(2);
  });

  test("RESETS on a progress pull", () => {
    const log: LogRecord[] = [
      rec({ outcome: "died", at: "R1" }), // 1
      rec({ outcome: "died", at: "R1" }), // 2
      rec({ outcome: "progress", at: null, evidence: ev() }), // move → reset 0
    ];
    expect(armOf(derive(portfolio(), log, []), "A").stale).toBe(0);
  });

  test("RESETS on a refuted pull", () => {
    const log: LogRecord[] = [
      rec({ outcome: "died", at: "R1" }), // 1
      rec({ outcome: "died", at: "R1" }), // 2
      rec({ outcome: "refuted", at: null, evidence: ev() }), // move → reset 0
    ];
    expect(armOf(derive(portfolio(), log, []), "A").stale).toBe(0);
  });

  test("a productive death — frontier_after reduces the open — RESETS (PRD §4.5)", () => {
    const log: LogRecord[] = [
      rec({ outcome: "died", at: "R1" }), // 1
      rec({ outcome: "died", at: "R1" }), // 2
      rec({ outcome: "died", at: "R1", frontier_after: "(EX) reduced" }), // reduces FRONTIER → reset 0
    ];
    expect(armOf(derive(portfolio(), log, []), "A").stale).toBe(0);
  });
});

// ── strip ────────────────────────────────────────────────────────────────────
describe("strip", () => {
  test("glyph strip is newest-last and capped at stripLen", () => {
    const outcomes: Outcome[] = ["banked", "progress", "died", "refuted", "null", "died", "progress"];
    const log = outcomes.map((o) =>
      rec({ outcome: o, at: o === "died" ? "R" : null, evidence: o === "null" ? null : ev() }),
    );
    const s = derive(portfolio(), log, [], 6);
    // banked ▣ progress △ died ✗ refuted ⊘ null — ; last 6, newest last
    // full: ▣ △ ✗ ⊘ — ✗ △  → last6: △ ✗ ⊘ — ✗ △
    expect(armOf(s, "A").strip).toBe("△✗⊘—✗△");
  });

  test("strip shorter than stripLen keeps all glyphs, newest last", () => {
    const log = [rec({ outcome: "died", at: "R" }), rec({ outcome: "progress", evidence: ev() })];
    expect(armOf(derive(portfolio(), log, [], 6), "A").strip).toBe("✗△");
  });
});

// ── bestTier / bestClass ─────────────────────────────────────────────────────
describe("bestTier / bestClass", () => {
  test("best (lowest-numbered) tier reached by a progress/banked pull", () => {
    const log = [
      rec({ outcome: "progress", evidence: ev({ tier: "T2", class: "num" }) }),
      rec({ outcome: "progress", evidence: ev({ tier: "T0", class: "af" }) }),
      rec({ outcome: "progress", evidence: ev({ tier: "T1", class: "lean" }) }),
    ];
    const a = armOf(derive(portfolio(), log, []), "A");
    expect(a.bestTier).toBe("T0");
    expect(a.bestClass).toBe("af");
  });

  test("died pulls do not contribute to bestTier", () => {
    const log = [rec({ outcome: "died", at: "R", evidence: ev({ tier: "T0" }) })];
    expect(armOf(derive(portfolio(), log, []), "A").bestTier).toBeNull();
  });
});

// ── distinctFamilies ─────────────────────────────────────────────────────────
describe("distinctFamilies", () => {
  test("counts distinct families across the trailing stalling run", () => {
    const log = [
      rec({ outcome: "died", at: "R1", workers: [{ model: "opus", role: "prover" }] }), // move → run resets, not in run
      rec({ outcome: "died", at: "R1", workers: [{ model: "sonnet", role: "p" }] }), // stale 1 (claude)
      rec({ outcome: "died", at: "R1", workers: [{ model: "codex", role: "p" }] }), // stale 2 (openai)
    ];
    // trailing stalling run = the two non-moving pulls; families {claude, openai} = 2
    expect(armOf(derive(portfolio(), log, []), "A").distinctFamilies).toBe(2);
  });

  test("family map collapses opus+sonnet+haiku+fable to one family 'claude'", () => {
    const log = [
      rec({ outcome: "died", at: "R1", workers: [{ model: "opus", role: "p" }] }), // move
      rec({ outcome: "died", at: "R1", workers: [{ model: "sonnet", role: "p" }] }), // stale (claude)
      rec({ outcome: "died", at: "R1", workers: [{ model: "haiku", role: "p" }, { model: "fable", role: "p" }] }), // stale (claude)
    ];
    expect(armOf(derive(portfolio(), log, []), "A").distinctFamilies).toBe(1);
  });

  test("gemini→google, gpt→openai, unknown→raw", () => {
    const log = [
      rec({ outcome: "died", at: "R1", workers: [{ model: "opus", role: "p" }] }), // claude (in run — no frontier move)
      rec({ outcome: "died", at: "R1", workers: [{ model: "gemini", role: "p" }] }), // google
      rec({ outcome: "died", at: "R1", workers: [{ model: "gpt", role: "p" }] }), // openai
      rec({ outcome: "died", at: "R1", workers: [{ model: "mystery-model", role: "p" }] }), // raw
    ];
    // trailing run families: {claude, google, openai, mystery-model} = 4
    expect(armOf(derive(portfolio(), log, []), "A").distinctFamilies).toBe(4);
  });
});

// ── status ───────────────────────────────────────────────────────────────────
describe("status", () => {
  test("untried arm (0 pulls) → status 'untried' and renders ??", () => {
    const s = derive(portfolio(), [], []);
    expect(armOf(s, "B").status).toBe("untried");
    expect(armOf(s, "B").pulls).toBe(0);
  });

  test("dead-priority arm → status 'dead'", () => {
    const p = portfolio();
    p.arms[1]!.priority = "dead";
    expect(armOf(derive(p, [], []), "B").status).toBe("dead");
  });

  test("stalled when stale >= threshold", () => {
    const log = [
      rec({ outcome: "died", at: "R1" }),
      rec({ outcome: "died", at: "R1" }),
      rec({ outcome: "died", at: "R1" }),
    ];
    expect(armOf(derive(portfolio(), log, []), "A").status).toBe("stalled");
  });

  test("hot when last pull was progress/banked", () => {
    const log = [rec({ outcome: "progress", evidence: ev() })];
    expect(armOf(derive(portfolio(), log, []), "A").status).toBe("hot");
  });

  test("warm when last pull died at a new residual", () => {
    const log = [rec({ outcome: "died", at: "R1" })];
    expect(armOf(derive(portfolio(), log, []), "A").status).toBe("warm");
  });

  test("cold otherwise (single null pull, below threshold)", () => {
    const log = [rec({ outcome: "null", at: null })]; // stale 1 < 2, last outcome null → cold
    expect(armOf(derive(portfolio(), log, []), "A").status).toBe("cold");
  });
});

// ── aggP ─────────────────────────────────────────────────────────────────────
describe("aggP", () => {
  test("mean of non-null p_true, null when none", () => {
    const log = [
      rec({ outcome: "died", at: "R1", p_true: 0.4 }),
      rec({ outcome: "died", at: "R1", p_true: 0.6 }),
      rec({ outcome: "died", at: "R1", p_true: null }),
    ];
    expect(armOf(derive(portfolio(), log, []), "A").aggP).toBeCloseTo(0.5);
    const log2 = [rec({ outcome: "died", at: "R1", p_true: null })];
    expect(armOf(derive(portfolio(), log2, []), "A").aggP).toBeNull();
  });
});

// ── frontierTrail ────────────────────────────────────────────────────────────
describe("frontierTrail", () => {
  test("initial frontier then distinct frontier_after values in order; frontier = last", () => {
    const log = [
      rec({ outcome: "died", at: "R1" }), // no frontier_after
      rec({ outcome: "progress", evidence: ev(), frontier_after: "(SB)" }),
      rec({ outcome: "progress", evidence: ev(), frontier_after: "(SB)" }), // dup, ignored
      rec({ outcome: "progress", evidence: ev(), frontier_after: "(EX)" }),
    ];
    const s = derive(portfolio(), log, []);
    expect(s.frontierTrail).toEqual(["(EX) one inequality", "(SB)", "(EX)"]);
    expect(s.frontier).toBe("(EX)");
  });

  test("when the first frontier_after equals the initial frontier it is not duplicated", () => {
    const p = portfolio({ frontier: "(SB)" });
    const log = [rec({ outcome: "progress", evidence: ev(), frontier_after: "(SB)" })];
    const s = derive(p, log, []);
    expect(s.frontierTrail).toEqual(["(SB)"]);
    expect(s.frontier).toBe("(SB)");
  });

  test("no frontier_after anywhere → trail is just the initial frontier", () => {
    const s = derive(portfolio(), [rec({ outcome: "died", at: "R1" })], []);
    expect(s.frontierTrail).toEqual(["(EX) one inequality"]);
    expect(s.frontier).toBe("(EX) one inequality");
  });
});

// ── deadRoutes ───────────────────────────────────────────────────────────────
describe("deadRoutes", () => {
  test("includes refuted (residual=target) and died (residual=at), dedupe by residual newest-wins", () => {
    const log = [
      rec({ cycle: 1, outcome: "died", at: "R1", note: "old death" }),
      rec({ cycle: 2, outcome: "died", at: "R1", note: "newer death", wave: "w2" }), // dup residual, newer wins
      rec({ cycle: 3, outcome: "refuted", target: "R2", at: null, evidence: ev(), note: "counterexample" }),
    ];
    const s = derive(portfolio(), log, []);
    const byResidual = new Map(s.deadRoutes.map((d) => [d.residual, d]));
    expect(byResidual.size).toBe(2);
    expect(byResidual.get("R1")!.reason).toBe("newer death");
    expect(byResidual.get("R1")!.killedAtCycle).toBe(2);
    expect(byResidual.get("R2")!.outcome).toBe("refuted");
    expect(byResidual.get("R2")!.residual).toBe("R2"); // refuted keys on target
  });

  test("refuted WITHOUT a target falls back to `at`, else the note (no silent miss)", () => {
    const log = [
      rec({ cycle: 1, outcome: "refuted", target: null, at: "R-at", evidence: ev(), note: "n1" }),
      rec({ cycle: 2, outcome: "refuted", target: null, at: null, evidence: ev(), note: "killed by counterexample" }),
    ];
    const residuals = derive(portfolio(), log, []).deadRoutes.map((d) => d.residual);
    expect(residuals).toContain("R-at"); // fell back to at
    expect(residuals).toContain("killed by counterexample"); // fell back to note
  });
});

// ── banked ───────────────────────────────────────────────────────────────────
describe("banked", () => {
  function passVerdict(claim: string): Verdict {
    return {
      claim,
      oracle: "af",
      result: "pass",
      claim_hash: "h",
      oracle_digest: "d",
      inputs_hash: "",
      ts: "2026-06-21T11:00:00Z",
    };
  }

  test("banked entry verified=true only with a passing verdict whose claim===artifact", () => {
    const log = [rec({ outcome: "banked", evidence: ev({ artifact: "proofs/lem-x" }) })];
    const s = derive(portfolio(), log, [passVerdict("proofs/lem-x")]);
    expect(s.banked.length).toBe(1);
    expect(s.banked[0]!.verified).toBe(true);
    expect(s.banked[0]!.artifact).toBe("proofs/lem-x");
  });

  test("banked entry verified=false when no matching passing verdict", () => {
    const log = [rec({ outcome: "banked", evidence: ev({ artifact: "proofs/lem-x" }) })];
    // verdict for a DIFFERENT claim, and a failing verdict for the right claim
    const verdicts: Verdict[] = [
      passVerdict("proofs/other"),
      { ...passVerdict("proofs/lem-x"), result: "fail" },
    ];
    const s = derive(portfolio(), log, verdicts);
    expect(s.banked.length).toBe(1);
    expect(s.banked[0]!.verified).toBe(false);
  });

  test("supersession removes a superseded banked entry from the live view", () => {
    const log = [
      rec({ cycle: 10, outcome: "banked", evidence: ev({ artifact: "proofs/lem-x" }) }),
      rec({
        cycle: 11,
        outcome: "died",
        at: "retracted",
        note: "retraction",
        supersedes: 10,
        decision: { type: "PIVOT", arm: "A" },
      }),
    ];
    const s = derive(portfolio(), log, [passVerdict("proofs/lem-x")]);
    expect(s.banked.length).toBe(0); // cycle-10 banked superseded → gone from live banked
  });
});

// ── cycle ────────────────────────────────────────────────────────────────────
describe("cycle", () => {
  test("cycle = last cycle index seen (0 when empty)", () => {
    expect(derive(portfolio(), [], []).cycle).toBe(0);
    const log = [rec({ cycle: 5 }), rec({ cycle: 8 })];
    expect(derive(portfolio(), log, []).cycle).toBe(8);
  });
});

// ── discoveries ledger (D1) ───────────────────────────────────────────────────
describe("discoveries", () => {
  test("a discovery record creates one ledger entry with its fields", () => {
    const log: LogRecord[] = [
      rec({
        arm: null,
        outcome: "discovery",
        at: null,
        decision: null,
        note: "diagonal of the transfer matrix is itself row-stochastic",
        question: "falsifier: a δ≤1/4 P whose diagonal is not stochastic",
        evidence: ev({ artifact: "obs/diag", class: "side", tier: "T1" }),
      }),
    ];
    const s = derive(portfolio(), log, []);
    expect(s.discoveries.length).toBe(1);
    const d = s.discoveries[0]!;
    expect(d.observation).toBe("diagonal of the transfer matrix is itself row-stochastic");
    expect(d.question).toBe("falsifier: a δ≤1/4 P whose diagonal is not stochastic");
    expect(d.artifact).toBe("obs/diag");
    expect(d.class).toBe("side");
    expect(d.tier).toBe("T1");
    expect(d.reuse).toBe(0);
    expect(d.status).toBe("parked");
  });

  test("a discovery is breaker-NEUTRAL: not in any arm's pulls/stale/strip", () => {
    const log: LogRecord[] = [
      rec({ arm: "A", outcome: "died", at: "R1" }), // stale 1
      rec({ arm: null, outcome: "discovery", at: null, decision: null, note: "off-goal", question: "q" }),
      rec({ arm: "A", outcome: "died", at: "R1" }), // stale 2 — the discovery between did NOT reset it
    ];
    const a = armOf(derive(portfolio(), log, []), "A");
    expect(a.stale).toBe(2); // breaker still trips; the discovery is invisible to the walk
    expect(a.pulls).toBe(2); // discovery not counted as a pull
    expect(a.strip).toBe("✗✗"); // no ⟡ in the strip
  });

  test("reuse counts DISTINCT citing arms (cross-thread), not citation count", () => {
    const log: LogRecord[] = [
      rec({ arm: null, outcome: "discovery", at: null, decision: null, note: "obs", question: "q", evidence: ev({ artifact: "obs/x" }) }),
      rec({ arm: "A", outcome: "progress", at: null, evidence: ev({ artifact: "p/a" }), cites: ["obs/x"] }),
      rec({ arm: "B", outcome: "died", at: "R", cites: ["obs/x"] }),
      rec({ arm: "B", outcome: "died", at: "R", cites: ["obs/x"] }), // same arm again → still distinct {A,B}
    ];
    expect(derive(portfolio(), log, []).discoveries[0]!.reuse).toBe(2);
  });

  test("a superseded discovery drops from the live ledger", () => {
    const log: LogRecord[] = [
      rec({ cycle: 5, arm: null, outcome: "discovery", at: null, decision: null, note: "obs", question: "q" }),
      rec({ cycle: 6, arm: "A", outcome: "died", at: "x", supersedes: 5 }),
    ];
    expect(derive(portfolio(), log, []).discoveries.length).toBe(0);
  });
});
