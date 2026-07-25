"use client";

import { useState } from "react";
import { ParticleFlow } from "@/components/particle-flow";
import { LoginForm } from "./login-form";
import { InstallPanel } from "./install-panel";

type View = "login" | "install";
type Os = "mac" | "windows";

export function LoginScreen({ redirectTo }: { redirectTo?: string }) {
  const [view, setView] = useState<View>("login");
  const [os, setOs] = useState<Os>("mac");
  const [leaving, setLeaving] = useState(false);

  function switchTo(next: View) {
    setLeaving(true);
    setTimeout(() => {
      setView(next);
      setLeaving(false);
    }, 200);
  }

  return (
    <div className="login-screen">
      <div className="login-particles" aria-hidden="true">
        <ParticleFlow color="#ffffff" />
      </div>

      <div
        key={view}
        className={`login-view ${leaving ? "login-fade-out" : "login-fade-in"}`}
      >
        {view === "login" ? (
          <div className="auth-wrap auth-wrap-noscroll">
            <LoginForm
              redirectTo={redirectTo}
              onInstall={(target) => {
                setOs(target);
                switchTo("install");
              }}
            />
          </div>
        ) : (
          <InstallPanel os={os} onBack={() => switchTo("login")} />
        )}
      </div>

      {view === "login" && (
        <div className="login-footer">Product by Yegrina Haute Group Technologies® 2026</div>
      )}
    </div>
  );
}
