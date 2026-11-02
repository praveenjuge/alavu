import { ConvexError } from "convex/values";
import { customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import type { Doc } from "../_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx, query } from "../_generated/server";

export async function getUser(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const user = await getUser(ctx);
  if (!user) throw new ConvexError("Not signed in");
  return user;
}

/** Query that requires a signed-in user who has completed `users.ensure`. */
export const authedQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ user: await requireUser(ctx) })),
);

/** Mutation that requires a signed-in user who has completed `users.ensure`. */
export const authedMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ user: await requireUser(ctx) })),
);
