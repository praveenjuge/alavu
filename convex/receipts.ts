import { R2 } from "@convex-dev/r2";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { authedMutation } from "./lib/auth";
import { requireSpace } from "./lib/spaces";

export const r2 = new R2(components.r2);

/** Keys are `<spaceUid>/<uuid>` so access is checked through space membership. */
export const uploadUrl = authedMutation({
  args: { spaceUid: v.string() },
  handler: async (ctx, { spaceUid }) => {
    await requireSpace(ctx, ctx.user, spaceUid, "editor");
    return await r2.generateUploadUrl(`${spaceUid}/${crypto.randomUUID()}`);
  },
});

export const downloadUrl = authedMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const spaceUid = key.split("/")[0];
    if (!spaceUid) throw new ConvexError("Not found");
    await requireSpace(ctx, ctx.user, spaceUid, "viewer");
    return await r2.getUrl(key, { expiresIn: 15 * 60 });
  },
});

export const deleteObjects = internalMutation({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    for (const key of keys) await r2.deleteObject(ctx, key);
  },
});
