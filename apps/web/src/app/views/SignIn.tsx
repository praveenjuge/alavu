import { useEffect } from "react";
import { Gauge } from "vadivam-react";
import { signIn } from "../auth";

const failures: Record<string, string> = {
  expired: "Sign-in took too long.",
  failed: "Couldn't sign you in.",
};

/**
 * Signed out: sign-in happens on WorkOS AuthKit's hosted page (Apple or Google, plus any
 * email check WorkOS needs). A failed attempt stops here instead of looping.
 */
export function SignIn() {
  const reason = new URLSearchParams(location.search).get("signin");
  const failure = reason ? (failures[reason] ?? failures.failed) : null;

  useEffect(() => {
    if (!failure) signIn();
  }, [failure]);

  return (
    <div className="center-screen">
      <div className="signin">
        <span style={{ color: "var(--accent)" }}>
          <Gauge size={56} aria-hidden />
        </span>
        {failure ? (
          <>
            <h1 style={{ fontSize: 28 }}>{failure}</h1>
            <button
              type="button"
              className="button primary"
              style={{ width: "100%", minHeight: 48 }}
              onClick={signIn}
            >
              Try Again
            </button>
          </>
        ) : (
          <p className="muted" role="status">
            Taking you to sign in…
          </p>
        )}
      </div>
    </div>
  );
}
