import type { Doc } from "@convex/_generated/dataModel";
import { contains, type Period } from "./period";

export type Entry = Doc<"transactions">;
export type Budget = Doc<"budgets">;

/** Totals for one space over one budget period; the same numbers the iOS app shows. */
export interface Summary {
  income: bigint;
  expense: bigint;
  transferIn: bigint;
  transferOut: bigint;
  net: bigint;
  /** Expenses per calendar day. */
  daily: Map<string, bigint>;
  /** Expenses per category (null for uncategorized), largest first. */
  byCategory: { categoryUid: string | null; amount: bigint }[];
}

export function summarize(entries: Entry[], period: Period): Summary {
  let income = 0n;
  let expense = 0n;
  let transferIn = 0n;
  let transferOut = 0n;
  const daily = new Map<string, bigint>();
  const categories = new Map<string | null, bigint>();
  for (const e of entries) {
    if (e.deletedAt !== undefined || !contains(period, e.occurredOn)) continue;
    switch (e.kind) {
      case "income":
        income += e.amountMinor;
        break;
      case "transferIn":
        transferIn += e.amountMinor;
        break;
      case "transferOut":
        transferOut += e.amountMinor;
        break;
      case "expense": {
        expense += e.amountMinor;
        daily.set(e.occurredOn, (daily.get(e.occurredOn) ?? 0n) + e.amountMinor);
        const key = e.categoryUid ?? null;
        categories.set(key, (categories.get(key) ?? 0n) + e.amountMinor);
        break;
      }
    }
  }
  const byCategory = [...categories]
    .map(([categoryUid, amount]) => ({ categoryUid, amount }))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  return {
    income,
    expense,
    transferIn,
    transferOut,
    net: income + transferIn - expense - transferOut,
    daily,
    byCategory,
  };
}

export type BudgetLevel = "within" | "approaching" | "over";

export interface BudgetStatus {
  limit: bigint;
  spent: bigint;
  remaining: bigint;
  /** 0…1+, for progress bars. */
  fraction: number;
  level: BudgetLevel;
}

export function budgetStatus(
  summary: Summary,
  budget: Pick<Budget, "categoryUid" | "amountMinor">,
): BudgetStatus {
  const spent =
    budget.categoryUid === undefined
      ? summary.expense
      : (summary.byCategory.find((c) => c.categoryUid === budget.categoryUid)?.amount ?? 0n);
  const limit = budget.amountMinor;
  // Ratio in basis points keeps the bigint division exact enough for display.
  const fraction = limit > 0n ? Number((spent * 10_000n) / limit) / 10_000 : 0;
  const level: BudgetLevel = spent > limit ? "over" : fraction >= 0.75 ? "approaching" : "within";
  return { limit, spent, remaining: limit - spent, fraction, level };
}

/** Money in is positive, money out negative, for amounts shown with a sign. */
export function signedAmount(entry: Pick<Entry, "kind" | "amountMinor">): bigint {
  return entry.kind === "income" || entry.kind === "transferIn"
    ? entry.amountMinor
    : -entry.amountMinor;
}
