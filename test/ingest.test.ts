/**
 * ingest.test.ts — the PURE backward-seam classifier `ingestResiduals` (seam-sketch §2.2/§3).
 *
 * The load-bearing invariant: the map from vibefeld state → fr obligations is MONOTONE and
 * NEVER-UPGRADING. Nothing crossing back mints trust — a gap/refutation carries no tier, a
 * taint caps at T2, and NO branch ever yields banked/T0 (the §8 trust-upgrade hole).
 */
import { test, expect, describe } from "bun:test";
import { ingestResiduals, residualRef, newResiduals } from "../src/ingest.ts";
import type { ResidualToken, VibefeldState, VibefeldNode, VibefeldChallenge } from "../src/types.ts";

// ── fixture builders (shape captured from real `af status/challenges --format json`) ──
function node(over: Partial<VibefeldNode> = {}): VibefeldNode {
  return {
    id: "1",
    statement: "some claim",
    epistemic: "validated",
    taint: "clean",
    contentHash: "hash-1",
    isLeaf: true,
    ...over,
  };
}

function chal(over: Partial<VibefeldChallenge> = {}): VibefeldChallenge {
  return { id: "ch-1", nodeId: "1", status: "open", severity: "critical", reason: "gap here", ...over };
}

function state(over: Partial<VibefeldState> = {}): VibefeldState {
  return { afDir: "/proof", nodes: [], challenges: [], ...over };
}

describe("ingestResiduals — refutation", () => {
  test("a refuted node yields one refutation token that lands as a refuted dead-route, no tier", () => {
    const s = state({ nodes: [node({ id: "1.4", epistemic: "refuted", statement: "false lemma" })] });
    const toks = ingestResiduals(s);
    expect(toks).toHaveLength(1);
    expect(toks[0]).toMatchObject({
      kind: "refutation",
      lands: "refuted",
      statement: "false lemma",
      cap: null,
      provenance: { afDir: "/proof", nodeId: "1.4", challengeId: null, contentHash: "hash-1" },
    });
  });

  test("refuted takes precedence over an open challenge on the same node (terminal-false)", () => {
    const s = state({
      nodes: [node({ id: "2", epistemic: "refuted" })],
      challenges: [chal({ nodeId: "2", status: "open", severity: "critical" })],
    });
    const toks = ingestResiduals(s);
    expect(toks).toHaveLength(1);
    expect(toks[0]!.kind).toBe("refutation");
  });
});

describe("ingestResiduals — gap (open blocking challenge)", () => {
  test("an OPEN critical challenge yields a gap token landing as a new arm, no tier", () => {
    const s = state({
      nodes: [node({ id: "1.1", statement: "needs a counting argument" })],
      challenges: [chal({ id: "ch-x", nodeId: "1.1", status: "open", severity: "critical", reason: "not a definition" })],
    });
    const toks = ingestResiduals(s);
    expect(toks).toHaveLength(1);
    expect(toks[0]).toMatchObject({
      kind: "gap",
      lands: "arm",
      statement: "not a definition",
      cap: null,
      provenance: { nodeId: "1.1", challengeId: "ch-x" },
    });
  });

  test("a major open challenge also blocks → gap; a minor open challenge does NOT", () => {
    const major = ingestResiduals(state({
      nodes: [node({ id: "3" })],
      challenges: [chal({ nodeId: "3", status: "open", severity: "major" })],
    }));
    expect(major.map((t) => t.kind)).toEqual(["gap"]);

    const minor = ingestResiduals(state({
      nodes: [node({ id: "3" })],
      challenges: [chal({ nodeId: "3", status: "open", severity: "minor" })],
    }));
    expect(minor).toHaveLength(0); // advisory, not a blocking obligation
  });

  test("a RESOLVED critical challenge yields no gap (only OPEN blocks)", () => {
    const s = state({
      nodes: [node({ id: "4" })],
      challenges: [chal({ nodeId: "4", status: "resolved", severity: "critical" })],
    });
    expect(ingestResiduals(s)).toHaveLength(0);
  });

  test("two open blocking challenges on one node yield two distinct gaps", () => {
    const s = state({
      nodes: [node({ id: "5" })],
      challenges: [
        chal({ id: "ch-a", nodeId: "5", status: "open", severity: "critical" }),
        chal({ id: "ch-b", nodeId: "5", status: "open", severity: "major" }),
      ],
    });
    const toks = ingestResiduals(s);
    expect(toks).toHaveLength(2);
    expect(toks.every((t) => t.kind === "gap")).toBe(true);
    expect(toks.map((t) => t.provenance.challengeId).sort()).toEqual(["ch-a", "ch-b"]);
  });
});

