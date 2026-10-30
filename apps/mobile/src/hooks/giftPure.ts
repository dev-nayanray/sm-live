/**
 * SM Live — pure gift + wallet helpers (Prompt 20).
 *
 * Pure functions used by the gift store + wallet + history screens.
 * Extracted so the test suite can verify behaviour without mounting
 * React or hitting the API.
 *
 * Functions:
 *   - formatCoinAmount       → "1,234" for display.
 *   - giftCategoryLabel      → human label for a category key.
 *   - totalGiftCost          → price × quantity (pure math).
 *   - canAffordGift          → balance >= totalCost.
 *   - groupGiftsByCategory   → Map<category, Gift[]> for the store grid.
 *   - formatTransactionKind  → human label for a ledger kind.
 *   - isCreditKind           → true if amount > 0 (incoming).
 *   - isDebitKind            → true if amount < 0 (outgoing).
 *   - formatGiftHistoryTime  → relative + date formatter.
 */

export interface GiftView {
  id: number;
  name: string;
  iconUrl: string;
  price: number;
  category: string;
  animation: string;
  enabled: boolean;
  sortOrder: number;
}

/** Format a coin amount with thousands separators. */
export function formatCoinAmount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Human label for a gift category key. */
export function giftCategoryLabel(category: string): string {
  switch (category) {
    case "basic": return "Popular";
    case "premium": return "Premium";
    case "luxury": return "Luxury";
    case "seasonal": return "Seasonal";
    case "special": return "Special";
    default: return category.charAt(0).toUpperCase() + category.slice(1);
  }
}

/** Calculate the total cost of a gift × quantity. */
export function totalGiftCost(price: number, quantity: number): number {
  return price * quantity;
}

/** Check if the user can afford a gift. */
export function canAffordGift(balance: number, price: number, quantity: number = 1): boolean {
  return balance >= totalGiftCost(price, quantity);
}

/** Group gifts by category into a Map for the store grid. */
export function groupGiftsByCategory(gifts: GiftView[]): Map<string, GiftView[]> {
  const map = new Map<string, GiftView[]>();
  for (const g of gifts) {
    const arr = map.get(g.category) ?? [];
    arr.push(g);
    map.set(g.category, arr);
  }
  return map;
}

/** Human label for a ledger transaction kind. */
export function formatTransactionKind(kind: string): string {
  switch (kind) {
    case "recharge": return "Coin recharge";
    case "bet_debit": return "Bet placed";
    case "bet_refund": return "Bet refunded";
    case "win_credit": return "Win credited";
    case "gift_debit": return "Gift sent";
    case "gift_credit": return "Gift received";
    case "agency_commission": return "Agency commission";
    case "admin_adjust": return "Admin adjustment";
    case "refund": return "Refund";
    default: return kind.replace(/_/g, " ");
  }
}

/** Is this a credit (incoming coins)? */
export function isCreditKind(amount: number): boolean {
  return amount > 0;
}

/** Is this a debit (outgoing coins)? */
export function isDebitKind(amount: number): boolean {
  return amount < 0;
}

/** Format a gift-history timestamp — "10:30 AM" for today, "Oct 5" for older. */
export function formatGiftHistoryTime(iso: string, now: Date = new Date()): string {
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

/** Icon for a gift animation type. */
export function giftAnimationIcon(animation: string): string {
  switch (animation) {
    case "none": return "🎁";
    case "small": return "✨";
    case "full": return "🎆";
    default: return "🎁";
  }
}

/** All known gift categories (used for the store filter chips). */
export const GIFT_CATEGORIES = ["basic", "premium", "luxury", "seasonal", "special"] as const;
