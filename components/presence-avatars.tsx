"use client";

import type { PresenceUser } from "@/lib/use-presence";

export function PresenceAvatars({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return null;

  return (
    <div className="presence-row" title="Currently viewing">
      {users.map((u) => {
        const initial = (u.name || "?").charAt(0).toUpperCase();
        return (
          <span key={u.id} className="presence-badge" title={u.name}>
            {u.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={u.avatarUrl}
                alt={u.name}
                className="contributor-avatar"
                style={{ borderColor: u.color }}
              />
            ) : (
              <span
                className="contributor-avatar contributor-avatar-fallback"
                style={{ borderColor: u.color }}
              >
                {initial}
              </span>
            )}
            <span className="presence-dot" />
          </span>
        );
      })}
    </div>
  );
}
