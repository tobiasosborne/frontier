/**
 * cli.ts — argv → command dispatch (IMPURE edge, Pillar C).
 *
 * The focused dispatcher: resolve `.frontier/`, route the subcommand to its handler in
 * commands.ts, return the exit code. `now` is injected by index.ts (the single clock call site,
 * keeping everything downstream deterministic). Argv parsing + io writers live in cliutil.ts;
 * the handlers live in commands.ts.
 *
 * Contract: docs/IMPL_PLAN.md §2 (`cli.ts`). Types: src/types.ts (imported, never redefined).
 */
import { resolveFrontierDir } from "./store";
import { err, out } from "./cliutil";
import { help } from "./help";
import {
  cmdInit,
  cmdArm,
  cmdFrontier,
  cmdLog,
  cmdDiscover,
  cmdFork,
  cmdVerify,
  cmdBoard,
  cmdCheck,
  cmdTurnBegin,
  cmdStatus,
} from "./commands";

export function run(argv: string[], now: string): number {
  const [cmd, ...rest] = argv;
  const dir = resolveFrontierDir();

  switch (cmd) {
    case "init":
      return cmdInit(dir, rest);
    case "arm":
      return cmdArm(dir, rest);
    case "frontier":
      return cmdFrontier(dir, rest);
    case "log":
      return cmdLog(dir, rest, now);
    case "discover":
      return cmdDiscover(dir, rest, now);
    case "fork":
      return cmdFork(dir, rest, now);
    case "verify":
      return cmdVerify(dir, rest, now);
    case "board":
      return cmdBoard(dir, rest);
    case "check":
      return cmdCheck(dir, rest);
    case "turn-begin":
      return cmdTurnBegin(dir);
    case "status":
      return cmdStatus(dir);
    case "help":
    case "--help":
    case "-h":
    case undefined: {
      const h = help(rest[0]);
      out(h.text);
      return h.code;
    }
    default:
      err(`unknown command '${cmd}'. Run \`fr help\` for the CLI surface.`);
      return 2;
  }
}
