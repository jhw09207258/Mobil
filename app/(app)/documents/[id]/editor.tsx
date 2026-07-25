"use client";

import "./editor.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import * as Y from "yjs";
import Collaboration from "@tiptap/extension-collaboration";
import { connectYjsBroadcast, encodeYUpdate, decodeYUpdate, seedDeterministically } from "@/lib/yjs-transport";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { ResizableImage } from "./resizable-image";
import { SlashCommand } from "./slash-command";
import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { ShareDialog } from "@/components/share-dialog";
import {
  saveDocument,
  deleteDocument,
  setDocumentPublic,
  shareDocument,
  revokeDocumentShare,
  listDocumentShares,
  exportDocument,
  type DocExportFormat,
} from "../actions";
import { downloadBase64File } from "@/lib/download-file";
import { useWorkspace, tabId, type TabKind } from "../../workspace/workspace-context";
import { WorkspaceLink } from "./workspace-link";
import { WorkspaceMention } from "./mention-command";
import { ContributorBadges } from "../../contributors/contributor-badges";
import { RepositoryPicker } from "../../repositories/repository-picker";
import { ActivityPanel } from "./activity-panel";
import { createMindmapFromDocument } from "../../convert-actions";
import { usePresence } from "@/lib/use-presence";
import { colorForUserId } from "@/lib/presence-color";
import { PresenceAvatars } from "@/components/presence-avatars";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";

type SaveState = "saved" | "dirty" | "saving";
const AUTOSAVE_MS = 1200;
const MEDIA_BUCKET = "media";
const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50MB

// 동영상 임베드용 커스텀 노드 (Tiptap 코어에 video 노드가 없어 직접 정의)
const Video = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null } };
  },
  parseHTML() {
    return [{ tag: "video[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "video",
      mergeAttributes(HTMLAttributes, { controls: "true", class: "doc-video" }),
    ];
  },
});

function isTiptapDoc(content: Json): boolean {
  return (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    (content as { type?: string }).type === "doc"
  );
}