describe("ingestResiduals — taint (admitted/tainted leaf)", () => {
  test("an admitted leaf yields a taint token landing as a discovery, CAPPED at T2 (trust conservation)", () => {
    const s = state({ nodes: [node({ id: "6", epistemic: "admitted", taint: "self_admitted", statement: "admitted lemma" })] });
    const toks = ingestResiduals(s);
    expect(toks).toHaveLength(1);
    expect(toks[0]).toMatchObject({ kind: "taint", lands: "discovery", statement: "admitted lemma", cap: "T2" });
  });

  test("a leaf tainted by an admitted ANCESTOR (validated itself) still yields a capped taint token", () => {
    const s = state({ nodes: [node({ id: "7", epistemic: "validated", taint: "tainted" })] });
    expect(ingestResiduals(s).map((t) => ({ kind: t.kind, cap: t.cap }))).toEqual([{ kind: "taint", cap: "T2" }]);
  });

  test("a tainted INTERIOR node (has children) yields NO taint — only leaf lemmas cross back", () => {
    const s = state({ nodes: [node({ id: "8", epistemic: "admitted", taint: "self_admitted", isLeaf: false })] });
    expect(ingestResiduals(s)).toHaveLength(0);
  });

  test("a clean validated leaf yields nothing (a healthy proof produces no obligations)", () => {
    const s = state({ nodes: [node({ id: "9", epistemic: "validated", taint: "clean" })] });
    expect(ingestResiduals(s)).toHaveLength(0);
  });

  test("an `unresolved` (pending-ancestor) leaf is NOT taint — it is work-in-progress, not admitted", () => {
    const s = state({ nodes: [node({ id: "10", epistemic: "pending", taint: "unresolved" })] });
    expect(ingestResiduals(s)).toHaveLength(0);
  });
});

describe("ingestResiduals — the never-upgrade invariant", () => {
  test("NO token from ANY vibefeld state ever mints banked/T0 trust (cap ∈ {T2, null})", () => {
    const s = state({
      nodes: [
        node({ id: "1", epistemic: "refuted" }),
        node({ id: "2", epistemic: "admitted", taint: "self_admitted" }),
        node({ id: "3" }),
        node({ id: "4", epistemic: "validated", taint: "clean" }),
      ],
      challenges: [chal({ nodeId: "3", status: "open", severity: "critical" })],
    });
    const toks = ingestResiduals(s);
    expect(toks.length).toBeGreaterThan(0);
    for (const t of toks) {
      expect(t.cap === null || t.cap === "T2").toBe(true);
      expect(t.cap).not.toBe("T0");
      expect(t.lands).not.toBe("banked" as never); // there is no banked landing
    }
  });

  test("determinism: same input → same token order", () => {
    const s = state({
      nodes: [node({ id: "1", epistemic: "refuted" }), node({ id: "2", epistemic: "admitted", taint: "self_admitted" })],
    });
    expect(ingestResiduals(s)).toEqual(ingestResiduals(s));
  });
});

// ── idempotency: residualRef (the provenance key) + newResiduals (the filter) ──
function token(over: Partial<ResidualToken> = {}): ResidualToken {
  return {
    kind: "taint",
    statement: "s",
    lands: "discovery",
    provenance: { afDir: "/p", nodeId: "1.3", challengeId: null, contentHash: "hc" },
    cap: "T2",
    ...over,
  };
}

describe("residualRef — the content-bound idempotency key", () => {
  test("binds nodeId + challengeId + contentHash (a taint keys on its node)", () => {
    const r = residualRef(token({ provenance: { afDir: "/p", nodeId: "1.3", challengeId: null, contentHash: "abc" } }));
    expect(r).toContain("1.3");
    expect(r).toContain("abc");
  });

  test("a gap on the same node but a DIFFERENT challenge gets a DISTINCT ref", () => {
    const a = residualRef(token({ kind: "gap", provenance: { afDir: "/p", nodeId: "1", challengeId: "ch-a", contentHash: "h" } }));
    const b = residualRef(token({ kind: "gap", provenance: { afDir: "/p", nodeId: "1", challengeId: "ch-b", contentHash: "h" } }));
    expect(a).not.toBe(b);
  });

  test("a CHANGED node (new contentHash) gets a NEW ref → it will re-ingest, not dedupe", () => {
    const before = residualRef(token({ provenance: { afDir: "/p", nodeId: "1.3", challengeId: null, contentHash: "h1" } }));
    const after = residualRef(token({ provenance: { afDir: "/p", nodeId: "1.3", challengeId: null, contentHash: "h2" } }));
    expect(before).not.toBe(after);
  });
});

describe("newResiduals — drops already-ingested tokens", () => {
  test("keeps only tokens whose ref is not among the existing from_vibefeld refs", () => {
    const t1 = token({ provenance: { afDir: "/p", nodeId: "1.3", challengeId: null, contentHash: "h1" } });
    const t2 = token({ provenance: { afDir: "/p", nodeId: "1.4", challengeId: null, contentHash: "h2" } });
    const existing = new Set([residualRef(t1)]);
    expect(newResiduals([t1, t2], existing)).toEqual([t2]);
  });

  test("re-ingest of an unchanged set is a no-op (all refs already present)", () => {
    const t1 = token();
    const t2 = token({ kind: "gap", provenance: { afDir: "/p", nodeId: "1", challengeId: "ch", contentHash: "h" } });
    const existing = new Set([t1, t2].map(residualRef));
    expect(newResiduals([t1, t2], existing)).toEqual([]);
  });
});
