import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { nextOccurrence, occurrence, todayIn } from "./lib/dates";
import { setup, signedIn, uid } from "./test.setup";

afterEach(() => {
  vi.useRealTimers();
});

describe("dates", () => {
  test("monthly rules on the 31st clamp without drifting", () => {
    const dates = [0, 1, 2, 3].map((i) => occurrence("2026-01-31", "monthly", 1, i));
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(occurrence("2028-01-31", "monthly", 1, 1)).toBe("2028-02-29");
    expect(occurrence("2024-02-29", "yearly", 1, 1)).toBe("2025-02-28");
    expect(occurrence("2026-12-28", "weekly", 2, 1)).toBe("2027-01-11");
  });

  test("next occurrence after a date", () => {
    expect(nextOccurrence("2026-01-31", "monthly", 1, "2026-02-28")).toBe("2026-03-31");
    expect(nextOccurrence("2026-01-15", "monthly", 3, null)).toBe("2026-01-15");
  });

  test("today respects the time zone", () => {
    const instant = Date.UTC(2026, 10, 2, 20, 0); // 2 Nov 20:00 UTC
    expect(todayIn("Asia/Kolkata", instant)).toBe("2026-11-03");
    expect(todayIn("America/Los_Angeles", instant)).toBe("2026-11-02");
  });
});

describe("recurring rules", () => {
  test("logs every due occurrence once, in the owner's time zone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T20:00:00Z")); // 1 Apr 01:30 in Kolkata
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    const rule = uid("rule");
    await as.mutation(api.sync.push, {
      changes: [
        {
          table: "recurringRules",
          uid: rule,
          editedAt: 1,
          deleted: false,
          data: {
            spaceUid: space.uid,
            kind: "expense",
            amountMinor: 2_000_000n,
            currency: "INR",
            title: "Rent",
            cadence: "monthly",
            interval: 1,
            startOn: "2026-01-31",
          },
        },
      ],
    });
    await t.mutation(internal.recurring.materializeDue, {});
    await t.mutation(internal.recurring.materializeDue, {});

    const txs = await t.run((ctx) =>
      ctx.db
        .query("transactions")
        .withIndex("by_space_seq", (q) => q.eq("spaceUid", space.uid))
        .collect(),
    );
    expect(txs.map((x) => x.occurredOn).sort()).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    const stored = await t.run((ctx) =>
      ctx.db
        .query("recurringRules")
        .withIndex("by_uid", (q) => q.eq("uid", rule))
        .unique(),
    );
    expect(stored?.nextDueOn).toBe("2026-04-30");

    // Deleting a generated entry doesn't bring it back.
    await as.mutation(api.sync.push, {
      changes: [{ table: "transactions", uid: `${rule}:2026-02-28`, editedAt: 5, deleted: true }],
    });
    await t.mutation(internal.recurring.materializeDue, {});
    const live = await t.run((ctx) =>
      ctx.db
        .query("transactions")
        .withIndex("by_space_seq", (q) => q.eq("spaceUid", space.uid))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
        .collect(),
    );
    expect(live).toHaveLength(2);
  });

  test("paused, ended and deleted rules stop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    const base = {
      spaceUid: space.uid,
      kind: "income" as const,
      amountMinor: 100n,
      currency: "INR",
      title: "Salary",
      cadence: "monthly" as const,
      interval: 1,
      startOn: "2026-01-01",
    };
    const paused = uid("rule");
    const ended = uid("rule");
    await as.mutation(api.sync.push, {
      changes: [
        {
          table: "recurringRules",
          uid: paused,
          editedAt: 1,
          deleted: false,
          data: { ...base, pausedAt: 1 },
        },
        {
          table: "recurringRules",
          uid: ended,
          editedAt: 1,
          deleted: false,
          data: { ...base, endOn: "2026-02-15" },
        },
      ],
    });
    const txs = await t.run((ctx) => ctx.db.query("transactions").collect());
    expect(txs.map((x) => x.occurredOn).sort()).toEqual(["2026-01-01", "2026-02-01"]);
    const rules = await t.run((ctx) => ctx.db.query("recurringRules").collect());
    expect(rules.find((r) => r.uid === ended)?.nextDueOn).toBe("9999-12-31");
  });
});

describe("editing rules", () => {
  const rule = (spaceUid: string, extra: Record<string, unknown> = {}) => ({
    spaceUid,
    kind: "expense" as const,
    amountMinor: 100n,
    currency: "INR",
    title: "Gym",
    cadence: "monthly" as const,
    interval: 1,
    startOn: "2026-01-10",
    ...extra,
  });
  const logged = (t: ReturnType<typeof setup>, ruleUid: string) =>
    t.run(async (ctx) =>
      (await ctx.db.query("transactions").collect())
        .filter((x) => x.recurringRuleUid === ruleUid)
        .map((x) => x.occurredOn)
        .sort(),
    );

  test("moving an ended rule's end date later starts it again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    const id = uid("rule");
    const push = (editedAt: number, endOn: string | undefined) =>
      as.mutation(api.sync.push, {
        changes: [
          {
            table: "recurringRules",
            uid: id,
            editedAt,
            deleted: false,
            data: rule(space.uid, { endOn }),
          },
        ],
      });
    await push(1, "2026-02-15");
    expect(await logged(t, id)).toEqual(["2026-01-10", "2026-02-10"]);

    await push(2, "2026-04-30");
    expect(await logged(t, id)).toEqual(["2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10"]);

    await push(3, undefined);
    expect(await logged(t, id)).toHaveLength(6);
    const stored = await t.run((ctx) =>
      ctx.db
        .query("recurringRules")
        .withIndex("by_uid", (q) => q.eq("uid", id))
        .unique(),
    );
    expect(stored?.nextDueOn).toBe("2026-07-10");
  });

  test("resuming a paused rule skips what fell due while it was paused", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T12:00:00Z"));
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    const id = uid("rule");
    const push = (editedAt: number, pausedAt: number | undefined) =>
      as.mutation(api.sync.push, {
        changes: [
          {
            table: "recurringRules",
            uid: id,
            editedAt,
            deleted: false,
            data: rule(space.uid, { pausedAt }),
          },
        ],
      });
    await push(1, undefined);
    await push(2, 2);
    expect(await logged(t, id)).toEqual(["2026-01-10", "2026-02-10"]);

    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    await t.mutation(internal.recurring.materializeDue, {});
    await push(Date.now(), undefined);
    expect(await logged(t, id)).toEqual(["2026-01-10", "2026-02-10"]);

    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"));
    await t.mutation(internal.recurring.materializeDue, {});
    expect(await logged(t, id)).toEqual(["2026-01-10", "2026-02-10", "2026-07-10"]);
  });

  test("a resume made offline counts from when it was made, not when it synced", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T12:00:00Z"));
    const t = setup();
    const { as, space } = await signedIn(t, "alice");
    const id = uid("rule");
    const push = (editedAt: number, pausedAt: number | undefined) =>
      as.mutation(api.sync.push, {
        changes: [
          {
            table: "recurringRules",
            uid: id,
            editedAt,
            deleted: false,
            data: rule(space.uid, { pausedAt }),
          },
        ],
      });
    await push(1, 2);

    // Resumed on 15 Jun while offline, synced on 15 Aug.
    vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));
    await push(Date.UTC(2026, 5, 15, 12), undefined);
    expect(await logged(t, id)).toEqual(["2026-07-10", "2026-08-10"]);
  });
});
