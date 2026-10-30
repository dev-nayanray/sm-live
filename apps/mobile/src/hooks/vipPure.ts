/**
 * SM Live — pure VIP + ranking helpers (Prompt 21).
 */

export interface VipPlan {
  level: number;
  name: string;
  price: number;
  durationDays: number;
  benefits: string[];
}

export function vipLevelLabel(level: number): string {
  if (level <= 0) return "None";
  return `VIP ${level}`;
}

export function vipBadgeIcon(level: number): string {
  if (level <= 0) return "";
  if (level === 1) return "⭐";
  if (level === 2) return "🌟";
  if (level >= 3) return "👑";
  return "⭐";
}

export function formatRank(rank: number): string {
  if (rank === 1) return "🥇 #1";
  if (rank === 2) return "🥈 #2";
  if (rank === 3) return "🥉 #3";
  return `#${rank}`;
}

export function formatPoints(points: number): string {
  return points.toLocaleString("en-US");
}

export function daysRemaining(expiresAt: string, now: Date = new Date()): number {
  const then = new Date(expiresAt);
  const diffMs = then.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / 86_400_000));
}

export function isExpired(expiresAt: string, now: Date = new Date()): boolean {
  return new Date(expiresAt) < now;
}

export function planKeyForLevel(level: number): string {
  return `vip${level}_30d`;
}

export const RANKING_PERIODS = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
] as const;
