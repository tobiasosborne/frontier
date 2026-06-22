/**
 * board.test.ts — red-green tests for the PURE board renderer + hook wrappers (Pillar C).
 *
 * Covers every IMPL_PLAN §4 board row bullet:
 *   FRONTIER + OPEN + trail rendered · glyph/rung strip · `??` for untried arms ·
 *   dead-routes tail · the no-imperative-phrasing regex assertion ·
 *   exact promptHook / stopPass / stopBlock / stopSoft shapes.
 *
 * board.ts is PURE (no fs/clock/env) — fixtures are DerivedState built from the type contract.
 */
import { test, expect, describe } from "bun:test";
import {
  renderBoard,
  promptHook,
  stopPass,
  stopBlock,
  stopSoft,
} from "../src/board";
import type { DerivedState, DerivedArm, DeadRoute, BankedResult, Discovery } from "../src/types";

// ── fixture builders ────────────────────────────────────────────────────────

function arm(over: Partial<DerivedArm> = {}): DerivedArm {
  return {
    id: "A",
    desc: "quasi-FF criteria",
    priority: "primary",
    target: "(EX)",
    pulls: 6,
    strip: "▣△✗✗——",
    bestTier: "T0",
    bestClass: "af",
    stale: 2,
    distinctFamilies: 2,
    status: "stalled",
    aggP: 0.5,
    lastResidual: "path-product floor",
    ...over,
  };
}

function state(over: Partial<DerivedState> = {}): DerivedState {
  return {
    goal: "prove the conjecture",
    frontier: "(EX) one existence inequality at rank ≥ 3",
    frontierTrail: ["Kernel", "(TREE)", "(SB)", "(EX) one existence inequality at rank ≥ 3"],
    arms: [arm()],
    deadRoutes: [],
    banked: [],
    discoveries: [],
    orientTurns: 0,
    cycle: 6,
    ...over,
  };
}

function deadRoute(over: Partial<DeadRoute> = {}): DeadRoute {
  return {
    arm: "A",
    residual: "coefficient-only LP",
    reason: "LP slack collapsed",
    killedAtCycle: 30,
    killedByWave: "w30",
    outcome: "died",
    ...over,
  };
}

function banked(over: Partial<BankedResult> = {}): BankedResult {
  return {
    cycle: 12,
    arm: "A",
    statement: "rank-2 theorem C=2",
    artifact: "proofs/rank2",
    tier: "T0",
    verified: true,
    ...over,
  };
}

// ── FRONTIER + OPEN + trail ─────────────────────────────────────────────────

describe("renderBoard FRONTIER + trail", () => {
  test("renders the goal and the live OPEN", () => {
    const out = renderBoard(state());
    expect(out).toContain("FRONTIER");
    expect(out).toContain("prove the conjecture");
    expect(out).toContain("(EX) one existence inequality at rank ≥ 3");
  });

  test("renders the frontier trail in order", () => {
    const out = renderBoard(state());
    expect(out).toContain("trail:");
    // trail arrows preserve the reduction sequence
    expect(out).toContain("Kernel");
    expect(out).toContain("(TREE)");
    expect(out).toContain("(SB)");
    const trailIdx = out.indexOf("trail:");
    const treeIdx = out.indexOf("(TREE)", trailIdx);
    const sbIdx = out.indexOf("(SB)", trailIdx);
    expect(treeIdx).toBeGreaterThan(-1);
    expect(sbIdx).toBeGreaterThan(treeIdx);
  });

  test("a single-entry trail (no reductions yet) omits the trail clause", () => {
    const out = renderBoard(state({ frontierTrail: ["(EX) one existence inequality at rank ≥ 3"] }));
    expect(out).not.toContain("trail:");
  });
});

// ── BANKED block ─────────────────────────────────────────────────────────────

describe("renderBoard BANKED", () => {
  test("lists banked statements when present", () => {
    const out = renderBoard(state({ banked: [banked()] }));
    expect(out).toContain("BANKED");
    expect(out).toContain("rank-2 theorem C=2");
  });
});

// ── ARMS one line each ───────────────────────────────────────────────────────

