/**
 * vibefeld.test.ts — the ingest EDGE's pure JSON→VibefeldState parser (seam-sketch §6).
 *
 * `parseVibefeldState` maps the output of `af status --format json` + `af challenges --format
 * json` into the seam's `VibefeldState`, deriving each node's leaf-ness from the id tree. It is
 * pure (lives in the impure edge module like oracle.ts's `isStale`/`currentVerdicts`, but touches
 * nothing external), so it is unit-tested directly. Fixtures mirror the REAL af JSON shape
 * (captured from `../vibefeld/af status --format json`).
 */
import { test, expect, describe } from "bun:test";
import { parseVibefeldState } from "../src/vibefeld.ts";
import { ingestResiduals } from "../src/ingest.ts";

// Real-shape status JSON: a healthy sub-proof, all validated/clean.
const HEALTHY_STATUS = JSON.stringify({
  statistics: { total_nodes: 3, epistemic_state: { validated: 3 }, taint_state: { clean: 3 } },
  nodes: [
    { id: "1", type: "claim", statement: "root", epistemic_state: "validated", taint_state: "clean", content_hash: "h1" },
    { id: "1.1", type: "claim", statement: "step a", epistemic_state: "validated", taint_state: "clean", content_hash: "h11" },
    { id: "1.2", type: "claim", statement: "step b", epistemic_state: "validated", taint_state: "clean", content_hash: "h12" },
  ],
});
const HEALTHY_CHALLENGES = JSON.stringify({ challenges: [] });

// Real-shape status JSON: a sick proof — an open-challenged interior node, a refuted leaf,
// an admitted leaf.
const SICK_STATUS = JSON.stringify({
  statistics: { total_nodes: 4 },
  nodes: [
    { id: "1", statement: "root", epistemic_state: "pending", taint_state: "unresolved", content_hash: "r" },
    { id: "1.1", statement: "needs counting argument", epistemic_state: "pending", taint_state: "unresolved", content_hash: "a" },
    { id: "1.2", statement: "false lemma", epistemic_state: "refuted", taint_state: "clean", content_hash: "b" },
    { id: "1.3", statement: "admitted on faith", epistemic_state: "admitted", taint_state: "self_admitted", content_hash: "c" },
  ],
});
const SICK_CHALLENGES = JSON.stringify({
  challenges: [
    { id: "ch-1", node_id: "1.1", status: "open", severity: "critical", reason: "not a definition — needs a counting argument" },
  ],
});

describe("parseVibefeldState — nodes", () => {
  test("maps af field names to the seam's VibefeldNode shape", () => {
    const s = parseVibefeldState(HEALTHY_STATUS, HEALTHY_CHALLENGES, "/proof");
    expect(s.afDir).toBe("/proof");
    expect(s.nodes).toHaveLength(3);
    expect(s.nodes[1]).toMatchObject({
      id: "1.1",
      statement: "step a",
      epistemic: "validated",
      taint: "clean",
      contentHash: "h11",
    });
  });

  test("derives isLeaf from the id tree: a node with a `<id>.` descendant is NOT a leaf", () => {
    const s = parseVibefeldState(HEALTHY_STATUS, HEALTHY_CHALLENGES, "/proof");
    const byId = Object.fromEntries(s.nodes.map((n) => [n.id, n]));
    expect(byId["1"]!.isLeaf).toBe(false); // has children 1.1, 1.2
    expect(byId["1.1"]!.isLeaf).toBe(true);
    expect(byId["1.2"]!.isLeaf).toBe(true);
  });
});

describe("parseVibefeldState — challenges", () => {
  test("maps node_id→nodeId and preserves status/severity/reason", () => {
    const s = parseVibefeldState(SICK_STATUS, SICK_CHALLENGES, "/proof");
    expect(s.challenges).toHaveLength(1);
    expect(s.challenges[0]).toMatchObject({
      id: "ch-1",
      nodeId: "1.1",
      status: "open",
      severity: "critical",
    });
  });
});

describe("parseVibefeldState — end to end into the classifier", () => {
  test("a HEALTHY proof (all validated/clean) yields NO fr obligations", () => {
    const s = parseVibefeldState(HEALTHY_STATUS, HEALTHY_CHALLENGES, "/proof");
    expect(ingestResiduals(s)).toHaveLength(0);
  });

  test("a SICK proof yields exactly a gap + a refutation + a taint", () => {
    const s = parseVibefeldState(SICK_STATUS, SICK_CHALLENGES, "/proof");
    const kinds = ingestResiduals(s).map((t) => t.kind).sort();
    expect(kinds).toEqual(["gap", "refutation", "taint"]);
  });

  test("missing/empty challenges JSON degrades to no challenges (never throws)", () => {
    const s = parseVibefeldState(HEALTHY_STATUS, "", "/proof");
    expect(s.challenges).toEqual([]);
  });
});
