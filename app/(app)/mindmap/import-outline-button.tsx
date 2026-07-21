"use client";

import { useRef, useState } from "react";
import { useWorkspace } from "../workspace/workspace-context";
import { parseMindmupOutlineHtml } from "@/lib/mindmup-import";
import { createMindMapFromOutline } from "./actions";

/** MindMup 의 "outline" HTML 내보내기를 읽어 새 마인드맵으로 만든다. 파싱에
 * 브라우저의 DOMParser 급 HTML 처리가 아니라 전용 태그 스트림 파서를 쓰므로
 * (lib/mindmup-import.ts 상단 설명 참고) 서버로 파일을 보내는 대신 여기서
 * 바로 파싱해 완성된 트리만 서버 액션에 넘긴다. */
export function ImportOutlineButton() {
  const { openTab } = useWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPending(true);
    try {
      const html = await file.text();
      const title = file.name.replace(/\.[^./\\]+$/, "") || "Imported map";
      const data = parseMindmupOutlineHtml(html, title);
      const res = await createMindMapFromOutline(title, data);
      if ("error" in res) setError(res.error);
      else openTab("mindmap", res.id, res.title, res.seed);
    } catch {
      setError("Could not read that file as a MindMup outline export.");
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
      <input ref={inputRef} type="file" accept=".html,.htm,text/html" hidden onChange={onChange} />
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onPick}
        disabled={pending}
        title="Import a MindMup 'Outline' HTML export"
      >
        {pending ? "Importing…" : "Import outline (.html)"}
      </button>
      {error && <div className="notice notice-error">{error}</div>}
    </div>
  );
}
