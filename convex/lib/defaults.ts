import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { nextSpaceSeq } from "./spaces";

// Default categories every new space starts with. Symbols are SF Symbol names;
// other platforms map them to their own icon sets.
const expenseCategories: [string, string][] = [
  ["Food & Dining", "fork.knife"],
  ["Groceries", "cart"],
  ["Transport", "car"],
  ["Shopping", "bag"],
  ["Bills & Utilities", "bolt"],
  ["Home", "house"],
  ["Health", "cross.case"],
  ["Entertainment", "popcorn"],
  ["Travel", "airplane"],
  ["Education", "book"],
  ["Gifts & Donations", "gift"],
  ["Other", "ellipsis.circle"],
];

const incomeCategories: [string, string][] = [
  ["Salary", "banknote"],
  ["Business", "briefcase"],
  ["Interest", "percent"],
  ["Gifts", "gift"],
  ["Other Income", "plus.circle"],
];

// Seeded records use editedAt 0 so any user edit wins regardless of device clocks.
export async function seedCategories(ctx: MutationCtx, space: Doc<"spaces">) {
  const rows = [
    ...expenseCategories.map(([name, symbol]) => ({ name, symbol, kind: "expense" as const })),
    ...incomeCategories.map(([name, symbol]) => ({ name, symbol, kind: "income" as const })),
  ];
  for (const [sortOrder, row] of rows.entries()) {
    await ctx.db.insert("categories", {
      ...row,
      spaceUid: space.uid,
      uid: crypto.randomUUID(),
      sortOrder,
      editedAt: 0,
      seq: await nextSpaceSeq(ctx, space),
    });
  }
}

export async function seedPaymentMethods(ctx: MutationCtx, userId: Id<"users">, currency: string) {
  const methods: [string, string][] = [
    ["Cash", "banknote"],
    ["Card", "creditcard"],
    ["Bank Transfer", "building.columns"],
  ];
  if (currency === "INR") methods.splice(1, 0, ["UPI", "qrcode"]);
  for (const [sortOrder, [name, symbol]] of methods.entries()) {
    await ctx.db.insert("paymentMethods", {
      userId,
      uid: crypto.randomUUID(),
      name,
      symbol,
      sortOrder,
      editedAt: 0,
    });
  }
}
