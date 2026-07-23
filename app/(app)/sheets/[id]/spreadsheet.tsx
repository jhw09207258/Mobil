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
import { connectYjsBroadcast, encodeYUpdate, decodeYUpdate } from "@/lib/yjs-transport";
import {
  flattenSheets,
  syncFlatToYDoc,
  readFlatFromYDoc,
  reconstructSheets,
  type FlatSheets,
} from "@/lib/sheet-yjs";
import { Workbook } from "@fortune-sheet/react";
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
      syncFlatToYDoc(doc, { order: [], metas: new Map(), cells: new Map() }, seedFlat);
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
  // 다시 트리거되는 걸 걸러낸다. 항상(로컬에 저장 안 된 편집이 있어도)
  // 반영한다 — Yjs 문서 자체가 이미 병합된 상태의 원천이므로, 반영을 미루면
  // diff 기준선(lastSyncedRef)이 실제 Yjs 상태와 어긋나 다음 로컬 저장 때
  // 방금 merge 된 원격 변경을 도로 지워버릴 수 있다(마인드맵 에디터와 동일한
  // 이유).
  useEffect(() => {
    const yOrder = ydoc.getArray<string>("order");
    const yMetas = ydoc.getMap<Record<string, unknown>>("metas");
    const yCells = ydoc.getMap<unknown>("cells");

    const onRemoteChange = () => {
      if (!isApplyingRemoteRef.current) return;
      const flat = readFlatFromYDoc(ydoc);
      sheetsRef.current = reconstructSheets(flat);
      lastSyncedRef.current = flat;
      skipFirst.current = true; // Workbook 리마운트 시 재초기화 콜백은 건너뛴다.
      setRemoteVersion((v) => v + 1);
    };
    yOrder.observe(onRemoteChange);
    yMetas.observe(onRemoteChange);
    yCells.observe(onRemoteChange);
    return () => {
      yOrder.unobserve(onRemoteChange);
      yMetas.unobserve(onRemoteChange);
      yCells.unobserve(onRemoteChange);
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
      syncFlatToYDoc(ydoc, lastSyncedRef.current, flat);
      lastSyncedRef.current = flat;
      markDirty();
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
