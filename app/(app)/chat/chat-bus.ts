"use client";

// ============================================================================
// 채팅 UI 인스턴스(전체 페이지 /chat ↔ 전역 플로팅 위젯) 간의 아주 작은
// 클라이언트 이벤트 버스. React 트리가 분리되어 있어(레이아웃의 위젯 vs 페이지)
// Context 로 못 잇는다 — 모듈 싱글턴이 가장 짧고 충분하다.
// ============================================================================

let activeConversation: string | null = null;
const openListeners = new Set<(conversationId: string) => void>();
const notifyListeners = new Set<(conversationId: string) => void>();

/** 지금 화면에 열려 있는 대화 — 이 대화의 알림 토스트는 억제한다. */
export function setActiveConversation(id: string | null): void {
  activeConversation = id;
}
export function getActiveConversation(): string | null {
  return activeConversation;
}

/** 토스트 클릭 등에서 "이 대화를 열어라" 요청. */
export function requestOpenConversation(id: string): void {
  openListeners.forEach((l) => l(id));
}
export function onOpenConversation(l: (id: string) => void): () => void {
  openListeners.add(l);
  return () => openListeners.delete(l);
}

/** 전역 알림 채널로 새 메시지가 감지됨 — 목록 갱신 트리거. */
export function emitMessageNotify(conversationId: string): void {
  notifyListeners.forEach((l) => l(conversationId));
}
export function onMessageNotify(l: (conversationId: string) => void): () => void {
  notifyListeners.add(l);
  return () => notifyListeners.delete(l);
}
