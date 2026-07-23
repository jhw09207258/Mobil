"use client";

// @fortune-sheet/react 는 스타일시트를 스스로 import 하지 않는다(타입 선언에만
// 존재, 런타임 JS 에는 없음) — 소비자가 직접 로드해야 한다.
import "@fortune-sheet/react/dist/index.css";
import "./spreadsheet.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Y from "yjs";
import { useWorkspace, tabId } from "../../workspace/workspace-context";
import { ContributorBadges } from "../../contributors/contributor-badges";
import { createMindmapFromSheet } from "../../convert-actions";
import { usePresence } from "@/lib/use-presence";
import { colorForUserId } from "@/lib/presence-color";
import { PresenceAvatars } from "@/components/presence-avatars";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { connectYjsBroadcast, encodeYUpdate, decodeYUpdate, seedDeterministically } from "@/lib/yjs-transport";
import {
  flattenSheets,
  syncFlatToYDoc,
  readFlatFromYDoc,
  reconstructSheets,
  type FlatSheets,
} from "@/lib/sheet-yjs";
import { Workbook, type WorkbookInstance } from "@fortune-sheet/react";
import type { Sheet } from "@fortune-sheet/core";
import type { Json } from "@/lib/database.types";
import { ShareDialog } from "@/components/share-dialog";
import {
  saveSheet,
  deleteSheet,
  setSheetPublic,
  shareSheet,
  revokeSheetShare,
  listSheetShares,
  exportSheet,
  type SheetExportFormat,
} from "../actions";
import { downloadBase64File } from "@/lib/download-file";

type SaveState = "saved" | "dirty" | "saving";
const AUTOSAVE_MS = 1200;

function defaultSheets(): Sheet[] {
  return [{ name: "Sheet1", id: "sheet-01", celldata: [], row: 100, column: 30, status: 1 }];
}

function parseSheets(data: Json): Sheet[] {
  if (Array.isArray(data) && data.length > 0) return data as unknown as Sheet[];
  return defaultSheets();
}

