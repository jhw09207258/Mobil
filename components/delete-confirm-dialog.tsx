"use client";

import { useState, useTransition } from "react";
import { Modal } from "./modal";

type Result = { ok: true } | { ok: false; error: string };

/**
 * 삭제 확인 다이얼로그. 예전에는 GitHub 처럼 대상 이름을 그대로 입력해야
 * 버튼이 활성화됐는데, 이제 삭제가 영구 삭제가 아니라 휴지통 이동이라
 * (18시간 뒤 자동 삭제, 그 전에는 복원 가능) 그런 마찰이 필요 없다 —
 * 실수해도 되돌릴 수 있으므로 확인 한 번으로 충분하다.
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
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
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
    <Modal title={`Delete ${itemKind}`} onClose={onClose} width={440}>
      {error && <div className="notice notice-error">{error}</div>}

      <p className="page-sub" style={{ margin: "0 0 4px" }}>
        Move <strong style={{ color: "var(--text-0)" }}>{itemLabel}</strong> to the
        Trash?
      </p>
      <p className="page-sub" style={{ margin: 0 }}>
        You can restore it from the Trash for the next 18 hours, after which it is
        deleted permanently.
      </p>

      <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
        <button className="btn btn-sm" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button className="btn btn-sm btn-danger" onClick={submit} disabled={pending} autoFocus>
          {pending ? "Moving…" : "Move to Trash"}
        </button>
      </div>
    </Modal>
  );
}
