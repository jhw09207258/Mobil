"use client";

import "mind-elixir/style.css";
import "./canvas.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as Y from "yjs";
import MindElixir, { type MindElixirData, type MindElixirInstance, type NodeObj } from "mind-elixir";
import type { Json } from "@/lib/database.types";
import { ShareDialog } from "@/components/share-dialog";
import type { WorkspaceItem, ReferencePreview } from "../actions";
import {
  saveMindMap,
  deleteMindMap,
  setMindMapPublic,
  shareMindMap,
  revokeMindMapShare,
  listMindMapShares,
  getReferencePreview,
} from "../actions";
import { useWorkspace, tabId } from "../../workspace/workspace-context";
import { ContributorBadges } from "../../contributors/contributor-badges";
import { RepositoryPicker } from "../../repositories/repository-picker";
import { usePresence } from "@/lib/use-presence";
import { colorForUserId } from "@/lib/presence-color";
import { PresenceAvatars } from "@/components/presence-avatars";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { formatBytes } from "@/lib/format";
import { createDocumentFromMindmap, createSheetFromMindmap } from "../../convert-actions";
import { connectYjsBroadcast, encodeYUpdate, decodeYUpdate, seedDeterministically } from "@/lib/yjs-transport";
import { parseInitialData, type RefKind, type NodeMeta } from "@/lib/mindmap-legacy";
import { countReferenceNodes } from "@/lib/outline-convert";
import { flattenTree, syncFlatToYMap, readFlatFromYMap, reconstructTree, type FlatNode } from "@/lib/mindmap-yjs";

type SaveState = "saved" | "dirty" | "saving";
const AUTOSAVE_MS = 1200;

