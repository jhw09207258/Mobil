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
    // data-tauri-drag-region: 데스크톱 앱에서 헤더 빈 영역을 잡아 창을 옮긴다
    // (CSS -webkit-app-region 보다 신뢰성 높은 Tauri v2 네이티브 방식).
    // 브라우저에서는 무의미한 속성이라 무시된다.
    <header className="app-header" data-tauri-drag-region>
      <button
        type="button"
        className="hamburger-btn"
        onClick={mobileNav.toggle}
        aria-label={mobileNav.open ? "Close menu" : "Open menu"}
        aria-expanded={mobileNav.open}
      >
        <IconMenu size={20} />
      </button>
      {/* 좌측 균형용 스페이서 — 검색창을 헤더 정중앙에 두기 위함 */}
      <div className="header-side header-side-left" data-tauri-drag-region />

      <HeaderSearch />

      <div className="header-side header-side-right">
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
      </div>
    </header>
  );
}
