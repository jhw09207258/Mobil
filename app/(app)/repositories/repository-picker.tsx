"use client";

import { useEffect, useState } from "react";
import {
  createRepository,
  getItemRepository,
  listRepositories,
  setItemRepository,
  type Repository,
  type RepoItemKind,
} from "./actions";

const NEW_SENTINEL = "__new__";

/** 에디터 상단바용 저장소 선택 — 자기 데이터(현재 저장소·목록)를 스스로
 * 불러오는 자립형 컴포넌트라 4개 에디터에 프롭 드릴링 없이 꽂힌다. */
export function RepositoryPicker({
  kind,
  itemId,
  canEdit,
}: {
  kind: RepoItemKind;
  itemId: string;
  canEdit: boolean;
}) {
  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listRepositories(), getItemRepository(kind, itemId)]).then(
      ([list, item]) => {
        if (cancelled) return;
        setRepos(list);
        setCurrent(item?.repositoryId ?? null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [kind, itemId]);

  if (!repos) return null;

  const onChange = async (value: string) => {
    if (busy) return;
    if (value === NEW_SENTINEL) {
      const name = prompt("New repository name");
      if (!name?.trim()) return;
      setBusy(true);
      const created = await createRepository(name);
      if ("error" in created) {
        alert(created.error);
        setBusy(false);
        return;
      }
      setRepos((prev) => [...(prev ?? []), created]);
      await setItemRepository(kind, itemId, created.id);
      setCurrent(created.id);
      setBusy(false);
      return;
    }
    const next = value === "" ? null : value;
    setBusy(true);
    const prev = current;
    setCurrent(next);
    const res = await setItemRepository(kind, itemId, next);
    if ("error" in res) setCurrent(prev);
    setBusy(false);
  };

  return (
    <select
      className="select repo-picker"
      value={current ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={!canEdit || busy}
      title="Repository"
      aria-label="Repository"
    >
      <option value="">Null Repository</option>
      {repos.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
      {canEdit && <option value={NEW_SENTINEL}>+ New repository…</option>}
    </select>
  );
}
