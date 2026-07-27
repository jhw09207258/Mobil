"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modal";
import { formatBytes } from "@/lib/format";

/**
 * 파일을 내려받지 않고 그 자리에서 본다.
 *
 * 클라우드 저장소가 편한 이유의 절반은 "열어 보기 전에 무엇인지 알 수 있다"는
 * 데 있다. 지금까지 Possion 의 파일은 이름과 크기만 보이고, 확인하려면 반드시
 * 다운로드해야 했다 — 확인 한 번에 내려받기 한 번.
 *
 * PDF 만 blob 으로 받아서 띄우는 이유: CSP 의 frame-src 가 'self' 와 blob: 만
 * 허용한다(lib/security-headers.ts). Storage 도메인을 프레임에 직접 걸면
 * 막히므로, 내용을 받아 blob URL 로 바꿔 넣는다. 이미지·영상·오디오는 각각
 * img-src/media-src 가 Storage 도메인을 허용하므로 서명 URL 을 그대로 쓴다.
 */

export type PreviewTarget = {
  id: string;
  name: string;
  mime: string | null;
  size?: number | null;
};

type Loaded =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; url: string; mime: string | null; name: string; size: number | null };

/** 미리보기 방식 결정 — MIME 이 비어 있는 경우가 흔해 확장자도 함께 본다. */
export function previewMode(
  name: string,
  mime: string | null | undefined
): "image" | "video" | "audio" | "pdf" | "text" | "none" {
  const m = (mime ?? "").toLowerCase();
  const ext = name.toLowerCase().split(".").pop() ?? "";

  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"].includes(ext)) {
    return "image";
  }
  if (m.startsWith("video/") || ["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (m.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio";
  if (m === "application/pdf" || ext === "pdf") return "pdf";

  const textExt = [
    "txt", "md", "markdown", "csv", "tsv", "json", "log", "yml", "yaml", "xml", "html", "css",
    "js", "jsx", "ts", "tsx", "py", "rs", "go", "java", "c", "h", "cpp", "sql", "sh", "toml", "ini", "env",
  ];
  if (m.startsWith("text/") || m === "application/json" || textExt.includes(ext)) return "text";

  return "none";
}

/** 텍스트 미리보기로 받아올 최대 바이트 — 큰 로그를 통째로 메모리에 올리지 않는다. */
const MAX_TEXT_BYTES = 512 * 1024;
/** blob 으로 받아 띄우는 PDF 의 상한. 이보다 크면 다운로드를 권한다. */
const MAX_PDF_BYTES = 25 * 1024 * 1024;

export function FilePreview({
  target,
  loadUrl,
  onDownload,
  onClose,
}: {
  target: PreviewTarget;
  /** 서명 URL 발급(서버 액션). */
  loadUrl: (
    fileId: string
  ) => Promise<{ url: string; mime: string | null; name: string; size: number | null } | { error: string }>;
  onDownload?: () => void;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [text, setText] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  // 언마운트 후 setState 를 막는다 — 미리보기는 사용자가 곧바로 닫는 일이 잦다.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const mode = previewMode(
    loaded.state === "ready" ? loaded.name : target.name,
    loaded.state === "ready" ? loaded.mime : target.mime
  );

  useEffect(() => {
    let cancelled = false;
    setLoaded({ state: "loading" });
    setText(null);

    loadUrl(target.id).then(
      (res) => {
        if (cancelled || !alive.current) return;
        if ("error" in res) setLoaded({ state: "error", message: res.error });
        else setLoaded({ state: "ready", ...res });
      },
      () => {
        if (!cancelled && alive.current) {
          setLoaded({ state: "error", message: "Could not open this file." });
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [target.id, loadUrl]);

  // 텍스트/PDF 는 내용을 직접 받아 온다.
  useEffect(() => {
    if (loaded.state !== "ready") return;
    const kind = previewMode(loaded.name, loaded.mime);
    if (kind !== "text" && kind !== "pdf") return;
    if (kind === "pdf" && (loaded.size ?? 0) > MAX_PDF_BYTES) return;

    let cancelled = false;
    let objectUrl: string | null = null;

    fetch(loaded.url)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        if (kind === "text") {
          const body = await res.blob();
          const slice = body.slice(0, MAX_TEXT_BYTES);
          const content = await slice.text();
          if (!cancelled && alive.current) {
            setText(body.size > MAX_TEXT_BYTES ? `${content}\n\n… (truncated preview)` : content);
          }
        } else {
          const body = await res.blob();
          // Storage 가 application/octet-stream 으로 돌려주면 브라우저가 PDF 로
          // 렌더하지 않는다 — 타입을 명시해 다시 감싼다.
          objectUrl = URL.createObjectURL(new Blob([body], { type: "application/pdf" }));
          if (!cancelled && alive.current) setBlobUrl(objectUrl);
          else if (objectUrl) URL.revokeObjectURL(objectUrl);
        }
      })
      .catch(() => {
        if (!cancelled && alive.current) setText(null);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBlobUrl(null);
    };
  }, [loaded]);

  const title = loaded.state === "ready" ? loaded.name : target.name;
  const size = loaded.state === "ready" ? loaded.size : target.size;

  const body = useCallback(() => {
    if (loaded.state === "loading") return <div className="empty">Opening…</div>;
    if (loaded.state === "error") return <div className="notice notice-error">{loaded.message}</div>;

    if (mode === "image") {
      // eslint-disable-next-line @next/next/no-img-element
      return <img className="fp-image" src={loaded.url} alt={loaded.name} />;
    }
    if (mode === "video") {
      return <video className="fp-media" src={loaded.url} controls playsInline />;
    }
    if (mode === "audio") {
      return <audio className="fp-audio" src={loaded.url} controls />;
    }
    if (mode === "pdf") {
      if ((loaded.size ?? 0) > MAX_PDF_BYTES) {
        return (
          <div className="empty">
            This PDF is larger than {formatBytes(MAX_PDF_BYTES)} — download it to read.
          </div>
        );
      }
      return blobUrl ? (
        <iframe className="fp-frame" src={blobUrl} title={loaded.name} />
      ) : (
        <div className="empty">Rendering…</div>
      );
    }
    if (mode === "text") {
      return text === null ? (
        <div className="empty">Reading…</div>
      ) : (
        <pre className="fp-text">{text}</pre>
      );
    }
    return (
      <div className="empty">
        No preview for this file type. Download it to open in the right app.
      </div>
    );
  }, [loaded, mode, text, blobUrl]);

  return (
    <Modal title={title} onClose={onClose} width={860}>
      <div className="fp-meta">
        <span className="badge">{target.mime || "unknown type"}</span>
        {size != null && <span className="mono muted">{formatBytes(size)}</span>}
        <span style={{ flex: 1 }} />
        {loaded.state === "ready" && (
          <a className="btn btn-sm" href={loaded.url} target="_blank" rel="noopener noreferrer">
            Open in new tab
          </a>
        )}
        {onDownload && (
          <button className="btn btn-primary btn-sm" onClick={onDownload}>
            Download
          </button>
        )}
      </div>
      <div className="fp-body">{body()}</div>
      <style>{previewCss}</style>
    </Modal>
  );
}

const previewCss = `
.fp-meta {
  display: flex; align-items: center; gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.fp-body {
  min-height: 200px;
  max-height: min(68vh, 720px);
  overflow: auto;
  border: 1px solid var(--border-1);
  border-radius: var(--radius);
  background: var(--bg-1);
  display: flex; align-items: center; justify-content: center;
  padding: 8px;
}
.fp-image { max-width: 100%; max-height: 64vh; object-fit: contain; border-radius: 6px; }
.fp-media { max-width: 100%; max-height: 64vh; border-radius: 6px; }
.fp-audio { width: 100%; }
.fp-frame { width: 100%; height: 64vh; border: 0; background: #fff; border-radius: 6px; }
.fp-text {
  width: 100%; margin: 0; padding: 12px;
  align-self: flex-start;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12.5px; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word;
  color: var(--text-1);
}
@media (max-width: 640px) {
  .fp-body { max-height: 58vh; }
  .fp-frame { height: 58vh; }
}
`;
