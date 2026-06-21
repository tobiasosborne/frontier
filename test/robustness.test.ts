/**
 * robustness.test.ts — defects found by dogfooding `fr` on a live campaign:
 *   (1) `--supersedes` was unreachable from the CLI (retraction couldn't be logged);
 *   (2) `turn-begin` / `board` crashed with a stack trace on a corrupt log, leaking
 *       non-JSON to stdout and breaking the UserPromptSubmit hook (L3 violation).
 * Both are exercised end-to-end through the real CLI. `check` must stay FAIL-CLOSED.
 */
import { test, expect, describe } from "bun:test";
import { mkdtempSync, appendFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ENTRY = path.join(path.resolve(import.meta.dir, ".."), "src/index.ts");

function run(cwd: string, ...args: string[]) {
  const p = Bun.spawnSync(["bun", "run", ENTRY, ...args], {
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
  return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

function freshProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "fr-robust-"));
  run(dir, "init", "test goal");
  run(dir, "arm", "add", "A", "approach A");
  run(dir, "arm", "add", "B", "approach B");
  return dir;
}

describe("--supersedes round-trips (retraction is reachable from the CLI)", () => {
  test("fr log --supersedes N sets supersedes on the appended record", () => {
    const dir = freshProject();
    run(dir, "turn-begin");
    run(dir, "log", "A", "progress", "first", "--artifact", "X", "--decide", "EXPLOIT", "A");
    run(dir, "turn-begin");
    const r = run(dir, "log", "A", "progress", "retract first",
      "--artifact", "X", "--supersedes", "1", "--decide", "EXPLOIT", "A");
    expect(r.code).toBe(0);
    const lines = readFileSync(path.join(dir, ".frontier/log.jsonl"), "utf8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]!);
    expect(last.supersedes).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("fail-soft on a corrupt log (L3 hook hygiene); check stays fail-closed", () => {
  test("board/turn-begin never leak non-JSON to stdout; check still blocks", () => {
    const dir = freshProject();
    appendFileSync(path.join(dir, ".frontier/log.jsonl"), "}{ not json\n");

    // board --hook prompt: stdout MUST be valid JSON, exit 0, no stack trace.
    const b = run(dir, "board", "--hook", "prompt");
    expect(b.code).toBe(0);
    expect(() => JSON.parse(b.stdout)).not.toThrow();
    expect(b.stdout).not.toContain("SyntaxError");

    // turn-begin: exit 0, JSON-silent (no stack trace on stdout) so `&& board` runs.
    const t = run(dir, "turn-begin");
    expect(t.code).toBe(0);
    expect(t.stdout).not.toContain("SyntaxError");
    expect(t.stdout.trim()).toBe("");

    // check --hook stop: FAIL-CLOSED — still BLOCKS on the same corruption.
    const c = run(dir, "check", "--hook", "stop");
    expect(c.code).toBe(0);
    expect(JSON.parse(c.stdout).decision).toBe("block");

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("fr help (progressively discoverable manual)", () => {
  test("`fr help` / bare `fr` print the overview + ritual; exit 0", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fr-help-"));
    const h = run(dir, "help");
    expect(h.code).toBe(0);
    expect(h.stdout).toContain("PER-TURN RITUAL");
    expect(h.stdout).toContain("fr log");
    const bare = run(dir); // no subcommand → overview, exit 0 (not an error)
    expect(bare.code).toBe(0);
    expect(bare.stdout).toContain("explore/exploit");
    rmSync(dir, { recursive: true, force: true });
  });

  test("`fr help <command>` and `fr help <topic>` drill into detail", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fr-help-"));
    expect(run(dir, "help", "log").stdout).toContain("--decide");
    expect(run(dir, "help", "breaker").stdout).toMatch(/stall|PIVOT/);
    expect(run(dir, "help", "bank-gate").stdout).toMatch(/verify|verdict/);
    const bogus = run(dir, "help", "nope");
    expect(bogus.code).toBe(0);
    expect(bogus.stdout).toContain("no help topic"); // points back to the topic list
    rmSync(dir, { recursive: true, force: true });
  });
});