function Inner({
  mapId,
  initialTitle,
  initialData,
  initialYjsState,
  canEdit,
  isOwner,
  isPublic,
  myShareId,
  myName,
  myAvatarUrl,
  items,
}: {
  mapId: string;
  initialTitle: string;
  initialData: Json;
  initialYjsState: string | null;
  canEdit: boolean;
  isOwner: boolean;
  isPublic: boolean;
  myShareId: string;
  myName: string;
  myAvatarUrl: string | null;
  items: WorkspaceItem[];
}) {
  const router = useRouter();
  const { openTab, renameTab, closeTab } = useWorkspace();
  const presenceUsers = usePresence(`mindmap:${mapId}`, {
    id: myShareId,
    name: myName,
    avatarUrl: myAvatarUrl,
    color: colorForUserId(myShareId),
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const meRef = useRef<MindElixirInstance | null>(null);
  const [title, setTitle] = useState(initialTitle);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [pub, setPub] = useState(isPublic);
  const [showShare, setShowShare] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showConvert, setShowConvert] = useState(false);
  const [converting, setConverting] = useState(false);
  const [preview, setPreview] = useState<{ kind: RefKind; refId: string; label: string } | null>(null);
  const [selectedRef, setSelectedRef] = useState<{ kind: RefKind; refId: string; label: string } | null>(
    null
  );
  const [previewInfo, setPreviewInfo] = useState<
    { status: "loading" } | { status: "ready"; data: ReferencePreview } | { status: "error" } | null
  >(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);
  const saveStateRef = useRef<SaveState>("saved");
  const isApplyingRemoteRef = useRef(false);
  // 노드 트리를 Yjs 로 구조적으로 동기화한다(문서/코드처럼 Yjs CRDT를 쓰되,
  // mind-elixir 에는 y-prosemirror 같은 공식 바인딩이 없어 lib/mindmap-yjs.ts
  // 에서 직접 구현했다 — 트리를 "id -> 노드" 평면 Y.Map 으로 펼쳐 두면, 서로
  // 다른 노드를 건드린 동시 편집은 Yjs 가 자동으로 병합해준다). lastSyncedRef
  // 는 "마지막으로 Yjs 에 반영한 로컬 상태" — 다음 로컬 변경과 비교(diff)해
  // 실제로 바뀐 노드만 쓰기 위한 기준선이다.
  const ydocRef = useRef<Y.Doc | null>(null);
  if (!ydocRef.current) {
    const doc = new Y.Doc();
    if (initialYjsState) {
      try {
        Y.applyUpdate(doc, decodeYUpdate(initialYjsState));
      } catch {
        // 손상된 스냅샷은 무시 — 아래 마운트 이펙트에서 기존 data 로 시드한다.
      }
    }
    ydocRef.current = doc;
  }
  const ydoc = ydocRef.current;
  const yNodes = ydoc.getMap<Y.Map<unknown>>("nodes");
  const lastSyncedRef = useRef<Map<string, FlatNode>>(new Map());

  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  // Supabase Realtime Broadcast 로 다른 접속자와 Yjs 업데이트를 주고받는다
  // (문서/코드 에디터와 동일한 전송 계층 — lib/yjs-transport.ts).
  useEffect(() => {
    return connectYjsBroadcast(ydoc, `mindmap:${mapId}`, isApplyingRemoteRef);
  }, [ydoc, mapId]);

  // 원격에서 온 구조 변경(다른 클라이언트의 로컬 diff 가 Yjs 에 쓴 내용)을
  // 반영한다. isApplyingRemoteRef 로 우리 자신의 로컬 쓰기가 되돌아와
  // observeDeep 을 다시 트리거하는 걸 걸러낸다(무한루프 방지, editor.tsx/
  // code-editor.tsx 와 같은 패턴). 항상(로컬에 저장 안 된 편집이 있어도)
  // 반영한다 — 아니면 diff 기준선(lastSyncedRef)이 Yjs 의 실제 상태와
  // 어긋나, 다음 로컬 저장 때 방금 병합된 원격 변경을 다시 지워버릴 수 있다.
  // 트레이드오프: 노드 텍스트를 한창 편집하던 중 원격 갱신이 오면 그 편집
  // 화면이 refresh 로 끊길 수 있다(알려진 한계 — Enter/포커스아웃으로 자주
  // 커밋하면 창이 줄어든다).
  // 드래그(pointerdown~up)나 노드 텍스트 편집(#input-box) 중에 refresh 로
  // DOM 을 갈아끼우면 mind-elixir 의 진행 중 제스처가 분리된 요소를 참조해
  // 오류가 난다 — 원격 반영을 보류했다가 상호작용이 끝나면 적용한다.
  const interactingRef = useRef(false);
  const pendingRemoteRef = useRef(false);
  // undo/redo 후 Yjs 동기화 함수(마운트 이펙트의 onOperation) — 버튼에서 호출.
  const syncHistoryRef = useRef<(() => void) | null>(null);

  const applyRemoteTree = useCallback(() => {
    const me = meRef.current;
    if (!me) return;
    const container = containerRef.current;
    const editing = !!container?.querySelector("#input-box");
    if (interactingRef.current || editing) {
      pendingRemoteRef.current = true;
      return;
    }
    pendingRemoteRef.current = false;
    const flat = readFlatFromYMap(yNodes);
    const rebuilt = reconstructTree(flat);
    if (!rebuilt) return;
    const current = me.getData();
    // 실제로 달라졌을 때만 refresh — 중복 전달/무의미 업데이트로 선택 상태와
    // 뷰가 툭툭 끊기는 것을 막는다.
    if (JSON.stringify(current.nodeData) === JSON.stringify(rebuilt)) {
      lastSyncedRef.current = flat;
      return;
    }
    me.refresh({ ...current, nodeData: rebuilt });
    lastSyncedRef.current = flat;
  }, [yNodes]);

  useEffect(() => {
    const onDeepChange = () => {
      if (!isApplyingRemoteRef.current) return;
      applyRemoteTree();
    };
    yNodes.observeDeep(onDeepChange);
    return () => yNodes.unobserveDeep(onDeepChange);
  }, [yNodes, applyRemoteTree]);

  // 상호작용 추적 + 보류된 원격 반영 flush.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onDown = () => {
      interactingRef.current = true;
    };
    const onUp = () => {
      interactingRef.current = false;
      if (pendingRemoteRef.current) applyRemoteTree();
    };
    container.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    // 노드 편집(#input-box)이 끝나는 시점은 이벤트로 못 잡으므로 짧은 주기로
    // 보류분만 재시도한다(보류가 없으면 아무 일도 안 함).
    const t = setInterval(() => {
      if (pendingRemoteRef.current) applyRemoteTree();
    }, 500);
    return () => {
      container.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      clearInterval(t);
    };
  }, [applyRemoteTree]);

  const persist = useCallback(async () => {
    const me = meRef.current;
    if (!me) return;
    setSaveState("saving");
    const data = me.getData();
    const yjsState = encodeYUpdate(Y.encodeStateAsUpdate(ydoc));
    const res = await saveMindMap(mapId, titleRef.current, data as unknown as Json, yjsState);
    if (res.ok) {
      setSaveState("saved");
    } else {
      setSaveState("dirty");
      setError(res.error);
    }
  }, [mapId, ydoc]);

  const markDirty = useCallback(() => {
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(persist, AUTOSAVE_MS);
  }, [persist]);

  const manualSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    persist();
  }, [persist]);

  const closePreview = useCallback(() => {
    setPreview(null);
    setPreviewInfo(null);
  }, []);

  // Mind Elixir 인스턴스는 마운트 시 한 번만 생성한다(내부 상태를 자체적으로
  // 들고 있으므로 React state 로 노드/간선을 다시 렌더링하지 않는다).
  useEffect(() => {
    if (!containerRef.current) return;

    const me = new MindElixir({
      el: containerRef.current,
      // SIDE: 루트를 중심으로 가지를 양쪽에 균형 배치(alignment 기본값 "root")
      // — 전체 구조를 한눈에 훑는 원형(circle-type) 개관에 가장 가깝다.
      direction: MindElixir.SIDE,
      // 가지 드래그 재배치(다른 부모로 이동·순서 변경). 드롭 시 mind-elixir 가
      // operation 이벤트를 발생시키므로 기존 onOperation → Yjs(parentId/order
      // diff) 동기화 + 자동저장 경로를 그대로 타서 저장까지 이어진다.
      draggable: canEdit,
      editable: canEdit,
      contextMenu: canEdit,
      toolBar: true,
      keypress: canEdit,
      // 앱 테마(라이트/다크)에 맞춘 맵 색상.
      theme:
        document.documentElement.dataset.theme === "light"
          ? MindElixir.THEME
          : MindElixir.DARK_THEME,
    }) as MindElixirInstance;

    // 대형 맵 이동 시 화면이 통째로 비는 버그의 근본 시정 — mind-elixir 는
    // 패닝/줌마다 .map-canvas 에 translate3d 를 쓰는데, 3d 변환은 요소를 GPU
    // 레이어로 승격시키고, max-content 로 커진 초대형 맵은 GPU 텍스처 한계
    // (보통 16384px)를 넘겨 이동하는 동안 빈 타일만 보인다. translate3d 를
    // 동일한 2d translate 로 강등하면 레이어 승격이 사라져 브라우저가 필요한
    // 부분만 다시 그린다(스크롤 성능을 약간 내주고 가시성을 얻는 트레이드오프).
    const mapCanvas = containerRef.current.querySelector(".map-canvas") as HTMLElement | null;
    let demoting = false;
    const demoteObserver = new MutationObserver(() => {
      if (demoting || !mapCanvas) return;
      const t = mapCanvas.style.transform;
      if (t && t.includes("translate3d")) {
        demoting = true;
        mapCanvas.style.transform = t.replace(
          /translate3d\(([^,]+),\s*([^,]+),\s*[^)]+\)/g,
          "translate($1, $2)"
        );
        demoting = false;
      }
    });
    if (mapCanvas) {
      demoteObserver.observe(mapCanvas, { attributes: true, attributeFilter: ["style"] });
    }

    // arrows/summaries 는 Yjs 로 동기화하지 않는다(노드 트리만 CRDT 대상 —
    // 저장할 때마다 통째로 반영되는 JSON 스냅샷(data 컬럼)에서 가져온다).
    // 노드 트리 자체는 Yjs 상태가 있으면 그쪽이 더 최신이므로 그것을 쓴다.
    const legacy = parseInitialData(initialData, initialTitle);
    const existingFlat = readFlatFromYMap(yNodes);
    let initTree: MindElixirData;
    if (existingFlat.size > 0) {
      const rebuilt = reconstructTree(existingFlat);
      initTree = { nodeData: rebuilt ?? legacy.nodeData, arrows: legacy.arrows, summaries: legacy.summaries };
      lastSyncedRef.current = existingFlat;
    } else {
      const seedFlat = flattenTree(legacy.nodeData);
      // 결정적 시드(고정 clientID) — 두 클라이언트가 스냅샷 없는 맵을 동시에
      // 열어도 시드가 같은 오퍼레이션으로 병합된다(문서/코드 에디터와 동일).
      seedDeterministically(ydoc, () =>
        ydoc.transact(() => syncFlatToYMap(yNodes, new Map(), seedFlat))
      );
      initTree = legacy;
      lastSyncedRef.current = seedFlat;
    }
    me.init(initTree);
    meRef.current = me;
    // 처음 열 때 전체 맵이 뷰포트에 들어오도록 맞춘다("한눈에 보기").
    // 컨테이너가 아직 0 크기면 scaleFit 이 0/0 → scaleVal 이 NaN/0 으로
    // 오염되고, 이후 모든 확대/축소가 NaN 변환을 만들어 맵이 통째로 깨진다
    // — 크기가 잡힌 뒤에만 실행하고, 결과가 비정상이면 scale 1 로 복구한다.
    requestAnimationFrame(() => {
      if (meRef.current !== me) return; // 이미 언마운트/destroy 됨
      const el = containerRef.current;
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        me.scaleFit();
      }
      if (!Number.isFinite(me.scaleVal) || me.scaleVal <= 0) {
        me.scale(1);
      }
    });

    const onOperation = () => {
      const flat = flattenTree(me.getData().nodeData);
      ydoc.transact(() => syncFlatToYMap(yNodes, lastSyncedRef.current, flat));
      lastSyncedRef.current = flat;
      if (canEdit) markDirty();
    };
    me.bus.addListener("operation", onOperation);
    // mind-elixir 의 undo/redo 는 내부적으로 refresh() 만 호출하고 "operation"
    // 이벤트를 발생시키지 않는다 — 그대로 두면 되돌리기가 Yjs 로 전파되지도,
    // 자동저장되지도 않는다(협업자에게 안 보이는 유령 되돌리기). 히스토리
    // 조작 직후 diff 동기화를 명시적으로 실행한다(툴바 버튼 + Ctrl/Cmd+Z 계열
    // 키보드 경로 모두). diff 기반이라 변화가 없으면 no-op 이다.
    syncHistoryRef.current = onOperation;
    const onHistoryKey = (ev: KeyboardEvent) => {
      const k = ev.key.toLowerCase();
      if ((ev.metaKey || ev.ctrlKey) && (k === "z" || k === "y")) {
        setTimeout(onOperation, 0);
      }
    };
    containerRef.current.addEventListener("keydown", onHistoryKey);

    // 더블클릭은 mind-elixir 자체의 "노드 이름 바꾸기" 제스처와 겹친다 —
    // editable 일 때 mind-elixir 는 더블클릭/더블탭을 자체 포인터 타이머로
    // 감지해 항상 beginEdit() 을 호출하므로(우리 dblclick 리스너와는 완전히
    // 독립적인 내부 로직이라 stopPropagation 으로도 막을 수 없다), 참조 노드를
    // 더블클릭하면 미리보기가 열리는 동시에 이름 바꾸기 모드로도 들어가버렸다.
    // 제스처로 경쟁하는 대신, 클릭마다 현재 선택 노드를 추적해 참조 노드가
    // 선택돼 있으면 툴바에 "Open reference" 버튼을 보여주는 방식으로 바꿔
    // 충돌 자체를 없앤다.
    const onClick = () => {
      const node = me.currentNode;
      const meta = node?.nodeObj.metadata as NodeMeta | undefined;
      if (node && meta && meta.kind !== "note") {
        setSelectedRef({ kind: meta.kind, refId: meta.refId, label: node.nodeObj.topic ?? "" });
      } else {
        setSelectedRef(null);
      }
    };
    containerRef.current.addEventListener("click", onClick);

    return () => {
      containerRef.current?.removeEventListener("click", onClick);
      containerRef.current?.removeEventListener("keydown", onHistoryKey);
      syncHistoryRef.current = null;
      demoteObserver.disconnect();
      me.destroy();
      meRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Cmd/Ctrl+S 로 즉시 저장
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!canEdit) return;
        manualSave();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [canEdit, manualSave]);

  const addNote = () => {
    const me = meRef.current;
    if (!me || !canEdit) return;
    const parent = me.currentNode ?? me.findEle(me.nodeData.id);
    me.addChild(parent, {
      id: crypto.randomUUID(),
      topic: "New note",
      metadata: { kind: "note" } as NodeMeta,
    });
  };

  // mind-elixir 의 insertParent()는 대상 노드에 parent 가 없으면(= 루트 노드)
  // 조용히 아무 것도 하지 않고 리턴한다(라이브러리 자체 동작 — 상위에 상위를
  // 또 붙일 수 없다는 트리 구조상 제약을 에러 없이 무시해버림). 새로 만든
  // 마인드맵은 루트 노드 하나뿐이라 사용자가 맨 처음 시도하는 조작이 바로
  // 이 케이스라, "상위 추가"가 안 먹는 것처럼 보이는 원인이었다. 루트일
  // 때는 새 루트로 기존 트리 전체를 감싸는 방식으로 우리가 직접 구현한다.
  const addParent = () => {
    const me = meRef.current;
    if (!me || !canEdit) return;
    const target = me.currentNode;
    if (!target) {
      setError("Select a node first, then click + Parent.");
      return;
    }
    if (!target.nodeObj.parent) {
      const data = me.getData();
      const newRoot: NodeObj = {
        id: crypto.randomUUID(),
        topic: "New node",
        children: [data.nodeData],
        metadata: { kind: "note" } as NodeMeta,
      };
      me.refresh({ ...data, nodeData: newRoot });
      // me.refresh() 는 addChild/insertParent 등과 달리 "operation" 버스
      // 이벤트를 쏘지 않는다 — 여기서 직접 Yjs 로 동기화해야 새 루트가
      // 다른 접속자에게도 반영된다.
      const flat = flattenTree(newRoot);
      ydoc.transact(() => syncFlatToYMap(yNodes, lastSyncedRef.current, flat));
      lastSyncedRef.current = flat;
      markDirty();
      return;
    }
    me.insertParent(target, {
      id: crypto.randomUUID(),
      topic: "New node",
      metadata: { kind: "note" } as NodeMeta,
    });
  };

  // mind-elixir 의 insertSibling()도 대상이 루트면 parent 가 없어 사일런트하게
  // addChild() 로 대체 실행한다 — "동급 추가"를 눌렀는데 실제로는 하위가
  // 생기는, 원인을 알기 어려운 동작이었다. 루트의 형제는 트리 구조상 애초에
  // 성립하지 않으므로(맵마다 루트는 하나) 조용히 다른 동작으로 넘어가는 대신
  // 명확히 안내하고 막는다.
  const addSibling = () => {
    const me = meRef.current;
    if (!me || !canEdit) return;
    const target = me.currentNode;
    if (!target || !target.nodeObj.parent) {
      setError("The root node can't have a sibling — a mind map has exactly one root.");
      return;
    }
    me.insertSibling("after", target, {
      id: crypto.randomUUID(),
      topic: "New node",
      metadata: { kind: "note" } as NodeMeta,
    });
  };

  const addReference = () => {
    const me = meRef.current;
    if (!me || !canEdit || !pick) return;
    const item = items.find((i) => `${i.kind}:${i.id}` === pick);
    if (!item) return;
    const parent = me.currentNode ?? me.findEle(me.nodeData.id);
    me.addChild(parent, {
      id: crypto.randomUUID(),
      topic: `[${item.kind}] ${item.label}`,
      metadata: { kind: item.kind, refId: item.id } as NodeMeta,
    });
    setPick("");
  };

  const fitView = () => {
    meRef.current?.scaleFit();
  };

  const onConvert = async (target: "document" | "sheet") => {
    setShowConvert(false);
    setError(null);

    // 문서/시트 변환은 참조 노드(파일/코드/문서 링크)의 metadata 를 옮기지
    // 않고 topic 텍스트만 옮긴다 — 되돌릴 수 없이 평범한 텍스트가 되므로,
    // 실제로 생성하기 전에 몇 개가 영향받는지 먼저 알리고 취소할 수 있게 한다.
    // me.getData() 로 지금 화면의 최신 상태(저장 안 된 편집 포함)를 그대로 센다.
    const me = meRef.current;
    const refCount = me ? countReferenceNodes(me.getData().nodeData) : 0;
    if (refCount > 0) {
      const noun = refCount === 1 ? "reference node" : "reference nodes";
      const ok = confirm(
        `This map has ${refCount} ${noun} that will become plain text in the new ${target} — continue?`
      );
      if (!ok) return;
    }

    setConverting(true);
    // 변환은 DB 에 저장된 데이터를 읽으므로, 편집 권한이 있고 저장 안 된
    // 내용이 있을 수 있으면 먼저 강제로 저장한다(읽기 전용 뷰어는 저장 권한이
    // 없고 애초에 로컬 변경도 없으므로 건너뛴다).
    if (canEdit) {
      if (timer.current) clearTimeout(timer.current);
      await persist();
    }
    const res =
      target === "document" ? await createDocumentFromMindmap(mapId) : await createSheetFromMindmap(mapId);
    setConverting(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    openTab(target, res.id, res.title, res.seed);
  };

  useEffect(() => {
    if (!preview) return;
    let cancelled = false;
    setPreviewInfo({ status: "loading" });
    getReferencePreview(preview.kind, preview.refId)
      .then((data) => {
        if (cancelled) return;
        setPreviewInfo(data ? { status: "ready", data } : { status: "error" });
      })
      .catch(() => {
        if (!cancelled) setPreviewInfo({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [preview]);

  const openPreviewInTab = () => {
    if (!preview) return;
    const { kind, refId, label } = preview;
    if (kind === "file") return; // 파일은 탭 종류에 포함되지 않음 — /files 로 안내
    openTab(kind, refId, label);
    closePreview();
  };

  const togglePublic = async () => {
    const next = !pub;
    setPub(next);
    const res = await setMindMapPublic(mapId, next);
    if (!res.ok) {
      setPub(!next);
      setError(res.error);
    }
  };

  const afterDelete = () => {
    closeTab(tabId("mindmap", mapId));
    router.push("/mindmap");
    router.refresh();
  };

  const stateLabel =
    saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved" : "Saved";

  return (
    <div className="mm-shell">
      <div className="mm-bar">
        <div className="mm-bar-left">
          <input
            className="mm-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              renameTab("mindmap", mapId, e.target.value.trim() || "Untitled map");
            }}
            placeholder="Untitled map"
            disabled={!canEdit}
          />
          {canEdit && (
            <>
              <button
                className="btn btn-sm"
                onClick={addParent}
                title="Add a node above the selected node (wraps the root if it's selected)"
              >
                + Parent
              </button>
              <button className="btn btn-sm" onClick={addNote} title="Add a child of the selected node">
                + Note
              </button>
              <button
                className="btn btn-sm"
                onClick={addSibling}
                title="Add a node at the same level as the selected node"
              >
                + Sibling
              </button>
              <select
                className="mm-picker"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
              >
                <option value="">Add reference…</option>
                {items.map((i) => (
                  <option key={`${i.kind}:${i.id}`} value={`${i.kind}:${i.id}`}>
                    [{i.kind}] {i.label}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" onClick={addReference} disabled={!pick}>
                Add
              </button>
              {canEdit && (
                <>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      (meRef.current as unknown as { undo?: () => void } | null)?.undo?.();
                      syncHistoryRef.current?.();
                    }}
                    title="Undo (⌘Z)"
                  >
                    ↩
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      (meRef.current as unknown as { redo?: () => void } | null)?.redo?.();
                      syncHistoryRef.current?.();
                    }}
                    title="Redo (⇧⌘Z)"
                  >
                    ↪
                  </button>
                </>
              )}
              <button className="btn btn-sm" onClick={fitView} title="Fit the map to the screen">
                Fit view
              </button>
            </>
          )}
          {selectedRef && (
            <button
              className="btn btn-sm"
              onClick={() => setPreview(selectedRef)}
              title="Open a preview of the selected reference node"
            >
              Open reference
            </button>
          )}
        </div>
        <div className="row" style={{ gap: 10 }}>
          <PresenceAvatars users={presenceUsers} />
          <RepositoryPicker kind="mindmap" itemId={mapId} canEdit={canEdit} />
          <ContributorBadges kind="mindmap" id={mapId} refreshToken={saveState} />
          <span
            className={`save-state ${
              saveState === "dirty" ? "dirty" : saveState === "saved" ? "saved" : ""
            }`}
          >
            ● {stateLabel}
          </span>
          <div style={{ position: "relative" }}>
            <button
              className="btn btn-sm"
              onClick={() => setShowConvert((v) => !v)}
              disabled={converting}
            >
              {converting ? "Converting…" : "Convert"}
            </button>
            {showConvert && (
              <div className="acct-menu" style={{ top: 32, minWidth: 170 }}>
                <button className="acct-item" onClick={() => onConvert("document")}>
                  Create document (outline)
                </button>
                <button className="acct-item" onClick={() => onConvert("sheet")}>
                  Create sheet (rows)
                </button>
              </div>
            )}
          </div>
          {isOwner && (
            <>
              <button className="btn btn-sm" onClick={togglePublic}>
                {pub ? "Public" : "Private"}
              </button>
              <button className="btn btn-sm" onClick={() => setShowShare(true)}>
                Share
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => setShowDelete(true)}>
                Delete
              </button>
            </>
          )}
          {canEdit && (
            <button
              className="btn btn-primary btn-sm"
              onClick={manualSave}
              disabled={saveState === "saving"}
            >
              Save
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 24px 0" }}>
          <div className="notice notice-error" style={{ margin: 0 }}>
            {error}
          </div>
        </div>
      )}

      <div className="mm-canvas">
        <div className="mm-fill">
          <div ref={containerRef} className="mm-mount" />
        </div>

        {preview && (
          <div className="mm-preview">
            <div className="mm-preview-head">
              <span className="mm-preview-kind">{preview.kind}</span>
              <button className="mm-preview-close" onClick={closePreview} aria-label="Close preview">✕</button>
            </div>
            {previewInfo?.status === "loading" && (
              <div className="mm-preview-body muted">Loading…</div>
            )}
            {previewInfo?.status === "error" && (
              <div className="mm-preview-body muted">Not found or access denied.</div>
            )}
            {previewInfo?.status === "ready" && (
              <div className="mm-preview-body">
                <div className="mm-preview-title">{previewInfo.data.title}</div>
                {previewInfo.data.kind === "document" && (
                  <p className="mm-preview-snippet">
                    {previewInfo.data.snippet || "Empty document."}
                  </p>
                )}
                {previewInfo.data.kind === "code" && (
                  <>
                    <span className="mm-preview-meta">{previewInfo.data.language}</span>
                    <pre className="mm-preview-code">{previewInfo.data.snippet || "// Empty file"}</pre>
                  </>
                )}
                {previewInfo.data.kind === "file" && (
                  <span className="mm-preview-meta">
                    {previewInfo.data.mimeType || "Unknown type"} · {formatBytes(previewInfo.data.sizeBytes)}
                  </span>
                )}
                {previewInfo.data.kind === "sheet" && (
                  <span className="mm-preview-meta">
                    {previewInfo.data.sheetCount} sheet{previewInfo.data.sheetCount === 1 ? "" : "s"} ·{" "}
                    {previewInfo.data.cellCount} cell{previewInfo.data.cellCount === 1 ? "" : "s"} with data
                  </span>
                )}
                {previewInfo.data.kind === "mindmap" && (
                  <>
                    <span className="mm-preview-meta">
                      {previewInfo.data.nodeCount} node{previewInfo.data.nodeCount === 1 ? "" : "s"}
                    </span>
                    {previewInfo.data.snippet && (
                      <p className="mm-preview-snippet">{previewInfo.data.snippet}</p>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="mm-preview-actions">
              {preview.kind === "file" ? (
                <Link href="/files" className="btn btn-sm btn-primary" onClick={closePreview}>
                  Open in Repository
                </Link>
              ) : (
                <button className="btn btn-sm btn-primary" onClick={openPreviewInTab}>
                  Open
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {showShare && (
        <ShareDialog
          targetLabel={title || "Untitled map"}
          myShareId={myShareId}
          loadShares={() => listMindMapShares(mapId)}
          onShare={(rid, perm) => shareMindMap(mapId, rid, perm)}
          onRevoke={(pid) => revokeMindMapShare(pid)}
          onClose={() => setShowShare(false)}
        />
      )}

      {showDelete && (
        <DeleteConfirmDialog
          itemKind="mind map"
          itemLabel={title || "Untitled map"}
          onConfirm={() => deleteMindMap(mapId)}
          onDeleted={afterDelete}
          onClose={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}

export function MindMapCanvas(props: React.ComponentProps<typeof Inner>) {
  return <Inner {...props} />;
}
