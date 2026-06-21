/**
 * frontier (`fr`) — the filesystem edge (IMPURE).
 *
 * Locates `.frontier/` and reads/writes portfolio | log | turn | verdicts.
 * This is the ONLY place in Pillar A that touches the outside world; the pure
 * core (derive.ts) is a function of the values this module produces.
 *
 * Contract: docs/IMPL_PLAN.md §2 (`store.ts`). Types: src/types.ts (imported, never redefined).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Portfolio, LogRecord, TurnState, Verdict } from "./types.ts";

// ── locating .frontier/ ──────────────────────────────────────────────────────

/**
 * Resolve the active `.frontier/` directory:
 *   1. `$CLAUDE_PROJECT_DIR/.frontier` if the env var is set;
 *   2. else walk up from `cwd` looking for an existing `.frontier/`;
 *   3. else `<cwd>/.frontier`.
 */
export function resolveFrontierDir(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): string {
  const fromEnv = env.CLAUDE_PROJECT_DIR;
  if (fromEnv) return path.join(fromEnv, ".frontier");

  let dir = path.resolve(cwd);
  // Walk up to (and including) the filesystem root.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, ".frontier");
    if (isDir(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }
  return path.join(path.resolve(cwd), ".frontier");
}

/** Is `.frontier/` active? — i.e. does `dir/portfolio.json` exist? */
export function isActive(dir: string): boolean {
  return fs.existsSync(path.join(dir, "portfolio.json"));
}

// ── portfolio ────────────────────────────────────────────────────────────────

export function readPortfolio(dir: string): Portfolio {
  return JSON.parse(fs.readFileSync(path.join(dir, "portfolio.json"), "utf8")) as Portfolio;
}

export function writePortfolio(dir: string, p: Portfolio): void {
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, "portfolio.json"), JSON.stringify(p, null, 2) + "\n");
}

// ── log (append-only, one JSON object per line) ──────────────────────────────

export function readLog(dir: string): LogRecord[] {
  const file = path.join(dir, "log.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as LogRecord);
}

export function appendLog(dir: string, rec: LogRecord): void {
  ensureDir(dir);
  // One JSON object per line. appendFileSync never rewrites earlier bytes.
  fs.appendFileSync(path.join(dir, "log.jsonl"), JSON.stringify(rec) + "\n");
}

// ── turn (ephemeral per-turn state) ──────────────────────────────────────────

export function readTurn(dir: string): TurnState {
  const file = path.join(dir, "turn.json");
  if (!fs.existsSync(file)) return { log_len_at_turn_start: 0, blocks_this_turn: 0 };
  return JSON.parse(fs.readFileSync(file, "utf8")) as TurnState;
}

export function writeTurn(dir: string, t: TurnState): void {
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, "turn.json"), JSON.stringify(t, null, 2) + "\n");
}

// ── verdicts (one file per claim/oracle pair) ────────────────────────────────

export function readVerdicts(dir: string): Verdict[] {
  const vdir = path.join(dir, "verdicts");
  if (!isDir(vdir)) return [];
  return fs
    .readdirSync(vdir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(vdir, f), "utf8")) as Verdict);
}

export function writeVerdict(dir: string, v: Verdict): void {
  const vdir = path.join(dir, "verdicts");
  ensureDir(vdir);
  const file = path.join(vdir, `${slug(v.claim)}.${slug(v.oracle)}.json`);
  fs.writeFileSync(file, JSON.stringify(v, null, 2) + "\n");
}

// ── helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Filesystem-safe slug: no path separators or awkward chars. Deterministic. */
function slug(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out === "" ? "_" : out;
}