export function Spreadsheet({
  sheetId,
  initialTitle,
  initialData,
  initialYjsState,
  canEdit,
  isOwner,
  isPublic,
  myShareId,
  myName,
  myAvatarUrl,
}: {
  sheetId: string;
  initialTitle: string;
  initialData: Json;
  initialYjsState: string | null;
  canEdit: boolean;
  isOwner: boolean;
  isPublic: boolean;
  myShareId: string;
  myName: string;
  myAvatarUrl: string | null;
}) {
  const router = useRouter();
  const { renameTab, openTab, closeTab } = useWorkspace();
  const presenceUsers = usePresence(`sheet:${sheetId}`, {
    id: myShareId,
    name: myName,
    avatarUrl: myAvatarUrl,
    color: colorForUserId(myShareId),
  });
  const [title, setTitle] = useState(initialTitle);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [pub, setPub] = useState(isPublic);
  const [showShare, setShowShare] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [converting, setConverting] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onExport = async (format: SheetExportFormat) => {
    setShowExport(false);
    setExporting(true);
    setError(null);
    const res = await exportSheet(sheetId, format);
    if ("error" in res) setError(res.error);
    else downloadBase64File(res.fileName, res.mimeType, res.base64);
    setExporting(false);
  };
  const skipFirst = useRef(true);
  const titleRef = useRef(title);
  const isApplyingRemoteRef = useRef(false);

  // Yjs 문서: 셀 단위 실시간 동시편집 상태(lib/sheet-yjs.ts). 스냅샷
  // (initialYjsState)이 있으면 그걸로 복원하고 없으면(레거시 시트를 이
  // 기능이 나온 뒤 처음 여는 경우) initialData 로 시드한다.
  const ydocRef = useRef<Y.Doc | null>(null);
  const lastSyncedRef = useRef<FlatSheets>({ order: [], metas: new Map(), cells: new Map() });
  const sheetsRef = useRef<Sheet[]>(parseSheets(initialData));
  if (!ydocRef.current) {
    const doc = new Y.Doc();
    if (initialYjsState) {
      try {
        Y.applyUpdate(doc, decodeYUpdate(initialYjsState));
      } catch {
        // 손상된 스냅샷은 무시 — 아래에서 기존 initialData 로 시드한다.
      }
    }
    const existingFlat = readFlatFromYDoc(doc);
    if (existingFlat.order.length > 0) {
      sheetsRef.current = reconstructSheets(existingFlat);
      lastSyncedRef.current = existingFlat;
    } else {
      const seedFlat = flattenSheets(sheetsRef.current);
      // 결정적 시드 — 두 클라이언트가 스냅샷 없는 시트를 동시에 열어도 시드가
      // 같은 오퍼레이션으로 병합된다(문서/코드/마인드맵과 동일).
      seedDeterministically(doc, () =>
        syncFlatToYDoc(doc, { order: [], metas: new Map(), cells: new Map() }, seedFlat)
      );
      lastSyncedRef.current = seedFlat;
    }
    ydocRef.current = doc;
  }
  const ydoc = ydocRef.current;
  const [remoteVersion, setRemoteVersion] = useState(0);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  // Supabase Realtime Broadcast 로 다른 접속자와 Yjs 업데이트를 주고받는다
  // (문서/코드/마인드맵 에디터와 동일한 전송 계층).
  useEffect(() => {
    return connectYjsBroadcast(ydoc, `sheet:${sheetId}`, isApplyingRemoteRef);
  }, [ydoc, sheetId]);

  // 원격에서 온 셀/메타/순서 변경(다른 클라이언트의 로컬 diff 가 Yjs 에 쓴
  // 내용)을 반영한다. isApplyingRemoteRef 로 우리 자신의 로컬 쓰기가 되돌아와
  // 다시 트리거되는 걸 걸러낸다.
  //
  // 반영 방식이 중요하다 — 예전에는 어떤 원격 변경이든 Workbook 을 통째로
  // 리마운트(key 교체)했는데, 상대가 타이핑할 때마다 내 셀 선택·수식 입력·
  // 스크롤이 전부 초기화되어 "실시간 작업이 사실상 불가능"했다. 이제:
  //   · 셀 값만 바뀐 경우(대부분): WorkbookInstance API 로 해당 셀만 갱신
  //     (clearCell 후 setCellValue — 기존 셀에 setCellValue 만 하면 스타일
  //     필드가 병합되지 않아 원격 서식 변경이 유실된다). 내 편집 상태 유지.
  //   · 시트 추가/삭제/순서/메타(서식·병합 등) 변경: 구조가 바뀌므로 기존
  //     리마운트 경로를 유지한다(드문 조작이라 체감 비용이 낮다).
  // 한 트랜잭션의 여러 observer 호출은 마이크로태스크로 모아 한 번에 처리한다.
  const wbRef = useRef<WorkbookInstance>(null);
  useEffect(() => {
    const yOrder = ydoc.getArray<string>("order");
    const yMetas = ydoc.getMap<Record<string, unknown>>("metas");
    const yCells = ydoc.getMap<unknown>("cells");

    let pendingCellKeys = new Set<string>();
    let pendingStructural = false;
    let flushQueued = false;

    const flush = () => {
      flushQueued = false;
      const cellKeys = pendingCellKeys;
      const structural = pendingStructural;
      pendingCellKeys = new Set();
      pendingStructural = false;

      const flat = readFlatFromYDoc(ydoc);
      lastSyncedRef.current = flat; // 에코 diff 가 no-op 이 되도록 기준선 먼저 갱신
      sheetsRef.current = reconstructSheets(flat);

      const wb = wbRef.current;
      if (structural || !wb) {
        skipFirst.current = true; // Workbook 리마운트 시 재초기화 콜백은 건너뛴다.
        setRemoteVersion((v) => v + 1);
        return;
      }
      for (const key of cellKeys) {
        const sep1 = key.indexOf(":");
        const sheetId = key.slice(0, sep1);
        const rest = key.slice(sep1 + 1);
        const sep2 = rest.indexOf(":");
        const r = Number(rest.slice(0, sep2));
        const c = Number(rest.slice(sep2 + 1));
        if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
        try {
          wb.clearCell(r, c, { id: sheetId });
          const v = flat.cells.get(key);
          if (v !== undefined && v !== null) {
            wb.setCellValue(r, c, v, { id: sheetId });
          }
        } catch {
          // 좌표가 현재 그리드 밖(행/열 수 차이 등)이면 이 셀만 건너뛴다 —
          // 데이터는 이미 sheetsRef 에 있으므로 다음 구조 반영 때 나타난다.
        }
      }
    };

    const queueFlush = () => {
      if (!flushQueued) {
        flushQueued = true;
        queueMicrotask(flush);
      }
    };
    const onCells = (event: Y.YMapEvent<unknown>) => {
      if (!isApplyingRemoteRef.current) return;
      for (const key of event.keysChanged) pendingCellKeys.add(key);
      queueFlush();
    };
    const onStructural = () => {
      if (!isApplyingRemoteRef.current) return;
      pendingStructural = true;
      queueFlush();
    };
    yOrder.observe(onStructural);
    yMetas.observe(onStructural);
    yCells.observe(onCells);
    return () => {
      yOrder.unobserve(onStructural);
      yMetas.unobserve(onStructural);
      yCells.unobserve(onCells);
    };
  }, [ydoc]);

  const persist = useCallback(async () => {
    setSaveState("saving");
    const yjsState = encodeYUpdate(Y.encodeStateAsUpdate(ydoc));
    const res = await saveSheet(sheetId, titleRef.current, sheetsRef.current as unknown as Json, yjsState);
    if (res.ok) {
      setSaveState("saved");
    } else {
      setSaveState("dirty");
      setError(res.error);
    }
  }, [sheetId, ydoc]);

  const markDirty = useCallback(() => {
    if (!canEdit) return;
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(persist, AUTOSAVE_MS);
  }, [canEdit, persist]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Cmd/Ctrl+S 로 즉시 저장
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!canEdit) return;
        if (timer.current) clearTimeout(timer.current);
        persist();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [canEdit, persist]);

  // 시트 데이터(셀 편집·서식·탭 추가 등) 변경 시: 이전 스냅샷과 diff 해 실제로
  // 바뀐 셀/메타만 Yjs 에 반영하고(다른 접속자에게 곧바로 전파됨), 자동저장을
  // 건다. 최초 마운트 콜백은 Workbook 초기화 과정에서도 발생하므로 건너뛴다.
  const onSheetChange = useCallback(
    (data: Sheet[]) => {
      sheetsRef.current = data;
      if (skipFirst.current) {
        skipFirst.current = false;
        return;
      }
      const flat = flattenSheets(data);
      // 실제로 쓴 게 있을 때만 저장을 건다 — 원격 반영(API 로 셀 갱신)이
      // 되돌려주는 onChange 는 diff 가 비어 "메아리 저장"이 걸리지 않는다.
      const wrote = syncFlatToYDoc(ydoc, lastSyncedRef.current, flat);
      lastSyncedRef.current = flat;
      if (wrote) markDirty();
    },
    [markDirty, ydoc]
  );

  const onTitle = (v: string) => {
    setTitle(v);
    renameTab("sheet", sheetId, v.trim() || "Untitled sheet");
    if (canEdit) markDirty();
  };

  const manualSave = () => {
    if (timer.current) clearTimeout(timer.current);
    persist();
  };

  const onConvertToMindmap = async () => {
    setConverting(true);
    setError(null);
    if (canEdit) {
      if (timer.current) clearTimeout(timer.current);
      await persist();
    }
    const res = await createMindmapFromSheet(sheetId);
    setConverting(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    openTab("mindmap", res.id, res.title, res.seed);
  };

  const togglePublic = async () => {
    const next = !pub;
    setPub(next);
    const res = await setSheetPublic(sheetId, next);
    if (!res.ok) {
      setPub(!next);
      setError(res.error);
    }
  };

  const afterDelete = () => {
    closeTab(tabId("sheet", sheetId));
    router.push("/sheets");
    router.refresh();
  };

  const stateLabel =
    saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved" : "Saved";

  return (
    <div className="sh-shell">
      <div className="sh-bar">
        <div className="sh-bar-left">
          <input
            className="sh-title"
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            placeholder="Untitled sheet"
            disabled={!canEdit}
          />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <PresenceAvatars users={presenceUsers} />
          <ContributorBadges kind="sheet" id={sheetId} refreshToken={saveState} />
          <span
            className={`save-state ${
              saveState === "dirty" ? "dirty" : saveState === "saved" ? "saved" : ""
            }`}
          >
            ● {stateLabel}
          </span>
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
          <button
            className="btn btn-sm"
            onClick={onConvertToMindmap}
            disabled={converting}
            title="Create a new mind map from column A (Level) / column B (Topic)"
          >
            {converting ? "Converting…" : "→ Mind map"}
          </button>
          <div style={{ position: "relative" }}>
            <button
              className="btn btn-sm"
              onClick={() => setShowExport((v) => !v)}
              disabled={exporting}
            >
              {exporting ? "Exporting…" : "Export"}
            </button>
            {showExport && (
              <div className="acct-menu" style={{ top: 32, minWidth: 140 }}>
                <button className="acct-item" onClick={() => onExport("csv")}>CSV (.csv)</button>
                <button className="acct-item" onClick={() => onExport("xlsx")}>Excel (.xlsx)</button>
                <button className="acct-item" onClick={() => onExport("pdf")}>PDF (.pdf)</button>
              </div>
            )}
          </div>
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

      <div className="sh-canvas">
        <div className="sh-paper">
          <Workbook
            key={remoteVersion}
            ref={wbRef}
            data={sheetsRef.current}
            onChange={onSheetChange}
            allowEdit={canEdit}
            lang="en"
            showToolbar={canEdit}
            showFormulaBar={canEdit}
          />
        </div>
      </div>

      {showShare && (
        <ShareDialog
          targetLabel={title || "Untitled sheet"}
          myShareId={myShareId}
          loadShares={() => listSheetShares(sheetId)}
          onShare={(rid, perm) => shareSheet(sheetId, rid, perm)}
          onRevoke={(pid) => revokeSheetShare(pid)}
          onClose={() => setShowShare(false)}
        />
      )}

      {showDelete && (
        <DeleteConfirmDialog
          itemKind="sheet"
          itemLabel={title || "Untitled sheet"}
          onConfirm={() => deleteSheet(sheetId)}
          onDeleted={afterDelete}
          onClose={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}
