/**
 * vibefeld.ts — the backward-seam ingest EDGE (IMPURE, Pillar C).
 *
 * `readVibefeldState` runs `af` as an oracle of a richer return type (seam-sketch §0/§6): it
 * spawns `af status --format json` + `af challenges --format json` against a vibefeld workspace
 * and hands the parsed `VibefeldState` to the PURE classifier (`ingest.ts`). The `af` binary is
 * resolved from `$FR_AF_BIN` (default `af`) so a deployment can point at an absolute path and a
 * test can point at a stub.
 *
 * `parseVibefeldState` is a PURE function of two JSON strings (it lives here beside its runner,
 * like oracle.ts's pure `isStale`/`currentVerdicts`) — no fs/clock/env — so it is unit-testable
 * against captured `af` JSON. It degrades gracefully: unparseable input → empty arrays, never a
 * throw (the pure core never sees garbage).
 *
 * The pure core NEVER imports `af`. Contract: docs/IMPL_PLAN.md §11. Types: src/types.ts.
 */
import type {
  VibefeldChallenge,
  VibefeldEpistemic,
  VibefeldNode,
  VibefeldState,
  VibefeldTaint,
} from "./types.ts";

/** Parse JSON, returning `{}` on any failure (empty/garbage → empty state, never a throw). */
function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A node is a LEAF iff no other node's id is a `${id}.`-prefixed descendant. */
function computeIsLeaf(id: string, allIds: string[]): boolean {
  const prefix = id + ".";
  return !allIds.some((other) => other.startsWith(prefix));
}

/** PURE: map `af status`/`af challenges` JSON → the seam's VibefeldState. seam-sketch §6. */
export function parseVibefeldState(
  statusJSON: string,
  challengesJSON: string,
  afDir: string,
): VibefeldState {
  const rawNodes = (safeParse(statusJSON).nodes as Record<string, unknown>[] | undefined) ?? [];
  const allIds = rawNodes.map((n) => String(n.id ?? ""));
  const nodes: VibefeldNode[] = rawNodes.map((n) => {
    const id = String(n.id ?? "");
    return {
      id,
      statement: String(n.statement ?? ""),
      epistemic: (n.epistemic_state as VibefeldEpistemic) ?? "pending",
      taint: (n.taint_state as VibefeldTaint) ?? "clean",
      contentHash: String(n.content_hash ?? ""),
      isLeaf: computeIsLeaf(id, allIds),
    };
  });

  const rawChals =
    (safeParse(challengesJSON).challenges as Record<string, unknown>[] | undefined) ?? [];
  const challenges: VibefeldChallenge[] = rawChals.map((c) => ({
    id: String(c.id ?? ""),
    nodeId: String(c.node_id ?? ""),
    status: (c.status as VibefeldChallenge["status"]) ?? "open",
    severity: (c.severity as VibefeldChallenge["severity"]) ?? "minor",
    reason: String(c.reason ?? ""),
  }));

  return { afDir, nodes, challenges };
}

/** The `af` binary to run — an absolute path in deployment, a stub in tests. */
function afBin(): string {
  return process.env.FR_AF_BIN || "af";
}

/** Run `af <sub> --dir <afDir> --format json`, returning stdout. Throws on spawn/exit failure. */
function runAf(sub: string, afDir: string): string {
  let proc;
  try {
    proc = Bun.spawnSync([afBin(), sub, "--dir", afDir, "--format", "json"], {
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    throw new Error(`could not run '${afBin()}' — is vibefeld installed / on PATH (or set $FR_AF_BIN)?`);
  }
  if (!proc.success) {
    const msg = proc.stderr.toString().trim();
    throw new Error(`\`af ${sub}\` failed for ${afDir}${msg ? `: ${msg}` : ""}`);
  }
  return proc.stdout.toString();
}

/** IMPURE: run `af` against a vibefeld workspace and parse its derived state. seam-sketch §6. */
export function readVibefeldState(afDir: string): VibefeldState {
  const status = runAf("status", afDir);
  const challenges = runAf("challenges", afDir);
  return parseVibefeldState(status, challenges, afDir);
}
