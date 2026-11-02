import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";

/**
 * Finishes a sign-in that WorkOS paused with `email_verification_required`, which
 * happens when someone signs in with a second provider (say Google after Apple) and
 * WorkOS wants proof they own the email before linking it. WorkOS only accepts the
 * code with the client secret, so the app sends the code here instead of to WorkOS.
 *
 * Returns the same shape as the app's stored session.
 */
export const verifyEmail = action({
  args: { pendingAuthenticationToken: v.string(), code: v.string() },
  handler: async (_ctx, { pendingAuthenticationToken, code }) => {
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) throw new ConvexError("Enter the 6-digit code from the email.");
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(pendingAuthenticationToken)) {
      throw new ConvexError("Sign-in expired. Please try again.");
    }

    const clientId = process.env.WORKOS_CLIENT_ID;
    const apiKey = process.env.WORKOS_API_KEY;
    if (!clientId || !apiKey) throw new ConvexError("Sign-in is not configured");

    const response = await fetch("https://api.workos.com/user_management/authenticate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: apiKey,
        grant_type: "urn:workos:oauth:grant-type:email-verification:code",
        code: trimmed,
        pending_authentication_token: pendingAuthenticationToken,
      }),
    });
    const body = (await response.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      user?: { id: string; email?: string; first_name?: string | null; last_name?: string | null };
    } | null;
    if (!response.ok || !body?.access_token || !body?.refresh_token || !body?.user?.id) {
      if (response.status >= 500)
        throw new ConvexError("Couldn't reach the sign-in service. Please try again.");
      throw new ConvexError("That code didn't work. Check the email and try again, or start over.");
    }

    const user = body.user;
    if (!user) throw new ConvexError("Sign-in expired. Please try again.");
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
    return {
      accessToken: body.access_token as string,
      refreshToken: body.refresh_token as string,
      userID: user.id as string,
      email: (user.email as string | undefined) ?? null,
      name: name || null,
    };
  },
});
