import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { expense, setup, signedIn, uid } from "./test.setup";

describe("setup", () => {
  test("creates one Personal space with categories and payment methods", async () => {
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    expect(space).toMatchObject({ name: "Personal", currency: "INR", isDefault: true });

    // A second device running setup must not create another space.
    await as.mutation(api.users.setup, { currency: "USD", monthStartDay: 1 });
    const pulled = await as.query(api.sync.pull, {
      userSince: 0,
      spaces: [{ uid: space.uid, since: 0 }],
    });
    expect(pulled.spaces).toHaveLength(1);
    expect(pulled.paymentMethods?.map((m) => m.name)).toContain("UPI");
    expect(pulled.records[0].categories.length).toBeGreaterThan(10);
  });

  test("rejects unauthenticated calls", async () => {
    const t = setup();
    await expect(t.query(api.sync.head, {})).rejects.toThrow(/Not signed in/);
  });
});

describe("push and pull", () => {
  test("upserts are idempotent and last write wins", async () => {
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    const id = uid("tx");
    const change = { table: "transactions" as const, uid: id, deleted: false };

    await as.mutation(api.sync.push, {
      changes: [{ ...change, editedAt: 100, data: expense(space.uid) }],
    });
    // Retried push from the outbox: no duplicate.
    await as.mutation(api.sync.push, {
      changes: [{ ...change, editedAt: 100, data: expense(space.uid) }],
    });
    // A newer edit wins, a stale one is ignored.
    await as.mutation(api.sync.push, {
      changes: [{ ...change, editedAt: 300, data: expense(space.uid, { title: "Rent" }) }],
    });
    const stale = await as.mutation(api.sync.push, {
      changes: [{ ...change, editedAt: 200, data: expense(space.uid, { title: "Old" }) }],
    });
    expect(stale.applied).toBe(0);

    const pulled = await as.query(api.sync.pull, {
      userSince: 1_000,
      spaces: [{ uid: space.uid, since: 0 }],
    });
    const txs = pulled.records[0].transactions;
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ title: "Rent", amountMinor: 12_345n });
  });

  test("tombstones are final and only changes after the cursor come back", async () => {
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    const before = await as.query(api.sync.head, {});
    const cursor = before.spaces[0].seq;
    const id = uid("tx");

    await as.mutation(api.sync.push, {
      changes: [
        { table: "transactions", uid: id, editedAt: 1, deleted: false, data: expense(space.uid) },
      ],
    });
    await as.mutation(api.sync.push, {
      changes: [{ table: "transactions", uid: id, editedAt: 2, deleted: true }],
    });
    const revived = await as.mutation(api.sync.push, {
      changes: [
        { table: "transactions", uid: id, editedAt: 3, deleted: false, data: expense(space.uid) },
      ],
    });
    expect(revived.applied).toBe(0);

    const pulled = await as.query(api.sync.pull, {
      userSince: before.userSeq,
      spaces: [{ uid: space.uid, since: cursor }],
    });
    expect(pulled.spaces).toBeNull();
    const [record] = pulled.records;
    expect(record.categories).toHaveLength(0);
    expect(record.transactions).toHaveLength(1);
    expect(record.transactions[0].deletedAt).toBeTypeOf("number");
  });

  test("pages large pulls without gaps", async () => {
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    const head = await as.query(api.sync.head, {});
    for (let batch = 0; batch < 5; batch++) {
      await as.mutation(api.sync.push, {
        changes: Array.from({ length: 100 }, (_, i) => ({
          table: "transactions" as const,
          uid: `bulk-${batch}-${i}`,
          editedAt: 1,
          deleted: false,
          data: expense(space.uid),
        })),
      });
    }
    const seen = new Set<string>();
    let since = head.spaces[0].seq;
    for (let page = 0; page < 10; page++) {
      const pulled = await as.query(api.sync.pull, {
        userSince: head.userSeq,
        spaces: [{ uid: space.uid, since }],
      });
      const record = pulled.records[0];
      if (!record) break;
      for (const tx of record.transactions) seen.add(tx.uid);
      since = record.cursor;
      if (!record.hasMore) break;
    }
    expect(seen.size).toBe(500);
  });

  test("validates input", async () => {
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    const push = (data: ReturnType<typeof expense>) =>
      as.mutation(api.sync.push, {
        changes: [{ table: "transactions", uid: uid(), editedAt: 1, deleted: false, data }],
      });
    await expect(push(expense(space.uid, { amountMinor: -1n }))).rejects.toThrow(/amount/);
    await expect(push(expense(space.uid, { occurredOn: "2026-02-30" }))).rejects.toThrow(/date/);
    await expect(push(expense(space.uid, { title: " " }))).rejects.toThrow(/Title/);
    await expect(push(expense(space.uid, { receiptKeys: ["other/x"] }))).rejects.toThrow(/receipt/);
  });
});

