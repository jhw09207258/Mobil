"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/modal";
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
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");

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

  const createAndAssign = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    const created = await createRepository(name);
    if ("error" in created) {
      setBusy(false);
      return;
    }
    setRepos((prev) => [...(prev ?? []), created]);
    await setItemRepository(kind, itemId, created.id);
    setCurrent(created.id);
    setNewOpen(false);
    setNewName("");
    setBusy(false);
  };

  const onChange = async (value: string) => {
    if (busy) return;
    if (value === NEW_SENTINEL) {
      // prompt 는 Tauri 웹뷰에서 null 을 반환하므로 모달 입력을 쓴다.
      setNewOpen(true);
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
    <>
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
      {newOpen && (
        <Modal title="New repository" onClose={() => setNewOpen(false)}>
          <input
            className="input"
            autoFocus
            placeholder="Repository name"
            value={newName}
            maxLength={80}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createAndAssign()}
            style={{ marginBottom: 12 }}
          />
          <button className="btn btn-primary btn-block" onClick={createAndAssign} disabled={!newName.trim() || busy}>
            Create &amp; assign
          </button>
        </Modal>
      )}
    </>
  );
}
