export interface LedgerItemView {
  id: string;
  kind: string;
  amount: number;
  balanceAfter: number;
  txKey: string;
  createdAt: string;
}

/** Net coins from a ledger slice (pure — unit tested). */
export function netCoins(items: Pick<LedgerItemView, "amount">[]): number {
  return items.reduce((sum, i) => sum + i.amount, 0);
}

/** Final balance shown a ledger page sorted newest-first (pure — unit tested). */
export function latestBalance(items: LedgerItemView[]): number | null {
  const newest = items[0];
  return newest ? newest.balanceAfter : null;
}
