#!/usr/bin/env node
/** Runs api + admin + provider-mock together for development. */
import { spawn } from "node:child_process";

const procs = [];
function run(name, color, cmd, args, opts = {}) {
  const p = spawn(cmd, args, { shell: true, stdio: ["ignore", "pipe", "pipe"], ...opts });
  const paint = (stream, isError) => {
    const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
    stream.pipe(process.stdout !== process.stdout ? process.stdout : process.stdout, { end: false });
    return (chunk) => process.stdout.write(String(chunk).split("\n").filter(Boolean).map((l) => prefix + l).join("\n") + "\n");
  };
  p.stdout.on("data", paint(p.stdout));
  p.stderr.on("data", paint(p.stderr));
  procs.push(p);
  console.log(`▶ ${name}: ${cmd} ${args.join(" ")}`);
}

const colors = { api: "36", admin: "35", provider: "33" };
run("api", colors.api, "pnpm", ["-F", "@sm-live/api", "dev"]);
run("admin", colors.admin, "pnpm", ["-F", "@sm-live/admin", "dev"]);
run("provider", colors.provider, "pnpm", ["-F", "@sm-live/provider-mock", "dev"]);

const shutdown = () => {
  console.log("\nshutting down…");
  for (const p of procs) {
    try { p.kill("SIGTERM"); } catch {}
  }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
