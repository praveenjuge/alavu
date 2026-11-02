import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Every synced record has a client-generated `uid` (UUID) that all clients use as
// its identity and for references. `editedAt` (client clock) decides last-write-wins,
// `deletedAt` marks a tombstone, and `seq` is the owning space's change counter so
// clients can pull exactly what changed.

export const role = v.union(v.literal("owner"), v.literal("editor"), v.literal("viewer"));
export const categoryKind = v.union(v.literal("expense"), v.literal("income"));
export const transactionKind = v.union(
  v.literal("expense"),
  v.literal("income"),
  v.literal("transferOut"),
  v.literal("transferIn"),
);
export const cadence = v.union(v.literal("weekly"), v.literal("monthly"), v.literal("yearly"));

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    workosUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    timeZone: v.string(),
    // Bumped whenever the user's space list or payment methods change.
    seq: v.number(),
  }).index("by_token", ["tokenIdentifier"]),

  spaces: defineTable({
    uid: v.string(),
    name: v.string(),
    symbol: v.string(),
    tint: v.string(),
    currency: v.string(),
    monthStartDay: v.number(),
    isDefault: v.boolean(),
    sortOrder: v.number(),
    archivedAt: v.optional(v.number()),
    editedAt: v.number(),
    deletedAt: v.optional(v.number()),
    // Change counter for records inside this space.
    seq: v.number(),
  }).index("by_uid", ["uid"]),

  spaceMembers: defineTable({
    spaceId: v.id("spaces"),
    userId: v.id("users"),
    role,
  })
    .index("by_user", ["userId"])
    .index("by_space", ["spaceId"])
    .index("by_space_user", ["spaceId", "userId"]),

  paymentMethods: defineTable({
    userId: v.id("users"),
    uid: v.string(),
    name: v.string(),
    symbol: v.string(),
    sortOrder: v.number(),
    editedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_uid", ["uid"]),

  categories: defineTable({
    spaceUid: v.string(),
    uid: v.string(),
    name: v.string(),
    symbol: v.string(),
    kind: categoryKind,
    sortOrder: v.number(),
    archivedAt: v.optional(v.number()),
    editedAt: v.number(),
    deletedAt: v.optional(v.number()),
    seq: v.number(),
  })
    .index("by_uid", ["uid"])
    .index("by_space_seq", ["spaceUid", "seq"]),

  transactions: defineTable({
    spaceUid: v.string(),
    uid: v.string(),
    kind: transactionKind,
    amountMinor: v.int64(),
    currency: v.string(),
    title: v.string(),
    note: v.optional(v.string()),
    categoryUid: v.optional(v.string()),
    paymentMethodUid: v.optional(v.string()),
    occurredOn: v.string(),
    transferUid: v.optional(v.string()),
    recurringRuleUid: v.optional(v.string()),
    receiptKeys: v.array(v.string()),
    editedAt: v.number(),
    deletedAt: v.optional(v.number()),
    seq: v.number(),
  })
    .index("by_uid", ["uid"])
    .index("by_space_seq", ["spaceUid", "seq"])
    .index("by_space_occurredOn", ["spaceUid", "occurredOn"])
    .index("by_transferUid", ["transferUid"]),

  budgets: defineTable({
    spaceUid: v.string(),
    uid: v.string(),
    categoryUid: v.optional(v.string()),
    amountMinor: v.int64(),
    editedAt: v.number(),
    deletedAt: v.optional(v.number()),
    seq: v.number(),
  })
    .index("by_uid", ["uid"])
    .index("by_space_seq", ["spaceUid", "seq"]),

  recurringRules: defineTable({
    spaceUid: v.string(),
    uid: v.string(),
    kind: categoryKind,
    amountMinor: v.int64(),
    currency: v.string(),
    title: v.string(),
    note: v.optional(v.string()),
    categoryUid: v.optional(v.string()),
    paymentMethodUid: v.optional(v.string()),
    cadence,
    interval: v.number(),
    startOn: v.string(),
    endOn: v.optional(v.string()),
    nextDueOn: v.string(),
    pausedAt: v.optional(v.number()),
    editedAt: v.number(),
    deletedAt: v.optional(v.number()),
    seq: v.number(),
  })
    .index("by_uid", ["uid"])
    .index("by_space_seq", ["spaceUid", "seq"])
    .index("by_nextDueOn", ["nextDueOn"]),
});
