"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconDashboard,
  IconFiles,
  IconDocuments,
  IconCode,
  IconSheet,
  IconMindmap,
  IconCoworkers,
  IconChat,
  IconCalendar,
  IconKey,
  IconConsole,
  IconTrash,
} from "./icons";
import { useWorkspace } from "./workspace/workspace-context";
import { useMobileNav } from "./mobile-nav-context";

type Item = { href: string; label: string; icon: React.ReactNode };

const MAIN: Item[] = [
  { href: "/dashboard", label: "Operational View", icon: <IconDashboard /> },
  { href: "/files", label: "Repository", icon: <IconFiles /> },
  { href: "/documents", label: "Docs +", icon: <IconDocuments /> },
  { href: "/sheets", label: "Table", icon: <IconSheet /> },
  { href: "/code", label: "Codespace", icon: <IconCode /> },
  { href: "/mindmap", label: "Link Graph", icon: <IconMindmap /> },
  { href: "/chat", label: "Chat", icon: <IconChat /> },
  { href: "/calendar", label: "Calendar", icon: <IconCalendar /> },
  { href: "/coworkers", label: "Co-workers", icon: <IconCoworkers /> },
];

export function Sidebar({ role }: { role: "user" | "admin" }) {
  const pathname = usePathname();
  const { hide } = useWorkspace();
  const mobileNav = useMobileNav();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const onNavigate = () => {
    hide();
    mobileNav.close();
  };

  return (
    <>
      {mobileNav.open && (
        <div
          className="rail-backdrop"
          onClick={mobileNav.close}
          aria-hidden="true"
        />
      )}
      <aside className={`rail ${mobileNav.open ? "open" : ""}`}>
        {MAIN.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`rail-link ${isActive(item.href) ? "active" : ""}`}
            title={item.label}
            aria-label={item.label}
            onClick={onNavigate}
          >
            {item.icon}
            <span className="rail-label">{item.label}</span>
          </Link>
        ))}
        <div className="rail-sep" />
        <Link
          href="/trash"
          className={`rail-link ${isActive("/trash") ? "active" : ""}`}
          title="Trash"
          aria-label="Trash"
          onClick={onNavigate}
        >
          <IconTrash />
          <span className="rail-label">Trash</span>
        </Link>
        <Link
          href="/admin/redeem"
          className={`rail-link ${isActive("/admin/redeem") ? "active" : ""}`}
          title="Redeem admin code"
          aria-label="Redeem admin code"
          onClick={onNavigate}
        >
          <IconKey />
          <span className="rail-label">Redeem admin code</span>
        </Link>
        {role === "admin" && (
          <Link
            href="/admin"
            className={`rail-link ${pathname === "/admin" ? "active" : ""}`}
            title="Admin console"
            aria-label="Admin console"
            onClick={onNavigate}
          >
            <IconConsole />
            <span className="rail-label">Admin console</span>
          </Link>
        )}
      </aside>
    </>
  );
}
