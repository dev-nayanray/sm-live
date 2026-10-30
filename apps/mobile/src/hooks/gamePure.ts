/**
 * SM Live — pure game helpers (Prompt 22).
 */

export function gameStatusLabel(status: string): string {
  switch (status) {
    case "active": return "Available";
    case "maintenance": return "Under Maintenance";
    case "disabled": return "Disabled";
    default: return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function gameStatusTone(status: string): "success" | "warning" | "danger" | "muted" {
  switch (status) {
    case "active": return "success";
    case "maintenance": return "warning";
    case "disabled": return "danger";
    default: return "muted";
  }
}

export function betStatusLabel(status: string): string {
  switch (status) {
    case "placed": return "Pending";
    case "won": return "Won";
    case "lost": return "Lost";
    case "cancelled": return "Cancelled";
    case "refunded": return "Refunded";
    default: return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function betStatusTone(status: string): "warning" | "success" | "danger" | "muted" | "vip" {
  switch (status) {
    case "placed": return "warning";
    case "won": return "success";
    case "lost": return "danger";
    case "cancelled": return "muted";
    case "refunded": return "vip";
    default: return "muted";
  }
}

export function gameIcon(isPro: boolean): string {
  return isPro ? "💎" : "🎲";
}

export function formatCoins(n: number): string {
  return n.toLocaleString("en-US");
}

export function canPlay(status: string): boolean {
  return status === "active";
}

export function formatGameTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return "just now";
  const min = Math.floor(diffMs / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
