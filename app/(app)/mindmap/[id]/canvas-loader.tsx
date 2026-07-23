"use client";

import dynamic from "next/dynamic";
import type { Json } from "@/lib/database.types";
import type { WorkspaceItem } from "../actions";

// Mind Elixir 는 브라우저 전용(DOM 직접 조작) → ssr:false 로 지연 로딩.
const MindMapCanvas = dynamic(
  () => import("./canvas").then((m) => m.MindMapCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="empty" style={{ padding: 40 }}>
        Loading canvas…
      </div>
    ),
  }
);

export function MindMapCanvasLoader(props: {
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
  return <MindMapCanvas {...props} />;
}
