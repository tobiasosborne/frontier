/**
 * cliutil.ts — stdout/stderr writers + argv parsing for the CLI edge (Pillar C).
 *
 * Tiny shared surface used by cli.ts (dispatch) and commands.ts (handlers). Kept separate so
 * cli.ts stays a focused dispatcher and the command handlers stay in commands.ts (no cycle).
 */

/** A single trailing-newline line to stdout. Hook paths emit ONLY JSON through here (L3). */
export const out = (s: string): void => void process.stdout.write(s + "\n");
/** All diagnostics go to stderr so hook stdout stays JSON-clean (L3). */
export const err = (s: string): void => void process.stderr.write(s + "\n");

export interface Parsed {
  pos: string[];
  flags: Record<string, string>;
  workers: string[];
}

/**
 * Parse `<positionals> --flag value … --worker m:r … --decide <TYPE> <next-arm>`.
 * `--worker` repeats into `workers`; `--decide` consumes TWO values (PRD §6 surface), the
 * second stored as `flags["decide-arm"]`. A flag with no following value is "".
 */
export function parseArgs(args: string[]): Parsed {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  const workers: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = args[i + 1] !== undefined && !args[i + 1]!.startsWith("--") ? args[++i]! : "";
      if (key === "worker") {
        workers.push(val);
      } else if (key === "decide") {
        flags.decide = val;
        if (args[i + 1] !== undefined && !args[i + 1]!.startsWith("--")) flags["decide-arm"] = args[++i]!;
      } else {
        flags[key] = val;
      }
    } else {
      pos.push(a);
    }
  }
  return { pos, flags, workers };
}
