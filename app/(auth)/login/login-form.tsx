"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { login, type AuthState } from "./actions";

export function LoginForm({
  redirectTo,
  onInstall,
}: {
  redirectTo?: string;
  onInstall: (os: "mac" | "windows") => void;
}) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    login,
    null
  );
  const router = useRouter();
  const navigatedRef = useRef(false);

  const success = !!(state && "ok" in state && state.ok);
  const busy = pending || success;

  useEffect(() => {
    if (!success || navigatedRef.current) return;
    navigatedRef.current = true;
    // 카드가 fade-out 되는 동안 잠깐 기다렸다가 넘어간다 — auth-card-leaving 의
    // CSS transition 시간과 맞춰야 화면이 뚝 끊기지 않는다.
    const redirectPath = (state as { ok: true; redirectTo: string }).redirectTo;
    const t = setTimeout(() => router.push(redirectPath), 260);
    return () => clearTimeout(t);
  }, [success, state, router]);

  return (
    <div className={`auth-card ${success ? "auth-card-leaving" : ""}`}>
      <div className="auth-brand">
        <span className="brand-logo brand-logo-lg">Possion</span>
      </div>
      <div className="auth-tagline">Creating Value Integrating Society</div>
      <form action={formAction}>
        {state && "error" in state && (
          <div className="notice notice-error">{state.error}</div>
        )}
        <input type="hidden" name="redirect" value={redirectTo || "/dashboard"} />
        <div className="auth-input-group">
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            autoComplete="email"
            placeholder="Email"
            required
            disabled={busy}
          />
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            autoComplete="current-password"
            placeholder="Password"
            required
            disabled={busy}
          />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? (
            <span className="auth-authorizing">
              <span className="auth-spinner" aria-hidden="true" />
              Authorizing…
            </span>
          ) : (
            "Sign in"
          )}
        </button>
      </form>
      <div className="auth-foot">
        No account? <Link href="/signup">Sign up</Link>
      </div>
      <div className="install-options">
        <button type="button" className="install-opt" onClick={() => onInstall("mac")}>
          Install for Mac OS
        </button>
        <button type="button" className="install-opt" onClick={() => onInstall("windows")}>
          Install for Windows
        </button>
      </div>
    </div>
  );
}
