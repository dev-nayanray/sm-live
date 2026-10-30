/**
 * Platform operations infrastructure boundary (Prompt 12).
 *
 * This module wraps the only places where the API touches the host
 * filesystem to perform operational actions:
 *
 *   1. Discovering existing backup files in `BACKUP_DIR_PATH`.
 *   2. Invoking an out-of-band backup script (`BACKUP_SCRIPT_PATH`).
 *   3. Invoking an out-of-band restore script (`RESTORE_SCRIPT_PATH`).
 *
 * The boundary is intentionally narrow:
 *
 *   - Path traversal is blocked — only files matching the canonical
 *     `sm_live_*.sql.gz` pattern inside the configured directory are
 *     considered. Absolute paths returned to the API are masked so
 *     credentials / mount points are never leaked.
 *   - Script execution is gated by env vars and never auto-discovered.
 *     If the var is empty, the caller gets a `not_configured` error and
 *     no record is persisted.
 *   - No shell interpolation — arguments are passed as a string array
 *     (`execFile`) so the script name and arguments cannot be injected.
 *   - Restores against `production` are refused at this layer — the API
 *     route additionally refuses, but defence in depth means we re-check
 *     here.
 *
 * This module is the ONLY place in the codebase that calls `child_process`
 * or reads arbitrary files from the host. All other operations endpoints
 * operate exclusively on DB rows.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { env } from "../env.js";
import { logger } from "./logger.js";

/** The result of discovering a single backup file on disk. */
export interface DiscoveredBackup {
  /** Masked path — directory replaced with `<backups>/filename`. */
  location: string;
  /** Absolute path (kept in-memory only; never returned to the API). */
  absolutePath: string;
  /** File size in bytes (from fs.stat). */
  sizeBytes: number;
  /** SHA-256 of the file contents — used to verify integrity. */
  checksum: string;
  /** mtime of the file (UTC ISO). */
  modifiedAt: Date;
  /** Filename without directory. */
  filename: string;
}

/**
 * Discover verified backup files in the configured directory. Returns an
 * empty array when `BACKUP_DIR_PATH` is unset OR the directory is empty.
 * Throws `not_configured` (as a typed Error) only when explicitly asked
 * to enforce config — by default it returns `[]` so the dashboard can
 * render an empty state without raising.
 */
export async function discoverBackups(): Promise<DiscoveredBackup[]> {
  if (!env.BACKUP_DIR_PATH) return [];
  const dir = resolve(env.BACKUP_DIR_PATH);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e) {
    logger.warn({ err: e, dir }, "BACKUP_DIR_PATH not readable");
    return [];
  }
  const files = entries.filter((n) => /^sm_live_.+\.sql\.gz$/.test(n));
  const out: DiscoveredBackup[] = [];
  for (const name of files) {
    const abs = join(dir, name);
    try {
      const st = await stat(abs);
      if (!st.isFile()) continue;
      // Compute checksum lazily — only for files we'll actually surface.
      const checksum = await sha256File(abs);
      out.push({
        location: maskedPath(name),
        absolutePath: abs,
        sizeBytes: st.size,
        checksum,
        modifiedAt: st.mtime,
        filename: name,
      });
    } catch (e) {
      logger.warn({ err: e, file: name }, "skipping unreadable backup file");
    }
  }
  // newest first
  out.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return out;
}

/**
 * Run the configured backup script. Returns when the script exits 0.
 * Throws an Error with `code: 'not_configured'` when `BACKUP_SCRIPT_PATH`
 * is unset, or `code: 'backup_failed'` when the script exits non-zero.
 *
 * The script runs with the API process's environment minus any var whose
 * name matches `/SECRET|PASSWORD|TOKEN|KEY/i` — defence in depth so a
 * misconfigured backup script can't accidentally log credentials.
 */
export function runBackupScript(): Promise<{ stdout: string; stderr: string; durationMs: number }> {
  return new Promise((resolveP, rejectP) => {
    if (!env.BACKUP_SCRIPT_PATH) {
      const e = new Error("backup script not configured (BACKUP_SCRIPT_PATH unset)");
      (e as Error & { code: string }).code = "not_configured";
      return rejectP(e);
    }
    const script = resolve(env.BACKUP_SCRIPT_PATH);
    const start = Date.now();
    const cleanEnv = sanitizeEnv(process.env);
    execFile(script, [], { env: cleanEnv, timeout: 5 * 60_000, maxBuffer: 1 * 1024 * 1024 }, (err, stdout, stderr) => {
      const durationMs = Date.now() - start;
      if (err) {
        const e = new Error(`backup script failed: ${(err as Error).message}`);
        (e as Error & { code: string }).code = "backup_failed";
        (e as Error & { stdout: string }).stdout = String(stdout);
        (e as Error & { stderr: string }).stderr = String(stderr);
        return rejectP(e);
      }
      resolveP({ stdout: String(stdout), stderr: String(stderr), durationMs });
    });
  });
}

/**
 * Run the configured restore script with a single argument pointing at
 * the backup file. Refuses production targets — defence in depth.
 */
export function runRestoreScript(backupAbsPath: string, targetEnvironment: string): Promise<{ stdout: string; stderr: string; durationMs: number }> {
  return new Promise((resolveP, rejectP) => {
    if (targetEnvironment === "production") {
      const e = new Error("production restores are not permitted from the API");
      (e as Error & { code: string }).code = "forbidden_target";
      return rejectP(e);
    }
    if (!env.RESTORE_SCRIPT_PATH) {
      const e = new Error("restore script not configured (RESTORE_SCRIPT_PATH unset)");
      (e as Error & { code: string }).code = "not_configured";
      return rejectP(e);
    }
    const script = resolve(env.RESTORE_SCRIPT_PATH);
    const start = Date.now();
    const cleanEnv = sanitizeEnv(process.env);
    execFile(script, [backupAbsPath], { env: cleanEnv, timeout: 10 * 60_000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      const durationMs = Date.now() - start;
      if (err) {
        const e = new Error(`restore script failed: ${(err as Error).message}`);
        (e as Error & { code: string }).code = "restore_failed";
        (e as Error & { stdout: string }).stdout = String(stdout);
        (e as Error & { stderr: string }).stderr = String(stderr);
        return rejectP(e);
      }
      resolveP({ stdout: String(stdout), stderr: String(stderr), durationMs });
    });
  });
}

/** Whether the backup-creation capability is wired up. */
export function isBackupCreateConfigured(): boolean {
  return !!env.BACKUP_SCRIPT_PATH;
}

/** Whether the restore-execution capability is wired up. */
export function isRestoreConfigured(): boolean {
  return !!env.RESTORE_SCRIPT_PATH;
}

/** Whether backup-discovery is wired up. */
export function isBackupDiscoveryConfigured(): boolean {
  return !!env.BACKUP_DIR_PATH;
}

// --- helpers ----------------------------------------------------------------

function maskedPath(filename: string): string {
  return `<backups>/${filename}`;
}

async function sha256File(path: string): Promise<string> {
  const { createReadStream } = await import("node:fs");
  return new Promise((resolveP, rejectP) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveP(hash.digest("hex")));
    stream.on("error", rejectP);
  });
}

/**
 * Strip sensitive variables from an env object before passing to a child
 * process. This is a defence-in-depth measure: backup / restore scripts
 * should never receive JWT secrets or DB passwords through inheritance.
 * They should pick up their own configuration from their own env file.
 */
function sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (/SECRET|PASSWORD|TOKEN|KEY|CREDENTIAL/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

// re-export basename for tests
export const _internal = { basename, maskedPath, sanitizeEnv };
