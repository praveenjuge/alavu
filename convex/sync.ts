import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { authedMutation, authedQuery } from "./lib/auth";
import { isCalendarDate, nextOccurrence, occurrenceOnOrAfter, todayIn } from "./lib/dates";
import { seedCategories } from "./lib/defaults";
import { bumpMembers, memberSpaces, nextSpaceSeq, requireSpace, spaceByUid } from "./lib/spaces";
import { materializeRule, NEVER, ownerTimeZone } from "./recurring";
import { cadence, categoryKind, transactionKind } from "./schema";

// Offline-first sync protocol shared by every client.
//
// Push: clients queue local edits and send them as `changes`. Each change carries the
// record's `uid`, the client clock `editedAt` (last write wins) and either `data` or
// `deleted: true`. Tombstones are final, except for budgets, whose uid is fixed per
// space and category. All changes in one push apply atomically,
// so an edit that touches several records (like a transfer's two legs) lands together.
//
// Pull: clients subscribe to `head` and, when a counter moves past their cursor, call
// `pull` to fetch what changed. Space lists and payment methods are small and come
// back whole; records inside a space come back by `seq`.

const base = { uid: v.string(), editedAt: v.number(), deleted: v.boolean() };

const spaceData = v.object({
  name: v.string(),
  symbol: v.string(),
  tint: v.string(),
  currency: v.string(),
  monthStartDay: v.number(),
  sortOrder: v.number(),
  archivedAt: v.optional(v.number()),
});
const paymentMethodData = v.object({ name: v.string(), symbol: v.string(), sortOrder: v.number() });
const categoryData = v.object({
  spaceUid: v.string(),
  name: v.string(),
  symbol: v.string(),
  kind: categoryKind,
  sortOrder: v.number(),
  archivedAt: v.optional(v.number()),
});
const transactionData = v.object({
  spaceUid: v.string(),
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
});
const budgetData = v.object({
  spaceUid: v.string(),
  categoryUid: v.optional(v.string()),
  amountMinor: v.int64(),
});
const recurringRuleData = v.object({
  spaceUid: v.string(),
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
  pausedAt: v.optional(v.number()),
});

// For deletes of space-scoped records, `data` may be omitted; the server knows the space.
const change = v.union(
  v.object({ table: v.literal("spaces"), ...base, data: v.optional(spaceData) }),
  v.object({ table: v.literal("paymentMethods"), ...base, data: v.optional(paymentMethodData) }),
  v.object({ table: v.literal("categories"), ...base, data: v.optional(categoryData) }),
  v.object({ table: v.literal("transactions"), ...base, data: v.optional(transactionData) }),
  v.object({ table: v.literal("budgets"), ...base, data: v.optional(budgetData) }),
  v.object({ table: v.literal("recurringRules"), ...base, data: v.optional(recurringRuleData) }),
);
type Change = Infer<typeof change>;

const MAX_CHANGES = 100;
const MAX_TEXT = 500;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ConvexError(message);
}

function checkText(value: string | undefined, label: string, required = false) {
  if (required) check(value && value.trim().length > 0, `${label} is required`);
  check(value === undefined || value.length <= MAX_TEXT, `${label} is too long`);
}

function checkCurrency(currency: string) {
  check(/^[A-Z]{3}$/.test(currency), "Invalid currency");
}

function checkAmount(amount: bigint) {
  check(amount >= 0n && amount <= 1_000_000_000_000_000n, "Invalid amount");
}

export const push = authedMutation({
  args: { changes: v.array(change) },
  handler: async (ctx, { changes }) => {
    check(changes.length <= MAX_CHANGES, "Too many changes");
    let applied = 0;
    for (const c of changes) {
      check(c.deleted || c.data !== undefined, "Missing data");
      if (await apply(ctx, ctx.user, c)) applied++;
    }
    return { applied };
  },
});

