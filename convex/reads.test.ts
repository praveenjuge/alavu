import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { expense, setup, signedIn, uid } from "./test.setup";

describe("reads", () => {
  test("account lists only live spaces the user belongs to", async () => {
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    const { as: bob } = await signedIn(t, "bob");

    const work = uid("space");
    await as.mutation(api.sync.push, {
      changes: [
        {
          table: "spaces",
          uid: work,
          editedAt: 100,
          deleted: false,
          data: {
            name: "Work",
            symbol: "briefcase",
            tint: "blue",
            currency: "INR",
            monthStartDay: 1,
            sortOrder: 1,
          },
        },
      ],
    });

    const mine = await as.query(api.reads.account, {});
    expect(mine.spaces.map((s) => [s.name, s.role])).toEqual([
      ["Personal", "owner"],
      ["Work", "owner"],
    ]);
    expect(mine.user).toMatchObject({ name: "alice", timeZone: "Asia/Kolkata" });

    const theirs = await bob.query(api.reads.account, {});
    expect(theirs.spaces.map((s) => s.uid)).not.toContain(space.uid);
  });

  test("space reads are denied to non-members", async () => {
    const t = setup();
    const { space } = await signedIn(t, "alice");
    const { as: bob } = await signedIn(t, "bob");
    await expect(bob.query(api.reads.spaceSetup, { spaceUid: space.uid })).rejects.toThrow(
      /Space not found/,
    );
    await expect(
      bob.query(api.reads.entriesInRange, {
        spaceUid: space.uid,
        from: "2026-11-01",
        to: "2026-11-30",
      }),
    ).rejects.toThrow(/Space not found/);
    await expect(
      bob.query(api.reads.entriesPage, {
        spaceUid: space.uid,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/Space not found/);
  });

  test("entries come back by date range and page, without tombstones", async () => {
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    const dates = ["2026-10-24", "2026-10-25", "2026-11-02", "2026-11-24", "2026-11-25"];
    const ids = dates.map(() => uid("tx"));
    await as.mutation(api.sync.push, {
      changes: dates.map((occurredOn, i) => ({
        table: "transactions" as const,
        uid: ids[i],
        editedAt: 100,
        deleted: false,
        data: expense(space.uid, { occurredOn, title: occurredOn }),
      })),
    });
    // Delete one entry inside the range.
    await as.mutation(api.sync.push, {
      changes: [{ table: "transactions", uid: ids[2], editedAt: 200, deleted: true }],
    });

    const inRange = await as.query(api.reads.entriesInRange, {
      spaceUid: space.uid,
      from: "2026-10-25",
      to: "2026-11-24",
    });
    expect(inRange.map((e) => e.occurredOn)).toEqual(["2026-11-24", "2026-10-25"]);

    const first = await as.query(api.reads.entriesPage, {
      spaceUid: space.uid,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page.map((e) => e.occurredOn)).toEqual(["2026-11-25", "2026-11-24"]);
    const rest = await as.query(api.reads.entriesPage, {
      spaceUid: space.uid,
      paginationOpts: { numItems: 10, cursor: first.continueCursor },
    });
    expect(rest.page.map((e) => e.occurredOn)).toEqual(["2026-10-25", "2026-10-24"]);
    expect(rest.isDone).toBe(true);
  });

  test("space setup returns categories, budgets and rules", async () => {
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    await as.mutation(api.sync.push, {
      changes: [
        {
          table: "budgets",
          uid: uid("budget"),
          editedAt: 100,
          deleted: false,
          data: { spaceUid: space.uid, amountMinor: 5_000_000n },
        },
      ],
    });
    const setupData = await as.query(api.reads.spaceSetup, { spaceUid: space.uid });
    expect(setupData.categories.length).toBeGreaterThan(10);
    expect(setupData.budgets).toHaveLength(1);
    expect(setupData.recurringRules).toEqual([]);
  });

  test("transfer legs come back together for members only", async () => {
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    const { as: bob } = await signedIn(t, "bob");
    const work = uid("space");
    const transferUid = uid("transfer");
    const leg = (spaceUid: string, kind: "transferOut" | "transferIn") => ({
      table: "transactions" as const,
      uid: uid("tx"),
      editedAt: 100,
      deleted: false,
      data: expense(spaceUid, { kind, transferUid, title: "Move" }),
    });
    await as.mutation(api.sync.push, {
      changes: [
        {
          table: "spaces",
          uid: work,
          editedAt: 100,
          deleted: false,
          data: {
            name: "Work",
            symbol: "briefcase",
            tint: "blue",
            currency: "INR",
            monthStartDay: 1,
            sortOrder: 1,
          },
        },
        leg(space.uid, "transferOut"),
        leg(work, "transferIn"),
      ],
    });
    const legs = await as.query(api.reads.transferLegs, { transferUid });
    expect(legs.map((l) => l.kind).sort()).toEqual(["transferIn", "transferOut"]);
    expect(await bob.query(api.reads.transferLegs, { transferUid })).toEqual([]);
  });

  test("a space can be archived and restored", async () => {
    const t = setup();
    const { as } = await signedIn(t, "alice");
    const work = uid("space");
    const data = {
      name: "Work",
      symbol: "briefcase",
      tint: "blue",
      currency: "INR",
      monthStartDay: 1,
      sortOrder: 1,
    };
    const push = (editedAt: number, extra: Record<string, number> = {}) =>
      as.mutation(api.sync.push, {
        changes: [
          { table: "spaces", uid: work, editedAt, deleted: false, data: { ...data, ...extra } },
        ],
      });
    await push(100);
    await push(200, { archivedAt: 200 });
    let account = await as.query(api.reads.account, {});
    expect(account.spaces.find((s) => s.uid === work)?.archivedAt).toBe(200);
    await push(300);
    account = await as.query(api.reads.account, {});
    expect(account.spaces.find((s) => s.uid === work)?.archivedAt).toBeUndefined();
  });
});
