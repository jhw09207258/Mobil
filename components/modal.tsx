"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  onClose,
  children,
  width = 480,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // onClose 를 ref 로 담아 setup 이펙트가 단 한 번만(마운트/언마운트) 돌게 한다.
  // 전엔 이펙트가 [onClose] 에 의존했는데, 호출부가 인라인 화살표(() => setX(null))
  // 를 넘기면 렌더마다 새 함수가 되어 이펙트가 재실행됐고, 그때마다 cleanup 의
  // previouslyFocused.focus() 가 입력창에서 포커스를 훔쳐가 "한 글자 치면 입력이
  // 꺼지는" 버그가 났다.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // 닫기(✕) 버튼보다 본문의 첫 입력 요소에 우선 포커스한다.
    const firstField = panel?.querySelector<HTMLElement>(
      ".panel-body input:not([disabled]), .panel-body textarea:not([disabled]), .panel-body select:not([disabled])"
    );
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstField ?? firstFocusable ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="modal panel"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <span className="topbar-title">{title}</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
      <style>{modalCss}</style>
    </div>
  );
}

const modalCss = `
.modal-backdrop {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 80px 20px 20px;
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  animation: modal-backdrop-in 0.2s ease;
}
@keyframes modal-backdrop-in { from { opacity: 0 } to { opacity: 1 } }
.modal { width: 100%; }
`;
