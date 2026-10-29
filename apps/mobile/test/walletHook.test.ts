import { latestBalance, netCoins, type LedgerItemView } from "../src/hooks/walletPure";

function item(amount: number, balanceAfter: number): LedgerItem {
  return { id: String(balanceAfter), kind: "recharge", amount, balanceAfter, txKey: `t:${balanceAfter}`, createdAt: new Date().toISOString() };
}

describe("wallet hook helpers", () => {
  it("netCoins sums signed ledger amounts", () => {
    expect(netCoins([item(500, 500), item(-200, 300), item(50, 350)])).toBe(350);
    expect(netCoins([])).toBe(0);
  });

  it("netCoins equals final balanceAfter for a consistent ledger", () => {
    const history = [item(-100, 400), item(200, 500), item(300, 300)]; // newest first
    const start = history[history.length - 1]!.balanceAfter - history[history.length - 1]!.amount;
    const net = netCoins(history);
    expect(start + net).toBe(history[0]!.balanceAfter);
  });

  it("latestBalance reads the newest row (history is sorted newest-first)", () => {
    const history = [item(-100, 900), item(1000, 1000)];
    expect(latestBalance(history)).toBe(900);
    expect(latestBalance([])).toBeNull();
  });
});
