/**
 * SM Live — pure auth validators (Prompt 14).
 *
 * Pure helpers used by the registration / login / reset-password screens
 * to surface inline validation errors BEFORE the API round-trip. Every
 * helper is unit-tested; the backend re-validates everything (the
 * mobile checks are for UX, never for security).
 *
 * The conventions mirror the backend Zod schemas in
 * `packages/shared/src/index.ts`:
 *   - phone: optional, `^\+?[0-9]{8,15}$`
 *   - email: optional, RFC-ish
 *   - password: 6-72 chars
 *   - displayName: 2-40 chars
 *
 * The `passwordStrength` helper returns a 0-4 score (very weak / weak /
 * fair / strong) so the registration screen can show a meter without
 * inventing arbitrary thresholds.
 */

export type ValidationResult = { ok: true } | { ok: false; message: string };

export function validateEmail(email: string): ValidationResult {
  const v = email.trim();
  if (!v) return { ok: false, message: "Email is required" };
  if (v.length > 120) return { ok: false, message: "Email is too long" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { ok: false, message: "Enter a valid email address" };
  return { ok: true };
}

export function validatePhone(phone: string): ValidationResult {
  const v = phone.trim();
  if (!v) return { ok: false, message: "Phone number is required" };
  if (!/^\+?[0-9]{8,15}$/.test(v)) return { ok: false, message: "Enter a valid phone number (8-15 digits, optional + prefix)" };
  return { ok: true };
}

/**
 * Validate an identifier (phone OR email). The login + forgot-password
 * screens accept either; this helper picks the right per-format rule.
 */
export function validateIdentifier(identifier: string): ValidationResult {
  const v = identifier.trim();
  if (!v) return { ok: false, message: "Phone or email is required" };
  if (v.includes("@")) return validateEmail(v);
  return validatePhone(v);
}

export function validateDisplayName(name: string): ValidationResult {
  const v = name.trim();
  if (v.length < 2) return { ok: false, message: "Display name must be at least 2 characters" };
  if (v.length > 40) return { ok: false, message: "Display name must be at most 40 characters" };
  return { ok: true };
}

export function validatePassword(password: string): ValidationResult {
  if (password.length < 6) return { ok: false, message: "Password must be at least 6 characters" };
  if (password.length > 72) return { ok: false, message: "Password must be at most 72 characters" };
  return { ok: true };
}

export function validatePasswordMatch(password: string, confirm: string): ValidationResult {
  if (password !== confirm) return { ok: false, message: "Passwords do not match" };
  return { ok: true };
}

export function validateReferrerCode(code: string): ValidationResult {
  const v = code.trim();
  if (!v) return { ok: true }; // referrer code is optional
  if (v.length > 20) return { ok: false, message: "Referral code must be at most 20 characters" };
  return { ok: true };
}

export function validateOtpCode(code: string): ValidationResult {
  const v = code.trim();
  if (!/^\d{6}$/.test(v)) return { ok: false, message: "Enter the 6-digit code" };
  return { ok: true };
}

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Very weak" | "Weak" | "Fair" | "Good" | "Strong";
  color: string;
};

const STRENGTH_LABELS: PasswordStrength["label"][] = ["Very weak", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLORS = ["#fb7185", "#fb923c", "#fbbf24", "#84cc16", "#34d399"];

/**
 * Score a password 0-4. The scoring is intentionally simple — it doesn't
 * try to estimate entropy (which would require zxcvbn or similar); it
 * rewards length + character-class diversity so the user gets immediate
 * feedback while typing.
 *
 * Thresholds (each adds 1 point, capped at 4):
 *   - length ≥ 8          → 1 point
 *   - length ≥ 12          → 1 additional point
 *   - contains lower+upper → 1 point
 *   - contains digit       → 1 point
 *   - contains symbol      → 1 point
 *
 * Empty input → score 0.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) {
    return { score: 0, label: STRENGTH_LABELS[0]!, color: STRENGTH_COLORS[0]! };
  }
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  // Cap at 4 — we only have 5 labels (0..4).
  if (score > 4) score = 4;
  return {
    score: score as PasswordStrength["score"],
    label: STRENGTH_LABELS[score]!,
    color: STRENGTH_COLORS[score]!,
  };
}

/** Convenience: returns true if the identifier string looks like an email. */
export function isEmailLike(s: string): boolean {
  return s.includes("@");
}
