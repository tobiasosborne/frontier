/**
 * ingest.ts — the PURE backward-seam classifier (Pillar A / L4).
 *
 * `ingestResiduals(state) → ResidualToken[]`: maps a vibefeld workspace's derived state into the
 * fr obligations it reopens (seam-sketch §2.2). This is a MONOTONE, NEVER-UPGRADING map — the
 * same "signal may only downgrade" invariant fr enforces internally, now closed across the seam:
 *   - a `refuted` node → a `refutation` (a dead-route that sharpens fr's frontier by elimination),
 *   - an open critical/major challenge → a `gap` (a fresh open — banks nothing, no tier),
 *   - an admitted/tainted LEAF → a `taint` (a lemma other arms may cite), CAPPED at T2 so it can
 *     NEVER support a banked/T0 fr result (trust conservation, seam-sketch §3; the §8 hole).
 *
 * `crack` (a critical gap in a node fr had BANKED → supersession) is deferred to the write
 * increment — it needs the cross-ledger join to fr's banked ledger (the credit-assignment loop).
 *
 * PURE and deterministic: NO fs / clock / env / network. Contract: docs/IMPL_PLAN.md §11.
 */
import type { ResidualToken, VibefeldNode, VibefeldState } from "./types.ts";

/** Challenge severities that BLOCK acceptance and therefore return as a `gap` obligation. */
const BLOCKING = new Set(["critical", "major"]);

/** A leaf carries unearned trust iff it was admitted itself or inherits taint from an admitted ancestor. */
function isTaintedLeaf(n: VibefeldNode): boolean {
  if (!n.isLeaf) return false; // only leaf lemmas cross back as citable discoveries
  return n.epistemic === "admitted" || n.taint === "self_admitted" || n.taint === "tainted";
}

export function ingestResiduals(state: VibefeldState): ResidualToken[] {
  const { afDir, nodes, challenges } = state;
  const tokens: ResidualToken[] = [];

  for (const n of nodes) {
    const prov = (challengeId: string | null) => ({
      afDir,
      nodeId: n.id,
      challengeId,
      contentHash: n.contentHash,
    });

    // refuted is terminal-false and takes precedence: the route is dead, not merely challenged.
    if (n.epistemic === "refuted") {
      tokens.push({ kind: "refutation", statement: n.statement, lands: "refuted", provenance: prov(null), cap: null });
      continue;
    }

    // open blocking challenges → one gap obligation each (each is a distinct open to attack).
    const blocking = challenges.filter(
      (c) => c.nodeId === n.id && c.status === "open" && BLOCKING.has(c.severity),
    );
    if (blocking.length > 0) {
      for (const c of blocking) {
        tokens.push({ kind: "gap", statement: c.reason, lands: "arm", provenance: prov(c.id), cap: null });
      }
      continue;
    }

    // a settled-but-tainted leaf → a citable discovery, capped so it can't launder into banked/T0.
    if (isTaintedLeaf(n)) {
      tokens.push({ kind: "taint", statement: n.statement, lands: "discovery", provenance: prov(null), cap: "T2" });
    }
  }

  return tokens;
}
