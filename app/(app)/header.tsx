"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IconMenu } from "./icons";
import { useWorkspace } from "./workspace/workspace-context";
import { useMobileNav } from "./mobile-nav-context";
import { HeaderSearch } from "./header-search";
import { GlobalChat } from "./chat/global-chat";

export function AppHeader({
  userId,
  displayName,
  email,
  avatarUrl,
}: {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = displayName || email.split("@")[0];
  const initial = (name || "?").charAt(0).toUpperCase();
  const { hide } = useWorkspace();
  const mobileNav = useMobileNav();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <header className="app-header">
      <button
        type="button"
        className="hamburger-btn"
        onClick={mobileNav.toggle}
        aria-label={mobileNav.open ? "Close menu" : "Open menu"}
        aria-expanded={mobileNav.open}
      >
        <IconMenu size={20} />
      </button>
      <Link href="/dashboard" className="brand-logo" onClick={hide}>
        Mobil
      </Link>

      <HeaderSearch />

      <GlobalChat selfId={userId} selfName={name} />

      <div className="acct" ref={ref}>
        <button className="acct-btn" onClick={() => setOpen((v) => !v)}>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="avatar avatar-img" src={avatarUrl} alt={name} width={28} height={28} />
          ) : (
            <span className="avatar">{initial}</span>
          )}
          <span className="acct-name">{name}</span>
        </button>
        {open && (
          <div className="acct-menu">
            <div className="acct-head">
              <div className="n">{name}</div>
              <div className="e">{email}</div>
            </div>
            <Link
              href="/settings"
              className="acct-item"
              onClick={() => {
                setOpen(false);
                hide();
              }}
            >
              Settings
            </Link>
            <form action="/auth/signout" method="post">
              <button type="submit" className="acct-item danger">
                Sign out
              </button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
