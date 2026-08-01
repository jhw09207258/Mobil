"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IconMenu } from "./icons";
import { useWorkspace } from "./workspace/workspace-context";
import { useMobileNav } from "./mobile-nav-context";
import { HeaderSearch } from "./header-search";
import { GlobalChat } from "./chat/global-chat";
import { SignOutOverlay } from "./sign-out-overlay";
import { Tooltip } from "@/components/ui/tooltip";

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
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = displayName || email.split("@")[0];
  const initial = (name || "?").charAt(0).toUpperCase();
  const { hide } = useWorkspace();
  const mobileNav = useMobileNav();

  const handleSignOut = async () => {
    setOpen(false);
    setSigningOut(true);
    // 검정 페이드인 + 흰 파동 모션(signout-overlay 의 css, 총 0.9s)이 다
    // 재생된 뒤에 실제로 로그아웃 처리 — 로그인 화면은 도착과 동시에
    // 자기 자신의 fade-in(.login-fade-in)을 재생한다.
    await new Promise((r) => setTimeout(r, 900));
    await fetch("/auth/signout", { method: "POST" });
    window.location.href = "/login";
  };

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
    <>
    {/* data-tauri-drag-region: 데스크톱 앱에서 헤더 빈 영역을 잡아 창을 옮긴다
        (CSS -webkit-app-region 보다 신뢰성 높은 Tauri v2 네이티브 방식).
        브라우저에서는 무의미한 속성이라 무시된다. */}
    <header className="app-header" data-tauri-drag-region>
      <Tooltip content={mobileNav.open ? "Close menu" : "Open menu"} side="right">
        <button
          type="button"
          className="hamburger-btn"
          onClick={mobileNav.toggle}
          aria-label={mobileNav.open ? "Close menu" : "Open menu"}
          aria-expanded={mobileNav.open}
        >
          <IconMenu size={20} />
        </button>
      </Tooltip>
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
            <button type="button" className="acct-item danger" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        )}
        </div>
      </div>
    </header>
    {signingOut && <SignOutOverlay />}
    </>
  );
}
