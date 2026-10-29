import crypto from "node:crypto";
import { CONSTANT } from "@sm-live/shared";

/**
 * Provider signature scheme (documented in docs/API.md):
 *   signature = HMAC_SHA256(apiSecret, `${method}|${path}|${timestamp}|${sha256Hex(rawBody)}`)
 * Sent as headers: X-Api-Key, X-Timestamp, X-Signature.
 */
export function providerSignature(method: string, path: string, timestamp: number, rawBody: string, secret: string): string {
  const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
  return crypto.createHmac("sha256", secret).update(`${method.toUpperCase()}|${path}|${timestamp}|${bodyHash}`).digest("hex");
}

export function verifyProviderSignature(args: {
  method: string;
  path: string;
  timestamp: number;
  rawBody: string;
  signature: string;
  secret: string;
}): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - args.timestamp) > CONSTANT.PROVIDER_SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = providerSignature(args.method, args.path, args.timestamp, args.rawBody, args.secret);
  const a = Buffer.from(args.signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Launch URL signature for game launch: HMAC over `session|user|ts`. */
export function launchSignature(sessionKey: string, userId: number, ts: number, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${sessionKey}|${userId}|${ts}`).digest("hex");
}