describe("authorization", () => {
  test("users can't read or write another user's space", async () => {
    const t = setup();
    const alice = await signedIn(t, "alice");
    const bob = await signedIn(t, "bob");

    await expect(
      bob.as.mutation(api.sync.push, {
        changes: [
          {
            table: "transactions",
            uid: uid(),
            editedAt: 1,
            deleted: false,
            data: expense(alice.space.uid),
          },
        ],
      }),
    ).rejects.toThrow(/Space not found/);

    const pulled = await bob.as.query(api.sync.pull, {
      userSince: 0,
      spaces: [{ uid: alice.space.uid, since: 0 }],
    });
    expect(pulled.records).toHaveLength(0);
    expect(pulled.spaces?.map((s) => s.uid)).not.toContain(alice.space.uid);

    // Bob can't hijack Alice's record by reusing its uid either.
    const id = uid("tx");
    await alice.as.mutation(api.sync.push, {
      changes: [
        {
          table: "transactions",
          uid: id,
          editedAt: 1,
          deleted: false,
          data: expense(alice.space.uid),
        },
      ],
    });
    await expect(
      bob.as.mutation(api.sync.push, {
        changes: [{ table: "transactions", uid: id, editedAt: 2, deleted: true }],
      }),
    ).rejects.toThrow(/Space not found/);
  });

  test("receipt URLs require membership", async () => {
    const t = setup();
    const alice = await signedIn(t, "alice");
    const bob = await signedIn(t, "bob");
    await expect(
      bob.as.mutation(api.receipts.uploadUrl, { spaceUid: alice.space.uid }),
    ).rejects.toThrow(/Space not found/);
    await expect(
      bob.as.mutation(api.receipts.downloadUrl, { key: `${alice.space.uid}/x` }),
    ).rejects.toThrow(/Space not found/);
  });
});

describe("spaces and transfers", () => {
  test("new spaces get default categories and transfers land atomically", async () => {
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    const office = uid("space");
    await as.mutation(api.sync.push, {
      changes: [
        {
          table: "spaces",
          uid: office,
          editedAt: 1,
          deleted: false,
          data: {
            name: "Office",
            symbol: "briefcase",
            tint: "blue",
            currency: "USD",
            monthStartDay: 25,
            sortOrder: 1,
          },
        },
      ],
    });

    const transfer = uid("transfer");
    await as.mutation(api.sync.push, {
      changes: [
        {
          table: "transactions",
          uid: uid(),
          editedAt: 1,
          deleted: false,
          data: expense(space.uid, {
            kind: "transferOut",
            transferUid: transfer,
            title: "To Office",
          }),
        },
        {
          table: "transactions",
          uid: uid(),
          editedAt: 1,
          deleted: false,
          data: expense(office, {
            kind: "transferIn",
            transferUid: transfer,
            currency: "USD",
            amountMinor: 150n,
            title: "From Personal",
          }),
        },
      ],
    });

    // A transfer leg without its pairing id is rejected, and so is the whole push.
    await expect(
      as.mutation(api.sync.push, {
        changes: [
          {
            table: "transactions",
            uid: uid(),
            editedAt: 1,
            deleted: false,
            data: expense(space.uid, { kind: "transferOut" }),
          },
        ],
      }),
    ).rejects.toThrow(/transfer/);

    const pulled = await as.query(api.sync.pull, {
      userSince: 0,
      spaces: [
        { uid: space.uid, since: 0 },
        { uid: office, since: 0 },
      ],
    });
    expect(pulled.spaces?.map((s) => s.name).sort()).toEqual(["Office", "Personal"]);
    const legs = pulled.records.flatMap((r) => r.transactions).filter((x) => x.transferUid);
    expect(legs.map((l) => l.kind).sort()).toEqual(["transferIn", "transferOut"]);
    expect(pulled.records.find((r) => r.spaceUid === office)?.categories.length).toBeGreaterThan(
      10,
    );
  });

  test("deleting a space purges its records; the default space can't be deleted", async () => {
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    await expect(
      as.mutation(api.sync.push, {
        changes: [{ table: "spaces", uid: space.uid, editedAt: Date.now(), deleted: true }],
      }),
    ).rejects.toThrow(/default space/);

    const office = uid("space");
    await as.mutation(api.sync.push, {
      changes: [
        {
          table: "spaces",
          uid: office,
          editedAt: 1,
          deleted: false,
          data: {
            name: "Office",
            symbol: "briefcase",
            tint: "blue",
            currency: "INR",
            monthStartDay: 1,
            sortOrder: 1,
          },
        },
        { table: "transactions", uid: uid(), editedAt: 1, deleted: false, data: expense(office) },
      ],
    });
    await as.mutation(api.sync.push, {
      changes: [{ table: "spaces", uid: office, editedAt: 2, deleted: true }],
    });
    await t.finishAllScheduledFunctions(() => {});
    const remaining = await t.run((ctx) =>
      ctx.db
        .query("transactions")
        .withIndex("by_space_seq", (q) => q.eq("spaceUid", office))
        .collect(),
    );
    expect(remaining).toHaveLength(0);
    const pulled = await as.query(api.sync.pull, { userSince: 0, spaces: [] });
    expect(pulled.spaces?.map((s) => s.uid)).toEqual([space.uid]);
  });
});
