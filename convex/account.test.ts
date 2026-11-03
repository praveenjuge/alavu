import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { setup, signedIn } from "./test.setup";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("deleteAccount", () => {
  test("a repeated delete succeeds without calling WorkOS again", async () => {
    vi.stubEnv("WORKOS_API_KEY", "sk_test");
    const workos = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", workos);
    const t = setup();
    const { as } = await signedIn(t, "alice");

    await as.action(api.account.deleteAccount, {});
    // The client re-sends an action whose reply it never got.
    await as.action(api.account.deleteAccount, {});

    expect(workos).toHaveBeenCalledTimes(1);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });

  test("rejects unauthenticated calls", async () => {
    const t = setup();
    await expect(t.action(api.account.deleteAccount, {})).rejects.toThrow(/Not signed in/);
  });
});