export function DocumentEditor({
  docId,
  initialTitle,
  initialContent,
  initialYjsState,
  canEdit,
  isOwner,
  isPublic,
  myShareId,
  myName,
  myAvatarUrl,
}: {
  docId: string;
  initialTitle: string;
  initialContent: Json;
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
  const supabase = createClient();
  const [title, setTitle] = useState(initialTitle);
  const presenceUsers = usePresence(`doc:${docId}`, {
    id: myShareId,
    name: myName,
    avatarUrl: myAvatarUrl,
    color: colorForUserId(myShareId),
  });
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [pub, setPub] = useState(isPublic);
  const [showShare, setShowShare] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [converting, setConverting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Yjs 문서: 실시간 동시편집 상태. 스냅샷이 있으면 복원하고, 없으면(레거시
  // 문서 최초 오픈) 빈 채로 시작해 마운트 후 기존 Tiptap JSON 으로 부트스트랩한다.
  const ydocRef = useRef<Y.Doc | null>(null);
  if (!ydocRef.current) {
    const doc = new Y.Doc();
    if (initialYjsState) {
      try {
        Y.applyUpdate(doc, decodeYUpdate(initialYjsState));
      } catch {
        // 손상된 스냅샷은 무시 — 아래에서 빈 문서로 간주해 initialContent 로 채운다.
      }
    }
    ydocRef.current = doc;
  }
  const ydoc = ydocRef.current;
  const bootstrapped = useRef(false);
  const isApplyingRemoteRef = useRef(false);

  const onExport = async (format: DocExportFormat) => {
    setShowExport(false);
    setExporting(true);
    setError(null);
    const res = await exportDocument(docId, format);
    if ("error" in res) setError(res.error);
    else downloadBase64File(res.fileName, res.mimeType, res.base64);
    setExporting(false);
  };

  const editor = useEditor({
    editable: canEdit,
    immediatelyRender: false,
    extensions: [
      // Yjs 가 문서 상태(및 히스토리)를 대신 관리하므로 StarterKit 기본
      // history 는 끈다 — 같이 켜두면 undo 스택이 서로 꼬인다.
      StarterKit.configure({ history: false }),
      Collaboration.configure({ document: ydoc }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } }),
      ResizableImage.configure({ HTMLAttributes: { class: "doc-media" } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Video,
      Placeholder.configure({ placeholder: "Write your idea here… (type / for commands, @ to link an item)" }),
      SlashCommand,
      WorkspaceLink,
      WorkspaceMention,
    ],
    editorProps: {
      attributes: { class: "ProseMirror" },
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name !== "workspaceLink") return false;
        const { kind, refId, label } = node.attrs as { kind: string; refId: string; label: string };
        openTab(kind as TabKind, refId, label);
        return true;
      },
    },
    onUpdate: () => {
      if (canEdit && !isApplyingRemoteRef.current) markDirty();
    },
  });

  // Yjs 문서가 비어 있으면(기존 방식으로 저장된 레거시 문서를 이 기능이
  // 나온 뒤 처음 여는 경우) 기존 Tiptap JSON 콘텐츠로 한 번만 채워 넣는다.
  // seedDeterministically: 두 클라이언트가 스냅샷 없는 문서를 동시에 열어
  // 각자 시드하면 병합 시 본문이 통째로 복제되던 버그의 근본 시정 —
  // 고정 clientID 로 시드해 양쪽 시드가 같은 오퍼레이션으로 병합되게 한다.
  useEffect(() => {
    if (!editor || bootstrapped.current) return;
    bootstrapped.current = true;
    if (!initialYjsState && isTiptapDoc(initialContent)) {
      seedDeterministically(ydoc, () => {
        editor.commands.setContent(initialContent as object, false);
      });
    }
  }, [editor, initialContent, initialYjsState, ydoc]);

  // Supabase Realtime Broadcast 로 다른 접속자와 Yjs 업데이트를 주고받는다.
  useEffect(() => {
    return connectYjsBroadcast(ydoc, `doc:${docId}`, isApplyingRemoteRef);
  }, [ydoc, docId]);

  const persist = useCallback(
    async (nextTitle: string, ed: Editor | null) => {
      if (!ed) return;
      setSaveState("saving");
      const yjsState = encodeYUpdate(Y.encodeStateAsUpdate(ydoc));
      const res = await saveDocument(docId, nextTitle, ed.getJSON() as Json, yjsState);
      if (res.ok) setSaveState("saved");
      else {
        setSaveState("dirty");
        setError(res.error);
      }
    },
    [docId, ydoc]
  );

  const titleRef = useRef(title);
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const markDirty = useCallback(() => {
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      persist(titleRef.current, editorRef.current);
    }, AUTOSAVE_MS);
  }, [persist]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Cmd/Ctrl+S 로 즉시 저장
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!canEdit) return;
        if (timer.current) clearTimeout(timer.current);
        persist(titleRef.current, editorRef.current);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [canEdit, persist]);

  const manualSave = () => {
    if (timer.current) clearTimeout(timer.current);
    persist(title, editor);
  };

  const onConvertToMindmap = async () => {
    setConverting(true);
    setError(null);
    // 변환은 DB 에 저장된 콘텐츠를 읽으므로, 편집 권한이 있으면 먼저 강제 저장.
    if (canEdit) {
      if (timer.current) clearTimeout(timer.current);
      await persist(titleRef.current, editorRef.current);
    }
    const res = await createMindmapFromDocument(docId);
    setConverting(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    openTab("mindmap", res.id, res.title, res.seed);
  };

  const onTitle = (v: string) => {
    setTitle(v);
    // 제목을 바꾸면 열린 탭 이름도 즉시 갱신한다.
    renameTab("document", docId, v.trim() || "Untitled");
    if (canEdit) markDirty();
  };

  const togglePublic = async () => {
    const next = !pub;
    setPub(next);
    const res = await setDocumentPublic(docId, next);
    if (!res.ok) {
      setPub(!next);
      setError(res.error);
    }
  };

  // 삭제 완료 후: 열려 있던 탭을 닫고(워크스페이스 오버레이에 그대로 남는 것
  // 방지), 목록 라우트로 이동하면서 서버 컴포넌트 캐시를 무효화한다 — 이렇게
  // 해야 새로고침 없이도 목록에서 즉시 사라진다.
  const afterDelete = () => {
    closeTab(tabId("document", docId));
    router.push("/documents");
    router.refresh();
  };

  // 미디어(이미지/동영상) 업로드 → 공개 media 버킷 → URL 삽입
  const uploadMedia = useCallback(
    async (file: File, kind: "image" | "video") => {
      if (!editor) return;
      if (file.size > MAX_MEDIA_BYTES) {
        setError("File exceeds 50MB limit.");
        return;
      }
      setError(null);
      setUploadingMedia(true);
      try {
        const id = crypto.randomUUID();
        const safe = file.name.replace(/[^\w.\-() ]+/g, "_");
        const path = `${myShareId}/${id}/${safe}`;
        const { error: upErr } = await supabase.storage
          .from(MEDIA_BUCKET)
          .upload(path, file, { contentType: file.type || undefined });
        if (upErr) throw upErr;
        const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
        const url = data.publicUrl;
        if (kind === "image") {
          editor.chain().focus().setImage({ src: url }).run();
        } else {
          editor.chain().focus().insertContent({ type: "video", attrs: { src: url } }).run();
        }
      } catch {
        setError("Media upload failed.");
      } finally {
        setUploadingMedia(false);
      }
    },
    [editor, supabase, myShareId]
  );

  const stateLabel =
    saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved" : "Saved";

  return (
    <div className="editor-shell">
      <div className="editor-bar">
        <input
          className="editor-title"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="Untitled"
          disabled={!canEdit}
        />
        <div className="row hscroll" style={{ gap: 10 }}>
          <PresenceAvatars users={presenceUsers} />
          <RepositoryPicker kind="document" itemId={docId} canEdit={canEdit} />
          <ContributorBadges kind="document" id={docId} refreshToken={saveState} />
          <span
            className={`save-state ${
              saveState === "dirty" ? "dirty" : saveState === "saved" ? "saved" : ""
            }`}
          >
            ● {uploadingMedia ? "Uploading…" : stateLabel}
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
            title="Create a new mind map from this document's headings"
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
                <button className="acct-item" onClick={() => onExport("txt")}>Plain text (.txt)</button>
                <button className="acct-item" onClick={() => onExport("docx")}>Word (.docx)</button>
                <button className="acct-item" onClick={() => onExport("pdf")}>PDF (.pdf)</button>
                <button className="acct-item" onClick={() => onExport("hwpx")}>한글 (.hwpx)</button>
              </div>
            )}
          </div>
          <button
            className={`btn btn-sm ${showActivity ? "chat-tool-active" : ""}`}
            onClick={() => setShowActivity((v) => !v)}
            title="Show edit activity (who changed what, when)"
          >
            Activity
          </button>
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

      {canEdit && editor && (
        <Toolbar editor={editor} onUploadMedia={uploadMedia} />
      )}

      {error && (
        <div style={{ padding: "10px 24px 0" }}>
          <div className="notice notice-error" style={{ margin: 0 }}>
            {error}
          </div>
        </div>
      )}

      <div className="editor-main">
        <div className="editor-scroll">
          <div className="editor-doc">
            <EditorContent editor={editor} />
          </div>
        </div>
        <ActivityPanel
          docId={docId}
          open={showActivity}
          onClose={() => setShowActivity(false)}
          refreshToken={saveState}
        />
      </div>

      {showShare && (
        <ShareDialog
          targetLabel={title || "Untitled"}
          myShareId={myShareId}
          loadShares={() => listDocumentShares(docId)}
          onShare={(rid, perm) => shareDocument(docId, rid, perm)}
          onRevoke={(pid) => revokeDocumentShare(pid)}
          onClose={() => setShowShare(false)}
        />
      )}

      {showDelete && (
        <DeleteConfirmDialog
          itemKind="document"
          itemLabel={title || "Untitled"}
          onConfirm={() => deleteDocument(docId)}
          onDeleted={afterDelete}
          onClose={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}

// 툴바 라인 아이콘 — 이모지(🔗🖼🎬 등)는 OS/브라우저마다 색이 제각각이라
// 무채색 다크 테마와 어울리지 않는다. 사이드바 아이콘(app/(app)/icons.tsx)과
// 같은 스타일(currentColor 스트로크, 24x24 뷰박스)로 맞춘다.
const iconProps = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
function IconLink() {
  return (
    <svg {...iconProps}>
      <path d="M9 15l6-6" />
      <path d="M10.5 6.5l1-1a4 4 0 1 1 5.7 5.7l-1.7 1.7" />
      <path d="M13.5 17.5l-1 1a4 4 0 1 1-5.7-5.7l1.7-1.7" />
    </svg>
  );
}
function IconImage() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <circle cx="8.5" cy="9.5" r="1.75" />
      <path d="M21 16l-5.5-5.5a1.5 1.5 0 0 0-2.12 0L4 19" />
    </svg>
  );
}
function IconVideo() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="5" width="14" height="14" rx="1.5" />
      <path d="M17 10l4-2.5v9L17 14" />
    </svg>
  );
}
function IconEraser() {
  return (
    <svg {...iconProps}>
      <path d="M18 13.5L10.5 21H6l-3-3 10-10 6 6z" />
      <path d="M9.5 5.5l9 9" />
      <path d="M6 21h14" />
    </svg>
  );
}

