import type { api } from "@convex/_generated/api";
import type { FunctionArgs } from "convex/server";

// Every edit goes through `sync:push`, the same path the iOS app uses, so validation and
// last-write-wins work the same for both. The browser makes the ids and the edit time.

export type Change = FunctionArgs<typeof api.sync.push>["changes"][number];
type Table = Change["table"];
type DataOf<T extends Table> = NonNullable<Extract<Change, { table: T }>["data"]>;

export const newUid = () => crypto.randomUUID();

export function upsert<T extends Table>(table: T, uid: string, data: DataOf<T>): Change {
  return { table, uid, editedAt: Date.now(), deleted: false, data } as Change;
}

export function remove(table: Table, uid: string): Change {
  return { table, uid, editedAt: Date.now(), deleted: true } as Change;
}

/** Budgets have one record per space and category, so both apps edit the same one. */
export function budgetUid(spaceUid: string, categoryUid: string | undefined) {
  return `${spaceUid}:budget:${categoryUid ?? "overall"}`;
}

/** The id the server gives a repeating entry's occurrence, so it isn't logged twice. */
export function occurrenceUid(ruleUid: string, day: string) {
  return `${ruleUid}:${day}`;
}

export type EntryData = DataOf<"transactions">;

/** Both legs of a transfer, each titled with the other space's name. */
export function transfer(options: {
  from: { uid: string; name: string; currency: string };
  to: { uid: string; name: string; currency: string };
  sent: bigint;
  received: bigint;
  day: string;
  note?: string;
}): Change[] {
  const transferUid = newUid();
  const leg = (
    kind: "transferOut" | "transferIn",
    space: { uid: string; currency: string },
    other: { name: string },
    amountMinor: bigint,
  ) =>
    upsert("transactions", newUid(), {
      spaceUid: space.uid,
      kind,
      amountMinor,
      currency: space.currency,
      title: other.name,
      note: options.note,
      occurredOn: options.day,
      transferUid,
      receiptKeys: [],
    });
  return [
    leg("transferOut", options.from, options.to, options.sent),
    leg("transferIn", options.to, options.from, options.received),
  ];
}
