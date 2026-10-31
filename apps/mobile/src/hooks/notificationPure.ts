/**
 * SM Live — pure notification helpers (Prompt 23).
 */

export type NotificationCategory =
  | "social" | "follow" | "gift" | "dm" | "live" | "voice"
  | "game" | "wallet" | "vip" | "system" | "support";

export function categoryIcon(category: string): string {
  switch (category) {
    case "social": return "👥";
    case "follow": return "➕";
    case "gift": return "🎁";
    case "dm": return "💬";
    case "live": return "🔴";
    case "voice": return "🎙️";
    case "game": return "🎮";
    case "wallet": return "🪙";
    case "vip": return "👑";
    case "system": return "📢";
    case "support": return "🧭";
    default: return "🔔";
  }
}

export function categoryLabel(category: string): string {
  switch (category) {
    case "social": return "Social";
    case "follow": return "Follow";
    case "gift": return "Gift";
    case "dm": return "Message";
    case "live": return "Live";
    case "voice": return "Voice";
    case "game": return "Game";
    case "wallet": return "Wallet";
    case "vip": return "VIP";
    case "system": return "System";
    case "support": return "Support";
    default: return category.charAt(0).toUpperCase() + category.slice(1);
  }
}

export function formatNotificationTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const TICKET_STATUSES = [
  "new", "open", "in_progress", "waiting_user", "waiting_internal", "resolved", "closed",
] as const;

export function ticketStatusLabel(status: string): string {
  switch (status) {
    case "new": return "New";
    case "open": return "Open";
    case "in_progress": return "In Progress";
    case "waiting_user": return "Waiting for You";
    case "waiting_internal": return "Awaiting Reply";
    case "resolved": return "Resolved";
    case "closed": return "Closed";
    default: return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function ticketStatusTone(status: string): "warning" | "success" | "danger" | "muted" | "primary" {
  switch (status) {
    case "new": return "primary";
    case "open": return "warning";
    case "in_progress": return "warning";
    case "waiting_user": return "danger";
    case "waiting_internal": return "muted";
    case "resolved": return "success";
    case "closed": return "muted";
    default: return "muted";
  }
}

export const TICKET_CATEGORIES = [
  { key: "account_issues", label: "Account Problems", icon: "👤" },
  { key: "payment", label: "Wallet & Coins", icon: "🪙" },
  { key: "live_streaming", label: "Live Streaming", icon: "🔴" },
  { key: "voice_room", label: "Voice Room", icon: "🎙️" },
  { key: "game", label: "Game Issues", icon: "🎮" },
  { key: "gift", label: "Gift Issues", icon: "🎁" },
  { key: "vip", label: "VIP Membership", icon: "👑" },
  { key: "technical", label: "Technical Issues", icon: "⚙️" },
  { key: "abuse", label: "Report Abuse", icon: "🚩" },
  { key: "other", label: "Other", icon: "📝" },
] as const;
