"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 열려 있는 모달들의 스택.
 *
 * 모달 위에 모달이 열리는 경우가 있다 — 일정 편집 중 "채팅으로 보내기",
 * 파일 목록에서 미리보기를 열고 그 안에서 공유 같은 흐름이다. 각 모달이
 * 독립적으로 처리하면 두 가지가 어긋난다.
 *   * Escape 를 누르면 document 리스너가 전부 반응해 **두 개가 한꺼번에** 닫힌다.
 *   * 안쪽 모달이 닫힐 때 body 스크롤 잠금을 풀어 버려, 바깥 모달이 아직
 *     떠 있는데 뒤 배경이 스크롤되기 시작한다.
 * 스택으로 "지금 맨 위" 를 알면 둘 다 사라진다.
 */
const modalStack: symbol[] = [];


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
    const token = Symbol("modal");
    modalStack.push(token);
    const isTop = () => modalStack[modalStack.length - 1] === token;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // 닫기(✕) 버튼보다 본문의 첫 입력 요소에 우선 포커스한다.
    const firstField = panel?.querySelector<HTMLElement>(
      ".panel-body input:not([disabled]), .panel-body textarea:not([disabled]), .panel-body select:not([disabled])"
    );
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstField ?? firstFocusable ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      // 맨 위 모달만 반응한다 — 아니면 겹쳐 있는 모달이 한꺼번에 닫힌다.
      if (!isTop()) return;
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
      const at = modalStack.lastIndexOf(token);
      if (at >= 0) modalStack.splice(at, 1);
      // 마지막 모달이 닫힐 때만 배경 스크롤을 되돌린다.
      if (modalStack.length === 0) document.body.style.overflow = "";
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
            <CloseIcon />
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
      <style>{modalCss}</style>
    </div>
  );
}

/** 닫기 아이콘 — app/(app)/icons.tsx 와 같은 규격(24 viewBox, currentColor,
 *  1.7 두께, 둥근 끝). components/ 는 라우트 그룹 안쪽을 import 하지 않으므로
 *  여기서는 그리지 직접 그린다. 예전엔 ✕(U+2715) 글자를 썼는데, 폰트에 따라
 *  컬러 이모지로 그려져 버튼마다 모양이 달라 보였다. */
function CloseIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

const modalCss = `
.modal-backdrop {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 80px 20px 20px;
  /* 배경을 스크롤 가능하게 둔다. 목록이 긴 모달(멤버 고르기 등)이나 키보드가
     아래 절반을 가린 상태에서는, 스크롤이 없으면 하단의 확인/취소 버튼에
     아예 닿을 수 없다 — iOS 는 키보드가 떠도 레이아웃 뷰포트가 안 줄어들어
     position:fixed 인 이 상자가 키보드 뒤로 그대로 남기 때문이다. */
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  animation: modal-backdrop-in 0.2s ease;
}
@keyframes modal-backdrop-in { from { opacity: 0 } to { opacity: 1 } }
.modal { width: 100%; }
/* 좁은 화면에서 위쪽 80px 여백은 그만큼 모달이 쓸 세로 공간을 잡아먹는다. */
@media (max-width: 640px) {
  .modal-backdrop { padding: 20px 12px; }
}
`;
