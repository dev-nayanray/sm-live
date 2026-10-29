import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

import { netCoins, latestBalance, type LedgerItemView } from "./walletPure";

export type LedgerItem = LedgerItemView;
export { netCoins, latestBalance };

export interface WalletState {
  balance: number;
  loading: boolean;
  error: string | null;
  history: LedgerItem[];
  recharge: (amount: number) => Promise<void>;
  refresh: () => Promise<void>;
}


export function useWallet(enabled: boolean): WalletState {
  const [balance, setBalance] = useState(0);
  const [history, setHistory] = useState<LedgerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const [bal, hist] = await Promise.all([
        api<{ balance: number }>("/v1/wallet/balance"),
        api<{ items: LedgerItem[] }>("/v1/wallet/history?page=1&pageSize=25"),
      ]);
      setBalance(bal.balance);
      setHistory(hist.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recharge = useCallback(async (amount: number) => {
    await api("/v1/wallet/recharge", { method: "POST", json: { amount, provider: "fake" } });
    await refresh();
  }, [refresh]);

  return { balance, loading, error, history, recharge, refresh };
}
