/**
 * oracle.ts — the verify edge (IMPURE, Pillar C).
 *
 * `runOracle` is the ONLY path that executes an external check (PRD §7): it spawns the
 * registered command as argv with NO shell, feeding the claim text on stdin. Exit 0 → pass,
 * non-zero → fail, spawn failure → error. A failing/erroring oracle can NEVER be upgraded to
 * pass — signal may only downgrade (anti-gaming principle).
 *
 * Each verdict is scrubbed (hashes + pass/fail only) and hash-bound to claim_hash +
 * oracle_digest + inputs_hash, so it goes STALE when the claim text, the oracle command, or
 * its inputs change (PRD §5 / §7). `isStale` recomputes claim_hash and compares.
 *
 * STALENESS IS RESOLVED AT THE EDGE: `currentVerdicts` filters to non-stale verdicts. The CLI
 * passes ONLY current verdicts into the pure derive/referee, so the core keeps the invariant
 * "a verdict's presence === it is current" and stays pure (no fs/clock inside derive/referee).
 *
 * This module writes nothing — the CLI persists via store.writeVerdict.
 *
 * Contract: docs/IMPL_PLAN.md §2 (`oracle.ts`). Types: src/types.ts (imported, never redefined).
 */

import * as fs from "node:fs";
import type { OracleConfig, Verdict } from "./types";

/** sha256 hex of a string. Bun ships CryptoHasher; deterministic, no deps. */
function sha256(s: string): string {
  return new Bun.CryptoHasher("sha256").update(s).digest("hex");
}

/** Concatenate input file contents (in declared order); "" when no inputs / unreadable. */
function readInputs(inputs: string[] | undefined): string {
  if (!inputs || inputs.length === 0) return "";
  let acc = "";
  for (const f of inputs) {
    try {
      acc += fs.readFileSync(f, "utf8");
    } catch {
      // A missing input file folds into the hash as nothing — its absence is itself a state
      // change that will (correctly) shift the digest relative to a run where it existed.
    }
  }
  return acc;
}

export function runOracle(
  claim: string,
  oracle: OracleConfig,
  claimText: string,
  now: string,
): Verdict {
  const claim_hash = sha256(claimText);
  const oracle_digest = sha256(oracle.cmd.join(" "));
  const inputs_hash = sha256(readInputs(oracle.inputs));

  let result: Verdict["result"];
  try {
    const proc = Bun.spawnSync(oracle.cmd, {
      stdin: Buffer.from(claimText),
      stdout: "ignore",
      stderr: "ignore",
    });
    // `success` is true iff the process spawned AND exited 0.
    if (!proc.success && proc.exitCode === null) {
      // spawned but killed by a signal — treat as a failed check, not a spawn error.
      result = "fail";
    } else {
      result = proc.exitCode === 0 ? "pass" : "fail";
    }
  } catch {
    // Bun.spawnSync throws when the binary cannot be found / executed.
    result = "error";
  }

  return { claim, oracle: oracle.name, result, claim_hash, oracle_digest, inputs_hash, ts: now };
}

/** A verdict is stale iff the live claim text no longer hashes to its recorded claim_hash. */
export function isStale(v: Verdict, claimText: string): boolean {
  return sha256(claimText) !== v.claim_hash;
}

/**
 * Filter to the CURRENT (non-stale) verdicts. `resolveClaimText(claim)` returns the live claim
 * text for a verdict's claim, or null when it can't be resolved (then the verdict is dropped as
 * stale — an unresolvable claim cannot back a `banked`). Called at the CLI edge before derive/check.
 */
export function currentVerdicts(
  verdicts: Verdict[],
  resolveClaimText: (claim: string) => string | null,
): Verdict[] {
  return verdicts.filter((v) => {
    const text = resolveClaimText(v.claim);
    if (text == null) return false;
    return !isStale(v, text);
  });
}
