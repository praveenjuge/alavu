import { type FormEvent, useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { Gauge } from "vadivam-react";
import { post, signIn } from "../auth";

const failures: Record<string, string> = {
  expired: "Sign-in took too long. Please try again.",
  failed: "Couldn't sign in. Please try again.",
};

function AppleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M16.37 12.62c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.86-.76-1.47.02-2.83.86-3.59 2.17-1.53 2.66-.39 6.59 1.1 8.75.73 1.05 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.46-.03-.01-2.29-.88-2.3-3.51zM14.2 6.17c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.56-1.23z" />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function Logo() {
  return (
    <span style={{ color: "var(--accent)" }}>
      <Gauge size={64} aria-hidden />
    </span>
  );
}

export function SignIn() {
  const reason = new URLSearchParams(location.search).get("signin");
  return (
    <div className="center-screen">
      <div className="signin">
        <Logo />
        <h1>Alavu</h1>
        <p className="muted" style={{ margin: "0 0 24px" }}>
          Track what you spend and earn, across every part of your life.
        </p>
        {reason && failures[reason] && (
          <p role="alert" style={{ color: "var(--red)", margin: 0 }}>
            {failures[reason]}
          </p>
        )}
        <Button className="provider apple" onPress={() => signIn("AppleOAuth")}>
          <AppleLogo /> Continue with Apple
        </Button>
        <Button className="provider google" onPress={() => signIn("GoogleOAuth")}>
          <GoogleLogo /> Continue with Google
        </Button>
        <p className="muted" style={{ fontSize: 13 }}>
          By continuing you agree to the <a href="/terms/">Terms</a> and{" "}
          <a href="/privacy/">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}

/** WorkOS asked for the emailed code before linking a second sign-in method. */
export function VerifyEmail() {
  const [email, setEmail] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    post<{ email: string | null }>("/app/auth/pending")
      .then((data) => setEmail(data.email))
      .catch(() => setExpired(true));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await post("/app/auth/verify", { code });
      location.replace("/app/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code didn't work.");
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="signin" onSubmit={submit}>
        <Logo />
        <h1 style={{ fontSize: 28 }}>Check Your Email</h1>
        {expired ? (
          <>
            <p className="muted">This sign-in expired. Please start again.</p>
            <a className="button primary" href="/app/">
              Back to Sign In
            </a>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>
              You already have an account with {email ?? "this email"}. Enter the code we just sent
              there to link this sign-in to it.
            </p>
            <label className="visually-hidden" htmlFor="code">
              6-digit code
            </label>
            <input
              id="code"
              className="input left num"
              style={{
                fontSize: 28,
                textAlign: "center",
                letterSpacing: "0.3em",
                background: "var(--card)",
                borderRadius: 12,
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
            />
            {error && (
              <p role="alert" style={{ color: "var(--red)", margin: 0 }}>
                {error}
              </p>
            )}
            <button
              className="button primary"
              style={{ width: "100%", minHeight: 48 }}
              disabled={code.length !== 6 || busy}
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
            <a href="/app/" className="muted" style={{ fontSize: 15 }}>
              Start over
            </a>
          </>
        )}
      </form>
    </div>
  );
}
