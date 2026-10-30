import { z } from "zod";

// ---------------------------------------------------------------------------
// Roles / permissions
// ---------------------------------------------------------------------------
export const ADMIN_ROLES = ["super_admin", "security_admin", "finance", "support", "agency_admin"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const PERMISSIONS = [
  "dashboard.view",
  "rooms.read", "rooms.write",
  "users.read", "users.write",
  "agencies.read", "agencies.write",
  "games.read", "games.write",
  "rounds.read", "rounds.write",
  "wallet.read", "wallet.write",
  "players.read", "players.write",
  "reports.read",
  "providers.read", "providers.write",
  "security.read", "security.write",
  "settings.read", "settings.write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_DEFAULT_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  security_admin: ["dashboard.view", "security.read", "security.write", "players.read", "players.write"],
  finance: ["dashboard.view", "wallet.read", "wallet.write", "reports.read", "providers.read", "providers.write"],
  support: ["dashboard.view", "players.read", "rooms.read", "users.read"],
  agency_admin: ["dashboard.view", "users.read", "agencies.read", "wallet.read"],
};

// ---------------------------------------------------------------------------
// Rooms / content
// ---------------------------------------------------------------------------
export const ROOM_TYPES = ["live", "voice", "party"] as const;
export type RoomType = (typeof ROOM_TYPES)[number];
export const ROOM_SLOT_OPTIONS = [3, 5, 10, 15, 20] as const;

export const BET_STATUSES = ["placed", "won", "lost", "cancelled", "refunded"] as const;
export type BetStatus = (typeof BET_STATUSES)[number];

export const GAME_STATUSES = ["active", "maintenance", "disabled"] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const RESTRICTION_TYPES = ["ban", "mute", "freeze_wallet", "kick"] as const;
export type RestrictionType = (typeof RESTRICTION_TYPES)[number];

// ---------------------------------------------------------------------------
// Zod schemas — shared between API validation and admin forms
// ---------------------------------------------------------------------------
export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(120).optional(),
  sortBy: z.string().trim().max(60).optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

// --- Auth ---
export const registerSchema = z
  .object({
    phone: z.string().trim().regex(/^\+?[0-9]{8,15}$/).optional(),
    email: z.string().trim().email().optional(),
    password: z.string().min(6).max(72),
    displayName: z.string().trim().min(2).max(40),
    market: z.string().trim().default("default"),
    referrerCode: z.string().trim().max(20).optional(),
  })
  .refine((v) => v.phone || v.email, { message: "phone or email required" });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(72),
});
export const otpRequestSchema = z.object({ identifier: z.string().trim().min(3).max(120) });
export const otpVerifySchema = z.object({ identifier: z.string().trim().min(3).max(120), code: z.string().trim().length(6) });
export const adminLoginSchema = z.object({ username: z.string().trim().min(3).max(60), password: z.string().min(1).max(72) });