describe("renderBoard ARMS", () => {
  test("renders one line per arm with priority, pulls, strip, best tier, target", () => {
    const out = renderBoard(state());
    expect(out).toContain("ARMS");
    expect(out).toContain("A"); // arm id
    expect(out).toContain("primary");
    expect(out).toContain("6 pulls");
    expect(out).toContain("▣△✗✗——"); // glyph strip
    expect(out).toContain("T0"); // best tier
    expect(out).toContain("(EX)"); // target
  });

  test("an untried arm renders ?? and not a pull count", () => {
    const untried = arm({
      id: "C",
      desc: "numerics",
      priority: "exploratory",
      target: null,
      pulls: 0,
      strip: "",
      bestTier: null,
      bestClass: null,
      stale: 0,
      distinctFamilies: 0,
      status: "untried",
      aggP: null,
      lastResidual: null,
    });
    const out = renderBoard(state({ arms: [arm(), untried] }));
    expect(out).toContain("??");
    // The untried arm's line carries the ?? marker
    const lines = out.split("\n");
    const cLine = lines.find((l) => /\bC\b/.test(l) && l.includes("??"));
    expect(cLine).toBeDefined();
  });

  test("best tier renders ?? when untried (no rung reached)", () => {
    const untried = arm({ id: "C", pulls: 0, strip: "", bestTier: null, status: "untried" });
    const out = renderBoard(state({ arms: [untried] }));
    expect(out).toContain("??");
  });

  test("a stalled arm surfaces the stale count and distinctFamilies (factual)", () => {
    const out = renderBoard(state());
    // factual residual-survival phrasing, e.g. "stalled ×2" and family count
    expect(out).toMatch(/stalled.*2|×\s*2|x2/i);
  });

  test("aggregated P(true) renders when present (advisory) and is hidden when null", () => {
    const withP = renderBoard(state({ arms: [arm({ id: "A", aggP: 0.83 })] }));
    expect(withP).toContain("P~0.83");
    const noP = renderBoard(state({ arms: [arm({ id: "A", aggP: null })] }));
    expect(noP).not.toContain("P~");
  });

  test("long residual/note truncates on a WORD boundary, not mid-word", () => {
    const long = "the Schmidt rank two constraint is non convex and not unitarily invariant";
    const out = renderBoard(state({ arms: [arm({ id: "A", status: "warm", lastResidual: long })] }));
    const shown = out.split("\n").find((l) => l.includes("…"))!;
    // the clipped text (between "residual " and "…") must end at a full word
    const clip = shown.slice(shown.indexOf("residual ") + 9, shown.indexOf("…")).trim();
    expect(long.startsWith(clip)).toBe(true); // a clean prefix
    expect(long[clip.length]).toBe(" "); // and it stopped exactly at a word boundary
  });
});

// ── DEAD ROUTES tail ─────────────────────────────────────────────────────────

describe("renderBoard DEAD ROUTES", () => {
  test("renders a dead-routes tail listing residuals", () => {
    const out = renderBoard(state({ deadRoutes: [deadRoute(), deadRoute({ residual: "universal C≤2", killedByWave: "w33" })] }));
    expect(out).toContain("DEAD ROUTES");
    expect(out).toContain("coefficient-only LP");
    expect(out).toContain("universal C≤2");
  });

  test("dead routes are capped at maxDead (default 6)", () => {
    const many: DeadRoute[] = Array.from({ length: 10 }, (_, i) =>
      deadRoute({ residual: `R${i}`, killedAtCycle: i }),
    );
    const out = renderBoard(state({ deadRoutes: many }));
    // only 6 residuals appear (R0..R5); R9 truncated
    expect(out).toContain("R0");
    expect(out).not.toContain("R9");
  });

  test("no DEAD ROUTES block when there are none", () => {
    const out = renderBoard(state({ deadRoutes: [] }));
    expect(out).not.toContain("DEAD ROUTES");
  });
});

// ── DISCOVERIES tail (D1) ────────────────────────────────────────────────────

describe("renderBoard DISCOVERIES", () => {
  function discovery(over: Partial<Discovery> = {}): Discovery {
    return {
      cycle: 41,
      observation: "diagonal is row-stochastic",
      question: "what would falsify it",
      class: "side",
      tier: "T1",
      artifact: "obs/diag",
      reuse: 2,
      learningProgress: false,
      surprise: false,
      status: "parked",
      ...over,
    };
  }

  test("renders a discoveries tail with ⟡, the observation, class/tier and reuse×N", () => {
    const out = renderBoard(state({ discoveries: [discovery()] }));
    expect(out).toContain("DISCOVERIES");
    expect(out).toContain("⟡");
    expect(out).toContain("diagonal is row-stochastic");
    expect(out).toContain("reuse×2");
  });

  test("no DISCOVERIES block when there are none", () => {
    expect(renderBoard(state({ discoveries: [] }))).not.toContain("DISCOVERIES");
  });

  test("the discoveries block stays factual (no imperatives)", () => {
    const out = renderBoard(
      state({ discoveries: [discovery(), discovery({ observation: "spectral gap tracks δ²", reuse: 0 })] }),
    );
    expect(out).not.toMatch(/\b(must|should|switch now|you need to)\b/i);
  });

  test("shows ⟲ for a learning-progress discovery", () => {
    const out = renderBoard(state({ discoveries: [discovery({ learningProgress: true })] }));
    expect(out).toContain("⟲");
  });

  test("only PARKED discoveries appear in the tail — decayed/promoted are hidden", () => {
    const out = renderBoard(
      state({
        discoveries: [
          discovery({ observation: "kept parked" }),
          discovery({ observation: "aged out", status: "decayed" }),
          discovery({ observation: "became an arm", status: "promoted-arm" }),
        ],
      }),
    );
    expect(out).toContain("kept parked");
    expect(out).not.toContain("aged out");
    expect(out).not.toContain("became an arm");
  });
});

