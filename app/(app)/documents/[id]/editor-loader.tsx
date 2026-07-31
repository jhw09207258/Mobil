"use client";

import dynamic from "next/dynamic";
import type { Json, DocVisibility } from "@/lib/database.types";

// Tiptap 번들(약 97kB)을 초기 로드에서 분리해 지연 로딩한다(최적화).
const DocumentEditor = dynamic(
  () => import("./editor").then((m) => m.DocumentEditor),
  {
    ssr: false,
    loading: () => (
      <div className="empty" style={{ padding: 40 }}>
        Loading editor…
      </div>
    ),
  }
);

export function DocumentEditorLoader(props: {
  docId: string;
  initialTitle: string;
  initialContent: Json;
  initialYjsState: string | null;
  canEdit: boolean;
  isOwner: boolean;
  visibility: DocVisibility;
  myShareId: string;
  myName: string;
  myAvatarUrl: string | null;
}) {
  return <DocumentEditor {...props} />;
}
