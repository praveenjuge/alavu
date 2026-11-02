import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { nextOccurrence, todayIn } from "./lib/dates";
import { nextSpaceSeq, spaceByUid } from "./lib/spaces";

/** Rules that will never fire again park here so the due-date scan skips them. */
export const NEVER = "9999-12-31";
const MAX_CATCH_UP = 60;

export async function ownerTimeZone(ctx: MutationCtx, spaceId: Id<"spaces">) {
  const members = await ctx.db
    .query("spaceMembers")
    .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
    .collect();
  const owner = members.find((m) => m.role === "owner");
  const user = owner ? await ctx.db.get(owner.userId) : null;
  return user?.timeZone ?? "UTC";
}

/**
 * Logs every occurrence of a rule that is due by today in the owner's time zone.
 * Generated entries use `<ruleUid>:<date>` as their uid, so running this twice, or
 * after the user deleted a generated entry, never creates duplicates.
 */
export async function materializeRule(ctx: MutationCtx, ruleId: Id<"recurringRules">) {
  const rule = await ctx.db.get(ruleId);
  if (!rule || rule.deletedAt !== undefined || rule.pausedAt !== undefined) return;
  const space = await spaceByUid(ctx, rule.spaceUid);
  if (!space || space.deletedAt !== undefined) return;
  const today = todayIn(await ownerTimeZone(ctx, space._id));

  let next = rule.nextDueOn;
  for (let i = 0; i < MAX_CATCH_UP && next <= today; i++) {
    if (rule.endOn !== undefined && next > rule.endOn) break;
    const uid = `${rule.uid}:${next}`;
    const exists = await ctx.db
      .query("transactions")
      .withIndex("by_uid", (q) => q.eq("uid", uid))
      .unique();
    if (!exists) {
      await ctx.db.insert("transactions", {
        spaceUid: rule.spaceUid,
        uid,
        kind: rule.kind,
        amountMinor: rule.amountMinor,
        currency: rule.currency,
        title: rule.title,
        note: rule.note,
        categoryUid: rule.categoryUid,
        paymentMethodUid: rule.paymentMethodUid,
        occurredOn: next,
        recurringRuleUid: rule.uid,
        receiptKeys: [],
        // Server-made records lose to any user edit regardless of device clocks.
        editedAt: 0,
        seq: await nextSpaceSeq(ctx, space),
      });
    }
    next = nextOccurrence(rule.startOn, rule.cadence, rule.interval, next);
  }
  if (rule.endOn !== undefined && next > rule.endOn) next = NEVER;
  if (next !== rule.nextDueOn) {
    await ctx.db.patch(rule._id, { nextDueOn: next, seq: await nextSpaceSeq(ctx, space) });
  }
}

/** Hourly: walks rules due by tomorrow (UTC), the latest any time zone can be. */
export const materializeDue = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const horizon = new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
    const page = await ctx.db
      .query("recurringRules")
      .withIndex("by_nextDueOn", (q) => q.lte("nextDueOn", horizon))
      .paginate({ numItems: 100, cursor: cursor ?? null });
    for (const rule of page.page) await materializeRule(ctx, rule._id);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.recurring.materializeDue, {
        cursor: page.continueCursor,
      });
    }
  },
});
