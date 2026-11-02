import { ConvexError, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { role as roleValidator } from "../schema";

type Role = Infer<typeof roleValidator>;
const rank: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

export async function spaceByUid(ctx: QueryCtx, uid: string) {
  return await ctx.db
    .query("spaces")
    .withIndex("by_uid", (q) => q.eq("uid", uid))
    .unique();
}

export async function membership(ctx: QueryCtx, spaceId: Id<"spaces">, userId: Id<"users">) {
  return await ctx.db
    .query("spaceMembers")
    .withIndex("by_space_user", (q) => q.eq("spaceId", spaceId).eq("userId", userId))
    .unique();
}

/** Loads a live space the user belongs to with at least `minRole`, or throws. */
export async function requireSpace(
  ctx: QueryCtx,
  user: Doc<"users">,
  spaceUid: string,
  minRole: Role,
) {
  const space = await spaceByUid(ctx, spaceUid);
  const member = space ? await membership(ctx, space._id, user._id) : null;
  if (!space || space.deletedAt !== undefined || !member || rank[member.role] < rank[minRole]) {
    throw new ConvexError("Space not found");
  }
  return space;
}

/** Spaces the user belongs to, including tombstoned ones so clients can drop them. */
export async function memberSpaces(ctx: QueryCtx, userId: Id<"users">) {
  const members = await ctx.db
    .query("spaceMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const spaces = await Promise.all(members.map((m) => ctx.db.get(m.spaceId)));
  return spaces.filter((s): s is Doc<"spaces"> => s !== null);
}

/** Advances a space's change counter and returns the seq for the record being written. */
export async function nextSpaceSeq(ctx: MutationCtx, space: Doc<"spaces">) {
  const seq = space.seq + 1;
  await ctx.db.patch(space._id, { seq });
  space.seq = seq;
  return seq;
}

/** Signals every member that their space list changed. */
export async function bumpMembers(ctx: MutationCtx, spaceId: Id<"spaces">) {
  const members = await ctx.db
    .query("spaceMembers")
    .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
    .collect();
  for (const m of members) {
    const user = await ctx.db.get(m.userId);
    if (user) await ctx.db.patch(user._id, { seq: user.seq + 1 });
  }
}
