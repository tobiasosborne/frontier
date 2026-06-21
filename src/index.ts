/**
 * index.ts — the `fr` entrypoint (IMPURE edge, Pillar C).
 *
 * Thin shim: inject the clock once (`now`), hand argv to the dispatcher, set the exit code.
 * All real work is in cli.ts. Kept trivial so the compiled binary's hot path stays minimal
 * (no heavy import at startup — L3 / PRD §11).
 */
import { run } from "./cli";

const now = new Date().toISOString();
process.exitCode = run(process.argv.slice(2), now);