function Toolbar({
  editor,
  onUploadMedia,
}: {
  editor: Editor;
  onUploadMedia: (file: File, kind: "image" | "video") => void;
}) {
  const imgRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);
  const btn = (active: boolean, extra = "") => `tool ${extra} ${active ? "on" : ""}`;

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="toolbar">
      {/* Undo/Redo — Yjs Collaboration 의 undo manager 를 사용(Cmd/Ctrl+Z,
          Shift+Cmd/Ctrl+Z 단축키는 Collaboration 확장이 이미 바인딩). */}
      <button className={btn(false)} onClick={() => editor.chain().focus().undo().run()} title="Undo (⌘Z)">↩</button>
      <button className={btn(false)} onClick={() => editor.chain().focus().redo().run()} title="Redo (⇧⌘Z)">↪</button>
      <span className="tool-sep" />
      <button className={btn(editor.isActive("heading", { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">H1</button>
      <button className={btn(editor.isActive("heading", { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">H2</button>
      <button className={btn(editor.isActive("heading", { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">H3</button>
      <span className="tool-sep" />
      <button className={btn(editor.isActive("bold"), "strong")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">B</button>
      <button className={btn(editor.isActive("italic"), "em")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">I</button>
      <button className={btn(editor.isActive("underline"))} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline" style={{ textDecoration: "underline" }}>U</button>
      <button className={btn(editor.isActive("strike"))} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough" style={{ textDecoration: "line-through" }}>S</button>
      <button className={btn(editor.isActive("code"))} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code">{"</>"}</button>

      {/* text color */}
      <label className="tool-color" title="Text color">
        A
        <span className="tool-swatch" style={{ background: (editor.getAttributes("textStyle").color as string) || "var(--text-1)" }} />
        <input type="color" onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} />
      </label>
      {/* highlight color */}
      <label className="tool-color" title="Highlight">
        ✎
        <span className="tool-swatch" style={{ background: (editor.getAttributes("highlight").color as string) || "var(--warn)" }} />
        <input type="color" defaultValue="#c9922e" onChange={(e) => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()} />
      </label>
      <button className="tool" onClick={() => editor.chain().focus().unsetColor().unsetHighlight().run()} title="Clear color/highlight"><IconEraser /></button>

      <span className="tool-sep" />
      <button className={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">•</button>
      <button className={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">1.</button>
      <button className={btn(editor.isActive("taskList"))} onClick={() => editor.chain().focus().toggleTaskList().run()} title="Checklist">☑</button>
      <button className={btn(editor.isActive("blockquote"))} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">❝</button>
      <button className={btn(editor.isActive("codeBlock"))} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code block">{"{ }"}</button>

      <span className="tool-sep" />
      <button className={btn(editor.isActive("link"))} onClick={setLink} title="Link"><IconLink /></button>
      <button className="tool" onClick={() => imgRef.current?.click()} title="Insert image"><IconImage /></button>
      <button className="tool" onClick={() => vidRef.current?.click()} title="Insert video"><IconVideo /></button>
      <button className="tool" onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider">―</button>

      <input ref={imgRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadMedia(f, "image"); e.target.value = ""; }} />
      <input ref={vidRef} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadMedia(f, "video"); e.target.value = ""; }} />
    </div>
  );
}
