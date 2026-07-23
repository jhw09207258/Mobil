"use client";

import dynamic from "next/dynamic";
import type { Json } from "@/lib/database.types";

// @fortune-sheet 는 브라우저 전용(캔버스 렌더링) → ssr:false 로 지연 로딩.
const Spreadsheet = dynamic(
  () => import("./spreadsheet").then((m) => m.Spreadsheet),
  {
    ssr: false,
    loading: () => (
      <div className="empty" style={{ padding: 40 }}>
        Loading spreadsheet…
      </div>
    ),
  }
);

export function SpreadsheetLoader(props: {
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
  return <Spreadsheet {...props} />;
}