// ── NO-WAVE TURNS (orient) tail ──────────────────────────────────────────────

describe("orient turns tail", () => {
  test("renders a NO-WAVE TURNS count when orientTurns > 0", () => {
    expect(renderBoard(state({ orientTurns: 3 }))).toContain("NO-WAVE TURNS: ×3");
  });

  test("no NO-WAVE line when orientTurns is 0", () => {
    expect(renderBoard(state({ orientTurns: 0 }))).not.toContain("NO-WAVE TURNS");
  });
});

// ── FACTUAL PHRASING (the load-bearing anti-injection assertion) ─────────────

describe("renderBoard factual phrasing (no imperatives)", () => {
  test("the rendered board contains no imperative tokens", () => {
    // A richly-populated board: arms, dead routes, banked, a stalled arm.
    const out = renderBoard(
      state({
        arms: [arm(), arm({ id: "B", priority: "support", status: "warm", pulls: 2, strip: "△✗", target: "(SB)" }), arm({ id: "C", pulls: 0, strip: "", status: "untried", target: null, bestTier: null })],
        deadRoutes: [deadRoute(), deadRoute({ residual: "Jensen/convexity", killedByWave: "w33" })],
        banked: [banked()],
      }),
    );
    // The PRD §8 anti-injection rule: factual state only, no imperative verbs.
    expect(out).not.toMatch(/\b(must|should|switch now|you need to)\b/i);
  });

  test("even a maximally-stalled board stays factual", () => {
    const out = renderBoard(
      state({ arms: [arm({ stale: 5, status: "stalled", distinctFamilies: 3 })] }),
    );
    expect(out).not.toMatch(/\b(must|should|switch now|you need to)\b/i);
  });
});

// ── maxArms truncation ───────────────────────────────────────────────────────

describe("renderBoard maxArms", () => {
  test("caps the number of arm lines at maxArms", () => {
    const arms = Array.from({ length: 5 }, (_, i) => arm({ id: `arm${i}` }));
    const out = renderBoard(state({ arms }), { maxArms: 2 });
    expect(out).toContain("arm0");
    expect(out).toContain("arm1");
    expect(out).not.toContain("arm4");
  });
});

// ── promptHook (exact shape) ─────────────────────────────────────────────────

describe("promptHook", () => {
  test("wraps text as UserPromptSubmit additionalContext by default", () => {
    const out = promptHook("BOARD TEXT");
    expect(out).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "BOARD TEXT",
      },
    });
  });

  test("honours an explicit SessionStart event", () => {
    const out = promptHook("BOARD TEXT", "SessionStart");
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toBe("BOARD TEXT");
  });

  test("serializes to valid JSON (hook stdout contract)", () => {
    const out = promptHook(renderBoard(state()));
    const round = JSON.parse(JSON.stringify(out));
    expect(round.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  });
});

// ── stopPass / stopBlock / stopSoft (exact shapes) ───────────────────────────

describe("stop hook outputs", () => {
  test("stopPass is the empty object {}", () => {
    expect(stopPass()).toEqual({});
  });

  test("stopBlock carries decision:'block' and the reason", () => {
    expect(stopBlock("Arm A's residual has survived 2 frontier-non-moving pulls.")).toEqual({
      decision: "block",
      reason: "Arm A's residual has survived 2 frontier-non-moving pulls.",
    });
  });

  test("stopSoft delivers the text as Stop additionalContext (no block)", () => {
    const out = stopSoft("loop guard: reminder text");
    expect(out.decision).toBeUndefined();
    expect(out.hookSpecificOutput).toEqual({
      hookEventName: "Stop",
      additionalContext: "loop guard: reminder text",
    });
  });
});