async function apply(ctx: MutationCtx, user: Doc<"users">, c: Change): Promise<boolean> {
  switch (c.table) {
    case "spaces":
      return applySpace(ctx, user, c);
    case "paymentMethods":
      return applyPaymentMethod(ctx, user, c);
    default:
      return applySpaceRecord(ctx, user, c);
  }
}

async function applySpace(
  ctx: MutationCtx,
  user: Doc<"users">,
  c: Extract<Change, { table: "spaces" }>,
) {
  const existing = await spaceByUid(ctx, c.uid);
  if (!existing) {
    if (c.deleted || !c.data) return false;
    validateSpace(c.data);
    const spaceId = await ctx.db.insert("spaces", {
      uid: c.uid,
      ...c.data,
      isDefault: false,
      editedAt: c.editedAt,
      seq: 0,
    });
    await ctx.db.insert("spaceMembers", { spaceId, userId: user._id, role: "owner" });
    const space = await ctx.db.get(spaceId);
    if (space) await seedCategories(ctx, space);
    await bumpMembers(ctx, spaceId);
    return true;
  }
  await requireSpace(ctx, user, c.uid, c.deleted ? "owner" : "editor");
  if (existing.editedAt > c.editedAt) return false;
  if (c.deleted) {
    check(!existing.isDefault, "The default space can't be deleted");
    await ctx.db.patch(existing._id, { deletedAt: Date.now(), editedAt: c.editedAt });
    await ctx.scheduler.runAfter(0, internal.spaces.purge, { spaceUid: existing.uid });
  } else if (c.data) {
    validateSpace(c.data);
    // Each record stores its own currency, so changing it only affects new entries.
    // `archivedAt` is reset first so that leaving it out un-archives the space.
    await ctx.db.patch(existing._id, { archivedAt: undefined, ...c.data, editedAt: c.editedAt });
  }
  await bumpMembers(ctx, existing._id);
  return true;
}

function validateSpace(data: Infer<typeof spaceData>) {
  checkText(data.name, "Name", true);
  checkCurrency(data.currency);
  check(
    Number.isInteger(data.monthStartDay) && data.monthStartDay >= 1 && data.monthStartDay <= 28,
    "Invalid month start day",
  );
}

async function applyPaymentMethod(
  ctx: MutationCtx,
  user: Doc<"users">,
  c: Extract<Change, { table: "paymentMethods" }>,
) {
  const existing = await ctx.db
    .query("paymentMethods")
    .withIndex("by_uid", (q) => q.eq("uid", c.uid))
    .unique();
  if (existing) {
    check(existing.userId === user._id, "Not found");
    if (existing.deletedAt !== undefined || existing.editedAt > c.editedAt) return false;
  }
  if (c.deleted) {
    if (!existing) return false;
    await ctx.db.patch(existing._id, { deletedAt: Date.now(), editedAt: c.editedAt });
  } else if (c.data) {
    checkText(c.data.name, "Name", true);
    if (existing) await ctx.db.patch(existing._id, { ...c.data, editedAt: c.editedAt });
    else
      await ctx.db.insert("paymentMethods", {
        userId: user._id,
        uid: c.uid,
        ...c.data,
        editedAt: c.editedAt,
      });
  }
  await ctx.db.patch(user._id, { seq: user.seq + 1 });
  user.seq += 1;
  return true;
}

type SpaceRecordChange = Exclude<Change, { table: "spaces" | "paymentMethods" }>;

