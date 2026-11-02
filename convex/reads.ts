import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { authedQuery } from "./lib/auth";
import { isCalendarDate } from "./lib/dates";
import { memberSpaces, membership, requireSpace, spaceByUid } from "./lib/spaces";

// Live queries for always-online clients (the web app). Offline-first clients use
// `sync.pull` instead. Writes from every client go through `sync.push`.

const MAX_RANGE_ENTRIES = 5_000;

/** The signed-in user and the spaces they can open, in their chosen order. */
export const account = authedQuery({
  args: {},
  handler: async (ctx) => {
    const spaces = [];
    for (const space of await memberSpaces(ctx, ctx.user._id)) {
      if (space.deletedAt !== undefined) continue;
      const member = await membership(ctx, space._id, ctx.user._id);
      if (member) spaces.push({ ...space, role: member.role });
    }
    spaces.sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      user: {
        name: ctx.user.name ?? null,
        email: ctx.user.email ?? null,
        timeZone: ctx.user.timeZone,
      },
      spaces,
    };
  },
});

export const paymentMethods = authedQuery({
  args: {},
  handler: async (ctx) => {
    const methods = await ctx.db
      .query("paymentMethods")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .collect();
    return methods
      .filter((m) => m.deletedAt === undefined)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

/** Categories, budgets and repeating rules of one space: small, so they come back whole. */
export const spaceSetup = authedQuery({
  args: { spaceUid: v.string() },
  handler: async (ctx, { spaceUid }) => {
    await requireSpace(ctx, ctx.user, spaceUid, "viewer");
    const [categories, budgets, recurringRules] = await Promise.all([
      ctx.db
        .query("categories")
        .withIndex("by_space_seq", (q) => q.eq("spaceUid", spaceUid))
        .collect(),
      ctx.db
        .query("budgets")
        .withIndex("by_space_seq", (q) => q.eq("spaceUid", spaceUid))
        .collect(),
      ctx.db
        .query("recurringRules")
        .withIndex("by_space_seq", (q) => q.eq("spaceUid", spaceUid))
        .collect(),
    ]);
    const live = <T extends { deletedAt?: number }>(rows: T[]) =>
      rows.filter((r) => r.deletedAt === undefined);
    return {
      categories: live(categories).sort((a, b) => a.sortOrder - b.sortOrder),
      budgets: live(budgets),
      recurringRules: live(recurringRules).sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn)),
    };
  },
});

/** Entries dated between `from` and `to` (inclusive), for a budget period. */
export const entriesInRange = authedQuery({
  args: { spaceUid: v.string(), from: v.string(), to: v.string() },
  handler: async (ctx, { spaceUid, from, to }) => {
    await requireSpace(ctx, ctx.user, spaceUid, "viewer");
    if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) return [];
    return await ctx.db
      .query("transactions")
      .withIndex("by_space_occurredOn", (q) =>
        q.eq("spaceUid", spaceUid).gte("occurredOn", from).lte("occurredOn", to),
      )
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .order("desc")
      .take(MAX_RANGE_ENTRIES);
  },
});

/** Every entry in a space, newest first, a page at a time. */
export const entriesPage = authedQuery({
  args: { spaceUid: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { spaceUid, paginationOpts }) => {
    await requireSpace(ctx, ctx.user, spaceUid, "viewer");
    return await ctx.db
      .query("transactions")
      .withIndex("by_space_occurredOn", (q) => q.eq("spaceUid", spaceUid))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .order("desc")
      .paginate(paginationOpts);
  },
});

/** Both legs of a transfer, for editing it. Only legs in spaces the user can open. */
export const transferLegs = authedQuery({
  args: { transferUid: v.string() },
  handler: async (ctx, { transferUid }) => {
    const legs = await ctx.db
      .query("transactions")
      .withIndex("by_transferUid", (q) => q.eq("transferUid", transferUid))
      .take(2);
    const visible = [];
    for (const leg of legs) {
      if (leg.deletedAt !== undefined) continue;
      const space = await spaceByUid(ctx, leg.spaceUid);
      if (space && (await membership(ctx, space._id, ctx.user._id))) visible.push(leg);
    }
    return visible;
  },
});
