"use client";

import { useState, useTransition } from "react";
import { Modal } from "./modal";

type Result = { ok: true } | { ok: false; error: string };

/**
 * GitHub 저장소 삭제처럼, 대상의 정확한 이름을 사용자가 직접 입력해야만 삭제
 * 버튼이 활성화되는 확인 다이얼로그. 실수로 지우는 것을 막는다.
 *
 * onConfirm 은 삭제 서버 액션을 호출하고 성공/실패를 반환한다. 성공하면
 * 다이얼로그가 스스로 닫히고 onDeleted 콜백(탭 닫기·네비게이션·목록 새로고침
 * 등)이 실행된다.
 */
export function DeleteConfirmDialog({
  itemLabel,
  itemKind,
  onConfirm,
  onDeleted,
  onClose,
}: {
  itemLabel: string;
  itemKind: string;
  onConfirm: () => Promise<Result>;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const matches = typed === itemLabel;

  const submit = () => {
    if (!matches) return;
    setError(null);
    start(async () => {
      const res = await onConfirm();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDeleted();
      onClose();
    });
  };

  return (
    <Modal title={`Delete ${itemKind}`} onClose={onClose} width={480}>
      {error && <div className="notice notice-error">{error}</div>}

      <p className="page-sub" style={{ margin: "0 0 14px" }}>
        This action <strong>cannot be undone</strong>. This will permanently
        delete the {itemKind}.
      </p>

      <div className="label" style={{ marginBottom: 6 }}>
        Type <span className="mono" style={{ color: "var(--text-1)" }}>{itemLabel}</span> to confirm
      </div>
      <input
        className="input"
        style={{ width: "100%" }}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches) submit();
        }}
        placeholder={itemLabel}
        autoFocus
        autoComplete="off"
        spellCheck={false}
      />

      <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
        <button className="btn btn-sm" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={submit}
          disabled={!matches || pending}
        >
          {pending ? "Deleting…" : `Delete this ${itemKind}`}
        </button>
      </div>
    </Modal>
  );
}