async function applySpaceRecord(ctx: MutationCtx, user: Doc<"users">, c: SpaceRecordChange) {
  const existing = await ctx.db
    .query(c.table)
    .withIndex("by_uid", (q) => q.eq("uid", c.uid))
    .unique();
  if (existing && c.data) check(existing.spaceUid === c.data.spaceUid, "Records can't move spaces");
  const spaceUid = existing?.spaceUid ?? c.data?.spaceUid;
  if (!spaceUid) return false;
  const space = await requireSpace(ctx, user, spaceUid, "editor");
  // Tombstones are final, except for budgets: each space and category has one fixed
  // budget uid, so setting a budget again after removing it has to bring it back.
  const revives = c.table === "budgets" && !c.deleted;
  if (
    existing &&
    ((existing.deletedAt !== undefined && !revives) || existing.editedAt > c.editedAt)
  )
    return false;

  if (c.deleted) {
    if (!existing) return false;
    await ctx.db.patch(existing._id, {
      deletedAt: Date.now(),
      editedAt: c.editedAt,
      seq: await nextSpaceSeq(ctx, space),
      ...(c.table === "recurringRules" ? { nextDueOn: NEVER } : {}),
    });
    if (c.table === "transactions" && "receiptKeys" in existing && existing.receiptKeys.length) {
      await ctx.scheduler.runAfter(0, internal.receipts.deleteObjects, {
        keys: existing.receiptKeys,
      });
    }
    return true;
  }

  switch (c.table) {
    case "categories": {
      const d = c.data;
      if (!d) return false;
      checkText(d.name, "Name", true);
      await upsert(ctx, "categories", existing?._id, { uid: c.uid, ...d }, c.editedAt, space);
      return true;
    }
    case "transactions": {
      const d = c.data;
      if (!d) return false;
      checkText(d.title, "Title", true);
      checkText(d.note, "Note");
      checkAmount(d.amountMinor);
      checkCurrency(d.currency);
      check(isCalendarDate(d.occurredOn), "Invalid date");
      check(d.receiptKeys.length <= 10, "Too many receipts");
      for (const key of d.receiptKeys) check(key.startsWith(`${d.spaceUid}/`), "Invalid receipt");
      check(
        (d.kind === "transferOut" || d.kind === "transferIn") === !!d.transferUid,
        "Invalid transfer",
      );
      if (existing && "receiptKeys" in existing) {
        const removed = existing.receiptKeys.filter((k) => !d.receiptKeys.includes(k));
        if (removed.length) {
          await ctx.scheduler.runAfter(0, internal.receipts.deleteObjects, { keys: removed });
        }
      }
      await upsert(ctx, "transactions", existing?._id, { uid: c.uid, ...d }, c.editedAt, space);
      return true;
    }
    case "budgets": {
      const d = c.data;
      if (!d) return false;
      checkAmount(d.amountMinor);
      await upsert(ctx, "budgets", existing?._id, { uid: c.uid, ...d }, c.editedAt, space);
      return true;
    }
    case "recurringRules": {
      const d = c.data;
      if (!d) return false;
      checkText(d.title, "Title", true);
      checkText(d.note, "Note");
      checkAmount(d.amountMinor);
      checkCurrency(d.currency);
      check(isCalendarDate(d.startOn), "Invalid start date");
      check(d.endOn === undefined || isCalendarDate(d.endOn), "Invalid end date");
      check(
        Number.isInteger(d.interval) && d.interval >= 1 && d.interval <= 52,
        "Invalid interval",
      );
      // A schedule edit restarts from its start date; occurrences already logged are kept
      // because generated entries use deterministic ids.
      const prior = existing && "nextDueOn" in existing ? existing : null;
      const sameSchedule =
        prior &&
        prior.startOn === d.startOn &&
        prior.cadence === d.cadence &&
        prior.interval === d.interval;
      let nextDueOn = sameSchedule ? prior.nextDueOn : d.startOn;
      let resumeOn = sameSchedule ? prior.resumeOn : undefined;
      // A rule that ended picks up after its old end date, so moving the end date later
      // (or removing it) starts it again. It never goes back before its last resume.
      if (sameSchedule && nextDueOn === NEVER && prior.endOn !== undefined) {
        nextDueOn = nextOccurrence(d.startOn, d.cadence, d.interval, prior.endOn);
        if (resumeOn !== undefined && resumeOn > nextDueOn) nextDueOn = resumeOn;
      }
      // Resuming skips what fell due while paused instead of logging it all at once. The
      // pause ended when the edit was made, which for an offline device can be well before
      // it syncs, so the edit's own time decides (capped at now, for clocks set ahead).
      if (prior?.pausedAt !== undefined && d.pausedAt === undefined) {
        const resumedAt = Math.min(c.editedAt, Date.now());
        const today = todayIn(await ownerTimeZone(ctx, space._id), resumedAt);
        resumeOn = occurrenceOnOrAfter(d.startOn, d.cadence, d.interval, today);
        if (resumeOn > nextDueOn) nextDueOn = resumeOn;
      }
      const id = await upsert(
        ctx,
        "recurringRules",
        existing?._id,
        { uid: c.uid, ...d, nextDueOn, resumeOn },
        c.editedAt,
        space,
      );
      await materializeRule(ctx, id);
      return true;
    }
  }
}