// --- Rooms ---
export const createRoomSchema = z.object({
  title: z.string().trim().min(2).max(80),
  type: z.enum(ROOM_TYPES),
  slots: z.union([z.literal(3), z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
  country: z.string().trim().length(2).default("XX"),
});

// --- Gifts ---
export const sendGiftSchema = z.object({
  giftId: z.coerce.number().int().positive(),
  roomId: z.coerce.number().int().positive().optional(),
  recipientId: z.coerce.number().int().positive().optional(),
  quantity: z.coerce.number().int().min(1).max(100).default(1),
});

// --- Wallet ---
export const rechargeSchema = z.object({
  amount: z.coerce.number().int().min(1).max(1_000_000),
  provider: z.enum(["fake", "card", "upay"]).default("fake"),
  meta: z.record(z.unknown()).optional(),
});
export const refundSchema = z.object({
  rechargeId: z.coerce.number().int().positive(),
  reason: z.string().trim().max(200).optional(),
});

// --- Games ---
export const gameLaunchSchema = z.object({ market: z.string().trim().optional() });
export const providerBetSchema = z.object({
  sessionId: z.string().trim().min(6).max(80),
  roundId: z.string().trim().min(1).max(80),
  amount: z.coerce.number().int().min(0),
  currency: z.literal("coins").default("coins"),
  txId: z.string().trim().min(1).max(100),
});
export const providerWinSchema = providerBetSchema.omit({ amount: true }).extend({
  amount: z.coerce.number().int().min(0),
  payoutMultiplier: z.coerce.number().min(0).optional(),
});
export const providerRoundWebhookSchema = z.object({
  roundId: z.string().trim().min(1).max(80),
  sessionId: z.string().trim().min(1).max(80),
  status: z.enum(["settled", "cancelled"]),
  bets: z.array(z.object({ txId: z.string(), amount: z.coerce.number().int(), outcome: z.enum(["won", "lost", "refunded"]) })).default([]),
  ts: z.coerce.number().int().positive(),
});

// --- Config entities (admin CRUD) ---
export const giftSchema = z.object({
  name: z.string().trim().min(1).max(60),
  iconUrl: z.string().trim().url().or(z.literal("")).default(""),
  price: z.coerce.number().int().min(1),
  category: z.string().trim().max(40).default("basic"),
  animation: z.enum(["none", "small", "full"]).default("small"),
  enabled: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export const gameSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9_-]{2,40}$/),
  name: z.string().trim().min(1).max(80),
  version: z.string().trim().max(20).default("1.0.0"),
  status: z.enum(GAME_STATUSES).default("active"),
  isPro: z.boolean().default(false),
  providerId: z.coerce.number().int().positive().optional().nullable(),
  thumbnailUrl: z.string().trim().url().or(z.literal("")).default(""),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export const gameProviderSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().regex(/^[a-z0-9_-]{2,40}$/),
  apiBase: z.string().trim().url(),
  apiKey: z.string().trim().min(8).max(120),
  apiSecret: z.string().trim().min(8).max(200),
  commissionPct: z.coerce.number().min(0).max(100).default(0),
  enabled: z.boolean().default(true),
});

export const gameConfigSchema = z.object({
  gameId: z.coerce.number().int().positive(),
  marketId: z.coerce.number().int().positive(),
  minBet: z.coerce.number().int().min(1),
  maxBet: z.coerce.number().int().min(1),
  bettingSeconds: z.coerce.number().int().min(5).max(600),
  timeoutSeconds: z.coerce.number().int().min(10).max(3600),
  stuckPolicy: z.enum(["refund", "settle"]).default("refund"),
});

export const marketSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9_-]{2,10}$/),
  name: z.string().trim().min(1).max(60),
  realMoneyEnabled: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

export const brandConfigSchema = z.object({
  marketId: z.coerce.number().int().positive(),
  appName: z.string().trim().min(1).max(40),
  logoUrl: z.string().trim().url().or(z.literal("")).default(""),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).default("#7c3aed"),
  accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).default("#f43f5e"),
  bottomTabs: z
    .array(z.object({ key: z.string(), label: z.string(), icon: z.string(), visible: z.boolean() }))
    .default([]),
});

export const featureFlagSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9._-]{2,60}$/),
  description: z.string().trim().max(200).default(""),
  enabled: z.boolean().default(false),
  rolloutPct: z.coerce.number().int().min(0).max(100).default(100),
});

export const countryFilterSchema = z.object({
  marketId: z.coerce.number().int().positive(),
  country: z.string().trim().length(2).toUpperCase(),
  blocked: z.boolean().default(false),
});

export const settingSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9._-]{2,80}$/),
  value: z.string().trim().max(2000),
  description: z.string().trim().max(200).default(""),
});

export const apiAccessKeySchema = z.object({
  label: z.string().trim().min(1).max(60),
  providerId: z.coerce.number().int().positive(),
  key: z.string().trim().min(8).max(80),
  ipAllowList: z.string().trim().max(500).default("127.0.0.1,::1"),
  enabled: z.boolean().default(true),
});

export const playerRestrictionSchema = z.object({
  userId: z.coerce.number().int().positive(),
  type: z.enum(RESTRICTION_TYPES),
  reason: z.string().trim().max(200).optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

/**
 * Admin notes — internal records attached to a user, never exposed to the
 * mobile app. Used by Super Admins for moderation context, review history,
 * and internal hand-off notes between shifts.
 *
 * `category` is a controlled enum so the admin UI can filter/group notes
 * without free-text drift.
 */
export const ADMIN_NOTE_CATEGORIES = ["general", "review", "moderation", "escalation", "financial", "other"] as const;
export type AdminNoteCategory = (typeof ADMIN_NOTE_CATEGORIES)[number];

export const adminNoteSchema = z.object({
  userId: z.coerce.number().int().positive(),
  category: z.enum(ADMIN_NOTE_CATEGORIES),
  body: z.string().trim().min(1).max(2000),
  internal: z.boolean().default(true),
});

/**
 * Profile-edit schema. Excludes password/phone/email — those go through the
 * auth flows (registration, OTP, password reset) and must NOT be edited from
 * the admin panel directly.
 */
export const userUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(40).optional(),
  country: z.string().trim().length(2).optional(),
  agencyId: z.coerce.number().int().positive().nullable().optional(),
  vipLevel: z.coerce.number().int().min(0).max(100).optional(),
  nobleLevel: z.coerce.number().int().min(0).max(100).optional(),
  avatarUrl: z.string().trim().max(500).optional(),
});

