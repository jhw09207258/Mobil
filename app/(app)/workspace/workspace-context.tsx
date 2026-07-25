"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// "chat" 은 콘텐츠 항목이 아닌 싱글턴 탭(itemId 고정 "comms") — 스플릿 뷰
// 한쪽에 채팅을 두고 다른 쪽에서 문서/코드를 편집하는 용도.
export type TabKind = "document" | "code" | "sheet" | "mindmap" | "chat";
export type Pane = "left" | "right";

export type Tab = {
  id: string; // `${kind}:${itemId}`
  kind: TabKind;
  itemId: string;
  title: string;
};

type StoredState = {
  tabs: Tab[];
  paneLeft: string | null;
  paneRight: string | null;
  split: boolean;
  splitPct: number;
  open: boolean;
};

const STORAGE_PREFIX = "possion.workspace.v1";
const LEGACY_STORAGE_KEY = "mobil.workspace.v1";
const MIN_SPLIT = 20;
const MAX_SPLIT = 80;

// 열린 작업 탭은 사용자별로 분리해서 저장한다 — 전역 키를 쓰면 같은 브라우저에서
// 다른 계정으로 로그인했을 때 이전 사용자의 탭이 그대로 뜬다(계정 간 누수).
function storageKeyFor(userId: string) {
  return `${STORAGE_PREFIX}.${userId}`;
}

function emptyState(): StoredState {
  return { tabs: [], paneLeft: null, paneRight: null, split: false, splitPct: 50, open: false };
}

export function tabId(kind: TabKind, itemId: string) {
  return `${kind}:${itemId}`;
}

function loadInitial(userId: string): StoredState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(storageKeyFor(userId));
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw) as StoredState;
    if (!Array.isArray(parsed.tabs)) throw new Error("bad shape");
    return parsed;
  } catch {
    // 계정 간 누수의 원인이던 전역(레거시) 키가 남아 있으면 정리한다.
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* noop */
    }
    return emptyState();
  }
}

type WorkspaceCtx = {
  tabs: Tab[];
  paneLeft: string | null;
  paneRight: string | null;
  split: boolean;
  splitPct: number;
  open: boolean;
  openTab: (kind: TabKind, itemId: string, title: string, seed?: unknown) => void;
  consumeSeed: (id: string) => unknown | undefined;
  closeTab: (id: string) => void;
  reorderTab: (fromId: string, toId: string) => void;
  focusTab: (id: string, pane?: Pane) => void;
  setPaneTab: (pane: Pane, id: string | null) => void;
  toggleSplit: () => void;
  setSplitPct: (pct: number) => void;
  hide: () => void;
  renameTab: (kind: TabKind, itemId: string, title: string) => void;
};

const Ctx = createContext<WorkspaceCtx | null>(null);

export function WorkspaceProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string;
}) {
  const [state, setState] = useState<StoredState>(emptyState);
  // 마운트 직후 첫 저장(복원 전의 빈 상태)은 건너뛴다 — 저장된 탭을 빈 값으로
  // 덮어쓰지 않기 위함. 이 컴포넌트는 layout 에서 key={userId} 로 감싸 사용자가
  // 바뀌면 통째로 리마운트되므로, 이 플래그도 사용자별로 초기화된다.
  const firstSave = useRef(true);

  // 방금 생성한 항목을 열 때 TabContent 가 서버에 다시 조회하지 않도록 넘겨주는
  // 임시 시드 저장소. localStorage 에 영속화하면 안 되므로(새로고침 후에는
  // 최신 서버 데이터를 다시 조회해야 함) state 밖의 ref 로 따로 둔다.
  const seedStore = useRef<Map<string, unknown>>(new Map());
  const consumeSeed = useCallback((id: string) => {
    const seed = seedStore.current.get(id);
    seedStore.current.delete(id);
    return seed;
  }, []);

  // 최초 마운트에만 localStorage 복원 (SSR 하이드레이션 불일치 방지).
  useEffect(() => {
    setState(loadInitial(userId));
  }, [userId]);

  useEffect(() => {
    // 복원(첫 setState) 전의 빈 상태 저장을 건너뛰어 저장된 탭을 지우지 않는다.
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    window.localStorage.setItem(storageKeyFor(userId), JSON.stringify(state));
  }, [state, userId]);

  const openTab = useCallback((kind: TabKind, itemId: string, title: string, seed?: unknown) => {
    const id = tabId(kind, itemId);
    if (seed !== undefined) seedStore.current.set(id, seed);
    setState((s) => {
      const exists = s.tabs.some((t) => t.id === id);
      const tabs = exists ? s.tabs : [...s.tabs, { id, kind, itemId, title }];
      // 우측 패널이 포커스 상태가 아니면 좌측에 배치
      const paneLeft = s.split && s.paneLeft && s.paneLeft !== id ? s.paneLeft : id;
      const paneRight = s.split ? s.paneRight : null;
      return { ...s, tabs, paneLeft: s.split ? s.paneLeft ?? id : id, paneRight, open: true };
    });
  }, []);

  const closeTab = useCallback((id: string) => {
    setState((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const paneLeft = s.paneLeft === id ? tabs[0]?.id ?? null : s.paneLeft;
      const paneRight = s.paneRight === id ? null : s.paneRight;
      const open = tabs.length > 0 && s.open;
      return { ...s, tabs, paneLeft, paneRight, open };
    });
  }, []);

  // 탭 순서 재배치 — fromId 를 toId 위치로 이동(드래그 앤 드롭).
  const reorderTab = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setState((s) => {
      const from = s.tabs.findIndex((t) => t.id === fromId);
      const to = s.tabs.findIndex((t) => t.id === toId);
      if (from === -1 || to === -1) return s;
      const tabs = [...s.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { ...s, tabs };
    });
  }, []);

  const focusTab = useCallback((id: string, pane: Pane = "left") => {
    setState((s) => ({
      ...s,
      open: true,
      paneLeft: pane === "left" ? id : s.paneLeft,
      paneRight: pane === "right" ? id : s.paneRight,
    }));
  }, []);

  const setPaneTab = useCallback((pane: Pane, id: string | null) => {
    setState((s) => ({
      ...s,
      [pane === "left" ? "paneLeft" : "paneRight"]: id,
    }));
  }, []);

  const toggleSplit = useCallback(() => {
    setState((s) => ({ ...s, split: !s.split, paneRight: !s.split ? s.paneRight : null }));
  }, []);

  const setSplitPct = useCallback((pct: number) => {
    const clamped = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, pct));
    setState((s) => ({ ...s, splitPct: clamped }));
  }, []);

  const hide = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
  }, []);

  const renameTab = useCallback((kind: TabKind, itemId: string, title: string) => {
    const id = tabId(kind, itemId);
    setState((s) => ({
      ...s,
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }));
  }, []);

  const value = useMemo<WorkspaceCtx>(
    () => ({
      tabs: state.tabs,
      paneLeft: state.paneLeft,
      paneRight: state.paneRight,
      split: state.split,
      splitPct: state.splitPct,
      open: state.open,
      openTab,
      consumeSeed,
      closeTab,
      reorderTab,
      focusTab,
      setPaneTab,
      toggleSplit,
      setSplitPct,
      hide,
      renameTab,
    }),
    [state, openTab, consumeSeed, closeTab, reorderTab, focusTab, setPaneTab, toggleSplit, setSplitPct, hide, renameTab]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
