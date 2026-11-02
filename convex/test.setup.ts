/// <reference types="vite/client" />
import r2Test from "@convex-dev/r2/test";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

export const modules = import.meta.glob([
  "./**/*.ts",
  "./**/*.js",
  "!./**/*.d.ts",
  "!./**/*.test.ts",
  "!./**/*.setup.ts",
]);

export function setup() {
  const t = convexTest(schema, modules);
  r2Test.register(t);
  return t;
}

export type Test = ReturnType<typeof setup>;

/** Signs a user in, runs first-run setup, and returns their client plus first space. */
export async function signedIn(t: Test, subject: string, currency = "INR") {
  const as = t.withIdentity({ subject, tokenIdentifier: `test|${subject}` });
  await as.mutation(api.users.ensure, { timeZone: "Asia/Kolkata", name: subject });
  await as.mutation(api.users.setup, { currency, monthStartDay: 1 });
  const pulled = await as.query(api.sync.pull, { userSince: 0, spaces: [] });
  const space = pulled.spaces?.[0];
  if (!space) throw new Error("setup created no space");
  return { as, space };
}

let n = 0;
export function uid(prefix = "id") {
  n += 1;
  return `${prefix}-${n}`;
}

export function expense(spaceUid: string, overrides: Record<string, unknown> = {}) {
  return {
    spaceUid,
    kind: "expense" as const,
    amountMinor: 12_345n,
    currency: "INR",
    title: "Groceries",
    occurredOn: "2026-11-02",
    receiptKeys: [] as string[],
    ...overrides,
  };
}