/**
 * User-list filter schema. All filters are optional and validated server-side
 * so the API never accepts an unbounded or malformed query.
 */
export const userListQuerySchema = paginationQuery.extend({
  status: z.enum(["active", "restricted", "banned", "muted", "frozen"]).optional(),
  country: z.string().trim().length(2).optional(),
  agencyId: z.coerce.number().int().positive().optional(),
  registeredFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  registeredTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasRestriction: z.enum(["true", "false"]).optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

/**
 * Mask a phone or email for display to administrators who lack the
 * `players.read` permission (which we treat as the "view sensitive contact"
 * permission gate). e.g. "+880170000001" → "+87***01".
 */
export function maskContact(s: string | null | undefined): string | null {
  if (!s) return null;
  if (s.length <= 4) return "****";
  return s.slice(0, 2) + "***" + s.slice(-2);
}

// ---------------------------------------------------------------------------
// Agency management (Prompt 04)
// ---------------------------------------------------------------------------
//
// Agencies have an `active` boolean (not a status enum) in the existing
// schema. We surface it to the UI as a derived status string
// ("active" | "suspended") so the admin can reason about it without
// learning the boolean convention. The "pending" state is intentionally
// NOT invented — there is no approval workflow in the current platform.

export const AGENCY_STATUSES = ["active", "suspended"] as const;
export type AgencyStatus = (typeof AGENCY_STATUSES)[number];

/**
 * Create-agency schema. `code` must match the existing unique constraint
 * format (lowercase alphanumerics + dash/underscore, 2–40 chars). Parent
 * is optional — top-level agencies have parentId = null.
 */
export const agencyCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().regex(/^[a-z0-9_-]{2,40}$/),
  description: z.string().trim().max(500).optional(),
  contactEmail: z.string().trim().email().max(120).optional().or(z.literal("")),
  contactPhone: z.string().trim().max(40).optional().or(z.literal("")),
  country: z.string().trim().length(2).optional(),
  commissionRate: z.coerce.number().min(0).max(1).default(0.1),
  parentId: z.coerce.number().int().positive().nullable().optional(),
});

/**
 * Update-agency schema. All fields optional; same constraints as create.
 * Status changes go through a dedicated endpoint so we can require a reason.
 */
export const agencyUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  contactEmail: z.string().trim().email().max(120).optional().or(z.literal("")),
  contactPhone: z.string().trim().max(40).optional().or(z.literal("")),
  country: z.string().trim().length(2).optional(),
  commissionRate: z.coerce.number().min(0).max(1).optional(),
  parentId: z.coerce.number().int().positive().nullable().optional(),
});

/**
 * Status-change schema. `action` is constrained to the two transitions
 * that make sense for the existing boolean `active` column.
 */
export const agencyStatusChangeSchema = z.object({
  action: z.enum(["activate", "suspend"]),
  reason: z.string().trim().min(1).max(300),
});

/**
 * Agency-list filter schema. Mirrors `userListQuerySchema` so the admin
 * UI can reuse the same filter-bar pattern.
 */
