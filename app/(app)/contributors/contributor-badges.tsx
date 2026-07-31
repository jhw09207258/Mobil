"use client";

import { useEffect, useRef, useState } from "react";
import { listContributors, type ContributorRow } from "./actions";

export function ContributorBadges({
  kind,
  id,
  refreshToken,
  initial,
}: {
  kind: "document" | "code" | "sheet" | "mindmap";
  id: string;
  refreshToken?: unknown;
  /** 서버 컴포넌트가 문서와 같은 왕복에서 이미 받아 온 초기값이 있으면 그걸
   * 쓰고 마운트 시점의 재조회를 건너뛴다 — 넘겨주지 않은 호출부(code/sheet/
   * mindmap)는 지금까지처럼 자립형으로 스스로 불러온다. */
  initial?: ContributorRow[];
}) {
  const [contributors, setContributors] = useState<ContributorRow[]>(initial ?? []);
  const skipNextFetch = useRef(initial !== undefined);

  useEffect(() => {
    let cancelled = false;
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    listContributors(kind, id).then((rows) => {
      if (!cancelled) setContributors(rows);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, refreshToken]);

  if (contributors.length === 0) return null;

  return (
    <div className="contributor-row" title="Contributors">
      {contributors.map((c) => {
        const name = c.display_name || c.email.split("@")[0];
        const initial = (name || "?").charAt(0).toUpperCase();
        return (
          <span
            key={c.user_id}
            className="contributor-badge"
            title={`Contributor: ${name}`}
          >
            {c.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.avatar_url} alt={name} className="contributor-avatar" />
            ) : (
              <span className="contributor-avatar contributor-avatar-fallback">
                {initial}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
