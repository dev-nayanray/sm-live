import {
  validateEmail, validatePhone, validateIdentifier, validateDisplayName,
  validatePassword, validatePasswordMatch, validateReferrerCode, validateOtpCode,
  passwordStrength, isEmailLike,
} from "../src/hooks/authPure";

/**
 * Pure auth validators (Prompt 14).
 *
 * The mobile screens call these for inline UX feedback BEFORE the API
 * round-trip. The backend re-validates everything; these tests confirm
 * the helpers agree with the backend's Zod schemas in
 * packages/shared/src/index.ts.
 */

describe("validateEmail", () => {
  it("accepts a normal email", () => {
    expect(validateEmail("alice@example.com").ok).toBe(true);
    expect(validateEmail("a.b+c@d.co").ok).toBe(true);
  });
  it("rejects empty", () => {
    expect(validateEmail("").ok).toBe(false);
    expect(validateEmail("   ").ok).toBe(false);
  });
  it("rejects malformed", () => {
    expect(validateEmail("alice").ok).toBe(false);
    expect(validateEmail("alice@").ok).toBe(false);
    expect(validateEmail("alice@example").ok).toBe(false);
    expect(validateEmail("alice @example.com").ok).toBe(false);
  });
  it("rejects too long", () => {
    expect(validateEmail(`${"a".repeat(120)}@x.co`).ok).toBe(false);
  });
});

describe("validatePhone", () => {
  it("accepts E.164-like with optional + prefix", () => {
    expect(validatePhone("+880170000001").ok).toBe(true);
    expect(validatePhone("880170000001").ok).toBe(true);
    expect(validatePhone("0170000001").ok).toBe(true);
  });
  it("rejects empty", () => {
    expect(validatePhone("").ok).toBe(false);
  });
  it("rejects too short / too long", () => {
    expect(validatePhone("12345").ok).toBe(false);
    expect(validatePhone("+1234567890123456").ok).toBe(false);
  });
  it("rejects letters + symbols", () => {
    expect(validatePhone("+88017abc").ok).toBe(false);
    expect(validatePhone("+880 1700 00001").ok).toBe(false);
  });
});

describe("validateIdentifier", () => {
  it("routes to email when the input contains @", () => {
    expect(validateIdentifier("alice@example.com").ok).toBe(true);
    expect(validateIdentifier("alice@").ok).toBe(false);
  });
  it("routes to phone otherwise", () => {
    expect(validateIdentifier("+880170000001").ok).toBe(true);
    expect(validateIdentifier("123").ok).toBe(false);
  });
  it("rejects empty", () => {
    expect(validateIdentifier("").ok).toBe(false);
  });
});

describe("validateDisplayName", () => {
  it("accepts 2-40 chars", () => {
    expect(validateDisplayName("Al").ok).toBe(true);
    expect(validateDisplayName("Alice the Streamer").ok).toBe(true);
  });
  it("rejects <2 or >40 chars", () => {
    expect(validateDisplayName("A").ok).toBe(false);
    expect(validateDisplayName("A".repeat(41)).ok).toBe(false);
  });
  it("trims before checking", () => {
    expect(validateDisplayName("  Alice  ").ok).toBe(true);
    expect(validateDisplayName("   ").ok).toBe(false);
  });
});

describe("validatePassword", () => {
  it("accepts 6-72 chars", () => {
    expect(validatePassword("abc123").ok).toBe(true);
    expect(validatePassword("A".repeat(72)).ok).toBe(true);
  });
  it("rejects <6 chars", () => {
    expect(validatePassword("12345").ok).toBe(false);
  });
  it("rejects >72 chars (bcrypt limit)", () => {
    expect(validatePassword("A".repeat(73)).ok).toBe(false);
  });
});

describe("validatePasswordMatch", () => {
  it("matches", () => {
    expect(validatePasswordMatch("abc123", "abc123").ok).toBe(true);
  });
  it("mismatch", () => {
    expect(validatePasswordMatch("abc123", "abc124").ok).toBe(false);
  });
});

describe("validateReferrerCode", () => {
  it("optional — empty is ok", () => {
    expect(validateReferrerCode("").ok).toBe(true);
    expect(validateReferrerCode("   ").ok).toBe(true);
  });
  it("rejects too long", () => {
    expect(validateReferrerCode("A".repeat(21)).ok).toBe(false);
  });
  it("accepts normal code", () => {
    expect(validateReferrerCode("ABC123").ok).toBe(true);
  });
});

describe("validateOtpCode", () => {
  it("accepts a 6-digit code", () => {
    expect(validateOtpCode("123456").ok).toBe(true);
  });
  it("rejects empty / wrong length / non-digits", () => {
    expect(validateOtpCode("").ok).toBe(false);
    expect(validateOtpCode("12345").ok).toBe(false);
    expect(validateOtpCode("12345a").ok).toBe(false);
    expect(validateOtpCode("1234567").ok).toBe(false);
  });
});

describe("passwordStrength", () => {
  it("empty → 0 (very weak)", () => {
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("").label).toBe("Very weak");
  });
  it("short lowercase → 0 (very weak, <8 chars)", () => {
    expect(passwordStrength("abc").score).toBe(0);
  });
  it("≥8 lowercase + digit → fair (2)", () => {
    // length≥8 (+1), digit (+1) → 2
    expect(passwordStrength("abcdefgh1").score).toBe(2);
  });
  it("≥12 mixed case + digit + symbol → strong (4)", () => {
    // length≥8 (+1), length≥12 (+1), lower+upper (+1), digit (+1), symbol (+1) → capped at 4
    expect(passwordStrength("Abcdefghij1!2").score).toBe(4);
    expect(passwordStrength("Abcdefghij1!2").label).toBe("Strong");
  });
  it("caps at 4 even with very long passwords", () => {
    expect(passwordStrength("Abcdefghij1!2Km9p@xZ").score).toBe(4);
  });
  it("returns a colour matching the score for the UI meter", () => {
    const s = passwordStrength("Abcdefghij1!2");
    expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("isEmailLike", () => {
  it("true for inputs containing @", () => {
    expect(isEmailLike("alice@example.com")).toBe(true);
    expect(isEmailLike("alice@")).toBe(true);
  });
  it("false otherwise", () => {
    expect(isEmailLike("+880170000001")).toBe(false);
    expect(isEmailLike("alice")).toBe(false);
  });
});