export const agencyListQuerySchema = paginationQuery.extend({
  status: z.enum(AGENCY_STATUSES).optional(),
  country: z.string().trim().length(2).optional(),
  createdFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  createdTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type AgencyListQuery = z.infer<typeof agencyListQuerySchema>;

// ---------------------------------------------------------------------------
// Live room monitoring & moderation (Prompt 05)
// ---------------------------------------------------------------------------

// ROOM_TYPES is already defined above (line 36) — reused as-is.

export const ROOM_REPORT_CATEGORIES = [
  "harassment", "inappropriate_content", "spam", "impersonation", "suspicious", "other",
] as const;
export const ROOM_REPORT_STATUSES = ["open", "in_review", "resolved", "dismissed"] as const;

export const roomReportCreateSchema = z.object({
  reporterId: z.coerce.number().int().positive().nullable().optional(),
  reportedUserId: z.coerce.number().int().positive().nullable().optional(),
  category: z.enum(ROOM_REPORT_CATEGORIES).default("other"),
  description: z.string().trim().min(1).max(2000),
});

export const roomReportUpdateSchema = z.object({
  status: z.enum(ROOM_REPORT_STATUSES).optional(),
  reviewNote: z.string().trim().max(1000).optional(),
});

export const roomListQuerySchema = paginationQuery.extend({
  type: z.enum(ROOM_TYPES).optional(),
  status: z.enum(["active", "closed"]).optional(),
  hostId: z.coerce.number().int().positive().optional(),
  hasReports: z.enum(["true", "false"]).optional(),
  createdFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  createdTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type RoomListQuery = z.infer<typeof roomListQuerySchema>;

// ---------------------------------------------------------------------------
// Game & provider management (Prompt 06)
// ---------------------------------------------------------------------------

export const GAME_STATUS_ACTIONS = ["activate", "disable", "maintenance"] as const;

export const gameStatusChangeSchema = z.object({
  action: z.enum(GAME_STATUS_ACTIONS),
  reason: z.string().trim().min(1).max(300),
});

export const gameListQuerySchema = paginationQuery.extend({
  status: z.enum(GAME_STATUSES).optional(),
  providerId: z.coerce.number().int().positive().optional(),
  isPro: z.enum(["true", "false"]).optional(),
});
export type GameListQuery = z.infer<typeof gameListQuerySchema>;

export const providerListQuerySchema = paginationQuery.extend({
  enabled: z.enum(["true", "false"]).optional(),
});
export type ProviderListQuery = z.infer<typeof providerListQuerySchema>;

export const sessionListQuerySchema = paginationQuery.extend({
  gameId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  status: z.enum(["open", "closed"]).optional(),
  providerId: z.coerce.number().int().positive().optional(),
});
export type SessionListQuery = z.infer<typeof sessionListQuerySchema>;

// ---------------------------------------------------------------------------
// Wallet & financial transaction management (Prompt 07)
// ---------------------------------------------------------------------------

export const ledgerListQuerySchema = paginationQuery.extend({
  kind: z.string().optional(), // validated server-side against LEDGER_KINDS
  userId: z.coerce.number().int().positive().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  minAmount: z.coerce.number().int().optional(),
  maxAmount: z.coerce.number().int().optional(),
});
export type LedgerListQuery = z.infer<typeof ledgerListQuerySchema>;

export const walletListQuerySchema = paginationQuery.extend({
  frozen: z.enum(["true", "false"]).optional(),
  minBalance: z.coerce.number().int().optional(),
  maxBalance: z.coerce.number().int().optional(),
});
export type WalletListQuery = z.infer<typeof walletListQuerySchema>;

// --- Public app config (response of GET /v1/config/app) ---
export interface AppConfigGift { id: number; name: string; iconUrl: string; price: number; category: string; animation: string; }
export interface AppConfigGame { code: string; name: string; thumbnailUrl: string; isPro: boolean; status: string; minBet: number; maxBet: number; }
export interface AppConfigTab { key: string; label: string; icon: string; visible: boolean; }
export interface AppConfigResponse {
  brand: { appName: string; logoUrl: string; primaryColor: string; accentColor: string };
  flags: Record<string, boolean>;
  games: AppConfigGame[];
  gifts: AppConfigGift[];
  bottomTabs: AppConfigTab[];
  market: string;
  realMoneyEnabled: boolean;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------
export interface ApiError { ok: false; error: { code: string; message: string; details?: unknown }; }
export interface ApiOk<T> { ok: true; data: T; }
export type ApiResponse<T> = ApiOk<T> | ApiError;

export const LEDGER_KINDS = ["recharge", "bet_debit", "bet_refund", "win_credit", "gift_debit", "gift_credit", "agency_commission", "admin_adjust", "refund"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const CONSTANT = {
  COIN_CURRENCY: "coins",
  OTP_TTL_SECONDS: 300,
  ACCESS_TOKEN_TTL_SECONDS: 60 * 15,
  REFRESH_TOKEN_TTL_SECONDS: 60 * 60 * 24 * 30,
  PROVIDER_SIGNATURE_TOLERANCE_SECONDS: 300,
} as const;
