/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as crons from "../crons.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_defaults from "../lib/defaults.js";
import type * as lib_spaces from "../lib/spaces.js";
import type * as reads from "../reads.js";
import type * as receipts from "../receipts.js";
import type * as recurring from "../recurring.js";
import type * as signIn from "../signIn.js";
import type * as spaces from "../spaces.js";
import type * as sync from "../sync.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  crons: typeof crons;
  "lib/auth": typeof lib_auth;
  "lib/dates": typeof lib_dates;
  "lib/defaults": typeof lib_defaults;
  "lib/spaces": typeof lib_spaces;
  reads: typeof reads;
  receipts: typeof receipts;
  recurring: typeof recurring;
  signIn: typeof signIn;
  spaces: typeof spaces;
  sync: typeof sync;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
};
