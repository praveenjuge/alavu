import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const BATCH = 200;

/**
 * Hard-deletes everything inside a deleted space in batches, then the space itself.
 * Clients drop a tombstoned space's records on their own, so this only frees storage.
 */
export const purge = internalMutation({
  args: { spaceUid: v.string() },
  handler: async (ctx, { spaceUid }) => {
    let remaining = BATCH;
    for (const table of ["transactions", "categories", "budgets", "recurringRules"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_space_seq", (q) => q.eq("spaceUid", spaceUid))
        .take(remaining);
      for (const row of rows) {
        if ("receiptKeys" in row && row.receiptKeys.length) {
          await ctx.scheduler.runAfter(0, internal.receipts.deleteObjects, {
            keys: row.receiptKeys,
          });
        }
        await ctx.db.delete(row._id);
      }
      remaining -= rows.length;
      if (remaining === 0) {
        await ctx.scheduler.runAfter(0, internal.spaces.purge, { spaceUid });
        return;
      }
    }
    const space = await ctx.db
      .query("spaces")
      .withIndex("by_uid", (q) => q.eq("uid", spaceUid))
      .unique();
    if (!space) return;
    const members = await ctx.db
      .query("spaceMembers")
      .withIndex("by_space", (q) => q.eq("spaceId", space._id))
      .collect();
    for (const m of members) await ctx.db.delete(m._id);
    // Keep the tombstone only while it might still be unsynced on another device.
    if (space.deletedAt !== undefined) await ctx.db.delete(space._id);
  },
});
