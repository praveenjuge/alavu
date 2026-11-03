import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { getUser } from "./lib/auth";
import { memberSpaces } from "./lib/spaces";

/**
 * Permanently deletes the signed-in user's data, their WorkOS account, and then their
 * user record. Spaces they own are purged with all their records and receipts.
 */
export const deleteAccount = action({
  args: {},
  handler: async (ctx) => {
    if (!(await ctx.auth.getUserIdentity())) throw new ConvexError("Not signed in");
    const user = await ctx.runQuery(internal.account.currentUser, {});
    // The client re-sends an action whose reply it never got, and the app retries one that
    // timed out. Either way a deletion that already finished leaves no user record, and
    // the WorkOS account went before the record did, so there's nothing left to do.
    if (!user) return;
    await ctx.runMutation(internal.account.deleteData, { userId: user._id });

    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey) throw new ConvexError("Account deletion is not configured");
    const response = await fetch(
      `https://api.workos.com/user_management/users/${encodeURIComponent(user.workosUserId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!response.ok && response.status !== 404) {
      throw new ConvexError(`Couldn't delete the sign-in account (${response.status})`);
    }
    await ctx.runMutation(internal.account.deleteUser, { userId: user._id });
  },
});

export const currentUser = internalQuery({
  args: {},
  handler: async (ctx) => await getUser(ctx),
});

export const deleteData = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const now = Date.now();
    for (const space of await memberSpaces(ctx, userId)) {
      const member = await ctx.db
        .query("spaceMembers")
        .withIndex("by_space_user", (q) => q.eq("spaceId", space._id).eq("userId", userId))
        .unique();
      if (member?.role === "owner") {
        await ctx.db.patch(space._id, { deletedAt: now });
        await ctx.scheduler.runAfter(0, internal.spaces.purge, { spaceUid: space.uid });
      } else if (member) {
        await ctx.db.delete(member._id);
      }
    }
    const methods = await ctx.db
      .query("paymentMethods")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const m of methods) await ctx.db.delete(m._id);
  },
});

export const deleteUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await ctx.db.delete(userId);
  },
});
