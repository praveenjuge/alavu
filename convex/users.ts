import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { authedMutation, getUser } from "./lib/auth";
import { seedCategories, seedPaymentMethods } from "./lib/defaults";
import { memberSpaces } from "./lib/spaces";

/** Creates or refreshes the signed-in user's record. Safe to call on every launch. */
export const ensure = mutation({
  args: {
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    timeZone: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not signed in");
    const existing = await getUser(ctx);
    if (existing) {
      await ctx.db.patch(existing._id, {
        timeZone: args.timeZone,
        ...(args.name ? { name: args.name } : {}),
        ...(args.email ? { email: args.email } : {}),
      });
      return { isNew: false };
    }
    await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      workosUserId: identity.subject,
      name: args.name,
      email: args.email,
      timeZone: args.timeZone,
      seq: 1,
    });
    return { isNew: true };
  },
});

/**
 * First-run setup: creates the default "Personal" space and payment methods.
 * Does nothing if the user already has a space, so two devices can't double-create.
 */
export const setup = authedMutation({
  args: { currency: v.string(), monthStartDay: v.number() },
  handler: async (ctx, { currency, monthStartDay }) => {
    if (!/^[A-Z]{3}$/.test(currency)) throw new ConvexError("Invalid currency");
    if (!Number.isInteger(monthStartDay) || monthStartDay < 1 || monthStartDay > 28) {
      throw new ConvexError("Invalid month start day");
    }
    const spaces = await memberSpaces(ctx, ctx.user._id);
    if (spaces.length > 0) return null;
    const now = Date.now();
    const spaceId = await ctx.db.insert("spaces", {
      uid: crypto.randomUUID(),
      name: "Personal",
      symbol: "person.crop.circle",
      tint: "green",
      currency,
      monthStartDay,
      isDefault: true,
      sortOrder: 0,
      editedAt: now,
      seq: 0,
    });
    await ctx.db.insert("spaceMembers", { spaceId, userId: ctx.user._id, role: "owner" });
    const space = await ctx.db.get(spaceId);
    if (space) await seedCategories(ctx, space);
    await seedPaymentMethods(ctx, ctx.user._id, currency);
    await ctx.db.patch(ctx.user._id, { seq: ctx.user.seq + 1 });
    return null;
  },
});