async function upsert<T extends "categories" | "transactions" | "budgets" | "recurringRules">(
  ctx: MutationCtx,
  table: T,
  id: Id<TableNames> | undefined,
  fields: Omit<Doc<T>, "_id" | "_creationTime" | "editedAt" | "seq">,
  editedAt: number,
  space: Doc<"spaces">,
): Promise<Id<T>> {
  const seq = await nextSpaceSeq(ctx, space);
  const doc = { ...fields, editedAt, seq } as never;
  if (id) {
    await ctx.db.replace(id as Id<T>, doc);
    return id as Id<T>;
  }
  return await ctx.db.insert(table, doc);
}

/** Cheap counters clients subscribe to; a change means there is something to pull. */
export const head = authedQuery({
  args: {},
  handler: async (ctx) => {
    const spaces = await memberSpaces(ctx, ctx.user._id);
    return {
      userSeq: ctx.user.seq,
      spaces: spaces.map((s) => ({ uid: s.uid, seq: s.seq })),
    };
  },
});

const PAGE = 200;

export const pull = authedQuery({
  args: {
    userSince: v.number(),
    spaces: v.array(v.object({ uid: v.string(), since: v.number() })),
  },
  handler: async (ctx, args) => {
    const user = ctx.user;
    const all = await memberSpaces(ctx, user._id);
    const accountChanged = args.userSince < user.seq;
    const paymentMethods = accountChanged
      ? await ctx.db
          .query("paymentMethods")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect()
      : null;

    const records = [];
    for (const { uid, since } of args.spaces.slice(0, 50)) {
      const space = all.find((s) => s.uid === uid);
      if (!space || space.deletedAt !== undefined || since >= space.seq) continue;
      const tables = ["categories", "transactions", "budgets", "recurringRules"] as const;
      const pages = await Promise.all(
        tables.map((t) =>
          ctx.db
            .query(t)
            .withIndex("by_space_seq", (q) => q.eq("spaceUid", uid).gt("seq", since))
            .take(PAGE + 1),
        ),
      );
      // If any table was cut short, stop at the lowest seq we could not fully cover
      // so the next pull continues from there without gaps.
      let cursor = space.seq;
      for (const page of pages) {
        if (page.length > PAGE) cursor = Math.min(cursor, page[PAGE - 1].seq);
      }
      const [categories, transactions, budgets, recurringRules] = pages.map((p) =>
        p.filter((r) => r.seq <= cursor),
      ) as [Doc<"categories">[], Doc<"transactions">[], Doc<"budgets">[], Doc<"recurringRules">[]];
      records.push({
        spaceUid: uid,
        cursor,
        hasMore: cursor < space.seq,
        categories,
        transactions,
        budgets,
        recurringRules,
      });
    }

    return {
      userSeq: user.seq,
      spaces: accountChanged ? all : null,
      paymentMethods,
      records,
    };
  },
});
