"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modal";
import { IconClose } from "../icons";
import { listWorkspaceFiles, uploadAttachment, type WorkspaceFileRow } from "./attach-actions";
import { safeHttpUrl, type BbAttachment } from "@/lib/bb-attachments";

/**
 * 입력창의 + 버튼 — 어시스턴트에게 보낼 자료를 붙인다.
 *
 * 이미지와 PDF 는 모델이 원본 그대로 읽으므로 텍스트로 바꾸지 않는다.
 * 링크는 서버가 받아 본문만 추려 넣는다.
 */
export function AttachBar({
  attachments,
  onChange,
  disabled,
}: {
  attachments: BbAttachment[];
  onChange: (next: BbAttachment[]) => void;
  disabled?: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState<"workspace" | "link" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 바깥을 누르면 메뉴를 닫는다.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  const add = (a: BbAttachment) => {
    if (attachments.length >= 10) {
      setError("You can attach up to 10 items per message.");
      return;
    }
    onChange([...attachments, a]);
  };

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    for (const f of Array.from(list).slice(0, 10)) {
      const form = new FormData();
      form.set("file", f);
      const res = await uploadAttachment(form);
      if ("error" in res) {
        setError(`${f.name}: ${res.error}`);
        continue;
      }
      add({
        kind: res.mime.startsWith("image/") ? "image" : "document",
        name: res.name,
        path: res.path,
        mime: res.mime,
      });
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <>
      <div className="attach-wrap" ref={menuRef}>
        <button
          type="button"
          className="attach-plus"
          onClick={() => setMenu((v) => !v)}
          disabled={disabled || busy}
          aria-label="Attach"
          title="Attach an image, document, link, or workspace file"
        >
          {busy ? "…" : "+"}
        </button>
        {menu && (
          <div className="attach-menu">
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                fileRef.current?.click();
              }}
            >
              Image or document
              <span>PNG, JPEG, WebP, GIF, PDF — read directly by the model</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                setPicker("workspace");
              }}
            >
              Workspace file
              <span>Something you already uploaded</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                setPicker("link");
              }}
            >
              Link
              <span>The page is fetched and its text is included</span>
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/*,.md,.csv,.json"
        onChange={(e) => onFiles(e.target.files)}
      />

      {error && (
        <div className="notice notice-error" style={{ margin: "6px 0 0" }}>
          {error}
          <button className="btn btn-sm" style={{ marginLeft: 10 }} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {picker === "workspace" && (
        <WorkspacePicker
          onClose={() => setPicker(null)}
          onPick={(f) => {
            add({
              kind: "workspace_file",
              name: f.name,
              path: f.path,
              mime: f.mime ?? undefined,
            });
            setPicker(null);
          }}
        />
      )}
      {picker === "link" && (
        <LinkDialog
          onClose={() => setPicker(null)}
          onAdd={(url) => {
            add({ kind: "link", name: new URL(url).hostname, url });
            setPicker(null);
          }}
        />
      )}
    </>
  );
}

/** 붙인 항목 칩 — 보낼 내용에 무엇이 딸려 있는지 항상 보이게 한다. */
export function AttachChips({
  attachments,
  onRemove,
}: {
  attachments: BbAttachment[];
  onRemove: (index: number) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="attach-chips">
      {attachments.map((a, i) => (
        <span key={`${a.kind}:${a.name}:${i}`} className="attach-chip" title={a.url ?? a.name}>
          <span className="attach-kind">{KIND_LABEL[a.kind]}</span>
          <span className="attach-name">{a.name}</span>
          <button onClick={() => onRemove(i)} aria-label={`Remove ${a.name}`}>
            <IconClose size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}

const KIND_LABEL: Record<BbAttachment["kind"], string> = {
  image: "IMG",
  document: "DOC",
  link: "LINK",
  workspace_file: "FILE",
};

function WorkspacePicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (f: WorkspaceFileRow) => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<WorkspaceFileRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    listWorkspaceFiles(query).then(
      (r) => alive && setRows(r),
      () => alive && setRows([])
    );
    return () => {
      alive = false;
    };
  }, [query]);

  return (
    <Modal title="Attach a workspace file" onClose={onClose} width={520}>
      <input
        className="input"
        style={{ width: "100%" }}
        placeholder="Search your files…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="plugin-list">
        {rows === null ? (
          <div className="empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">Nothing matches.</div>
        ) : (
          rows.map((f) => (
            <button key={f.id} className="plugin-row" onClick={() => onPick(f)}>
              <span className="plugin-row-title">{f.name}</span>
              <span className="plugin-row-sub">{f.mime ?? ""}</span>
              <span className="plugin-row-action">Attach</span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}

function LinkDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const ok = !!safeHttpUrl(url);
  return (
    <Modal title="Attach a link" onClose={onClose} width={460}>
      <input
        className="input"
        style={{ width: "100%" }}
        placeholder="https://example.com/article"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        autoFocus
        onKeyDown={(e) => e.key === "Enter" && ok && onAdd(url.trim())}
      />
      <p className="page-sub" style={{ marginTop: 6, fontSize: 11.5 }}>
        The page is fetched on the server and its readable text is included with your message.
        Only http and https addresses are accepted.
      </p>
      <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
        <button className="btn btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" disabled={!ok} onClick={() => onAdd(url.trim())}>
          Attach
        </button>
      </div>
    </Modal>
  );
}
