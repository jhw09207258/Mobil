"use client";

import "./code-editor.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Y from "yjs";
import { useWorkspace, tabId } from "../../workspace/workspace-context";
import { ContributorBadges } from "../../contributors/contributor-badges";
import { usePresence } from "@/lib/use-presence";
import { colorForUserId } from "@/lib/presence-color";
import { PresenceAvatars } from "@/components/presence-avatars";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import dynamic from "next/dynamic";
import { LANGUAGES, isLangKey, detectLanguage, type LangKey } from "@/lib/languages";
import { ShareDialog } from "@/components/share-dialog";
import { connectYjsBroadcast, encodeYUpdate, decodeYUpdate } from "@/lib/yjs-transport";
import {
  saveCodeFile,
  deleteCodeFile,
  setCodeFilePublic,
  shareCodeFile,
  revokeCodeFileShare,
  listCodeFileShares,
} from "../actions";

const CodeMirror = dynamic(
  () => import("@/components/codemirror/code-mirror").then((m) => m.CodeMirror),
  {
    ssr: false,
    loading: () => (
      <div className="empty" style={{ padding: 40 }}>
        Loading editor…
      </div>
    ),
  }
);

type SaveState = "saved" | "dirty" | "saving";
const AUTOSAVE_MS = 1200;

export function CodeEditor({
  fileId,
  initialName,
  initialLanguage,
  initialContent,
  initialYjsState,
  canEdit,
  isOwner,
  isPublic,
  myShareId,
  myName,
  myAvatarUrl,
}: {
  fileId: string;
  initialName: string;
  initialLanguage: string;
  initialContent: string;
  initialYjsState: string | null;
  canEdit: boolean;
  isOwner: boolean;
  isPublic: boolean;
  myShareId: string;
  myName: string;
  myAvatarUrl: string | null;
}) {
  const router = useRouter();
  const { renameTab, closeTab } = useWorkspace();
  const presenceUsers = usePresence(`code:${fileId}`, {
    id: myShareId,
    name: myName,
    avatarUrl: myAvatarUrl,
    color: colorForUserId(myShareId),
  });
  const [name, setName] = useState(initialName);
  const [language, setLanguage] = useState<LangKey>(
    isLangKey(initialLanguage) ? initialLanguage : "plaintext"
  );
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [pub, setPub] = useState(isPublic);
  const [showShare, setShowShare] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef(name);
  const langRef = useRef(language);
  const contentRef = useRef(initialContent);

  // Yjs 문서: 실시간 동시편집 상태. 스냅샷이 있으면 복원하고, 없으면(레거시
  // 파일 최초 오픈) 빈 채로 시작해 CodeMirror 쪽에서 initialContent 로 채운다.
  const ydocRef = useRef<Y.Doc | null>(null);
  if (!ydocRef.current) {
    const doc = new Y.Doc();
    if (initialYjsState) {
      try {
        Y.applyUpdate(doc, decodeYUpdate(initialYjsState));
      } catch {
        // 손상된 스냅샷은 무시 — 아래에서 ytext 가 비어 있으면 initialContent 로 채운다.
      }
    }
    const text = doc.getText("content");
    if (text.length === 0 && initialContent) {
      text.insert(0, initialContent);
    }
    ydocRef.current = doc;
  }
  const ydoc = ydocRef.current;
  const ytext = ydoc.getText("content");
  const isApplyingRemoteRef = useRef(false);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  useEffect(() => {
    langRef.current = language;
  }, [language]);
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Supabase Realtime Broadcast 로 다른 접속자와 Yjs 업데이트를 주고받는다.
  useEffect(() => {
    return connectYjsBroadcast(ydoc, `code:${fileId}`, isApplyingRemoteRef);
  }, [ydoc, fileId]);

  const persist = useCallback(async () => {
    setSaveState("saving");
    const yjsState = encodeYUpdate(Y.encodeStateAsUpdate(ydoc));
    const res = await saveCodeFile(
      fileId,
      nameRef.current,
      langRef.current,
      contentRef.current,
      yjsState
    );
    if (res.ok) setSaveState("saved");
    else {
      setSaveState("dirty");
      setError(res.error);
    }
  }, [fileId, ydoc]);

  const markDirty = useCallback(() => {
    if (!canEdit) return;
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(persist, AUTOSAVE_MS);
  }, [canEdit, persist]);

  const onContentChange = useCallback(
    (v: string) => {
      contentRef.current = v;
      if (!isApplyingRemoteRef.current) markDirty();
    },
    [markDirty]
  );

  const onName = (v: string) => {
    setName(v);
    renameTab("code", fileId, v.trim() || "untitled.txt");
    // 언어가 미지정(plaintext)일 때만 확장자로 자동 추정
    if (langRef.current === "plaintext") {
      const detected = detectLanguage(v);
      if (detected !== "plaintext") setLanguage(detected);
    }
    markDirty();
  };

  const onLanguage = (v: string) => {
    if (isLangKey(v)) {
      setLanguage(v);
      langRef.current = v;
      markDirty();
    }
  };

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

  const manualSave = () => {
    if (timer.current) clearTimeout(timer.current);
    persist();
  };

  const togglePublic = async () => {
    const next = !pub;
    setPub(next);
    const res = await setCodeFilePublic(fileId, next);
    if (!res.ok) {
      setPub(!next);
      setError(res.error);
    }
  };

  const afterDelete = () => {
    closeTab(tabId("code", fileId));
    router.push("/code");
    router.refresh();
  };

  // 로컬 파일로 내보내기 (브라우저 다운로드, 네트워크 불필요)
  const downloadCode = () => {
    const blob = new Blob([contentRef.current], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name.trim() || "untitled.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const stateLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "dirty"
      ? "Unsaved"
      : "Saved";

  return (
    <div className="code-shell">
      <div className="code-bar">
        <div className="code-bar-left">
          <input
            className="code-name"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Filename (e.g. app.py)"
            disabled={!canEdit}
            spellCheck={false}
          />
          <select
            className="code-lang"
            value={language}
            onChange={(e) => onLanguage(e.target.value)}
            disabled={!canEdit}
          >
            {LANGUAGES.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <PresenceAvatars users={presenceUsers} />
          <ContributorBadges kind="code" id={fileId} refreshToken={saveState} />
          <span
            className={`save-state ${
              saveState === "dirty"
                ? "dirty"
                : saveState === "saved"
                ? "saved"
                : ""
            }`}
          >
            ● {stateLabel}
          </span>
          <button className="btn btn-sm" onClick={downloadCode}>
            Download
          </button>
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

      <div className="code-scroll">
        <CodeMirror
          value={initialContent}
          language={language}
          editable={canEdit}
          onChange={onContentChange}
          ytext={ytext}
        />
      </div>

      {showShare && (
        <ShareDialog
          targetLabel={name || "untitled"}
          myShareId={myShareId}
          loadShares={() => listCodeFileShares(fileId)}
          onShare={(rid, perm) => shareCodeFile(fileId, rid, perm)}
          onRevoke={(pid) => revokeCodeFileShare(pid)}
          onClose={() => setShowShare(false)}
        />
      )}

      {showDelete && (
        <DeleteConfirmDialog
          itemKind="code file"
          itemLabel={name || "untitled"}
          onConfirm={() => deleteCodeFile(fileId)}
          onDeleted={afterDelete}
          onClose={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}
