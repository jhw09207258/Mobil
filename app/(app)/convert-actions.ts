"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractTagsFromText, extractTiptapPlainText } from "@/lib/tags";
import {
  mindmapToDocumentJSON,
  documentJSONToMindmapData,
  mindmapToSheetRows,
  sheetRowsToMindmapData,
  type SheetCell,
} from "@/lib/outline-convert";
import type { Json } from "@/lib/database.types";
import { parseInitialData } from "@/lib/mindmap-legacy";

type TabResult = { id: string; title: string; seed: unknown } | { error: string };

/** 마인드맵 → 새 문서(목차). 트리 depth 를 헤딩 레벨로 변환한다. */
export async function createDocumentFromMindmap(mapId: string): Promise<TabResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication required." };

  const { data: map } = await supabase
    .from("mind_maps")
    .select("id, title, data")
    .eq("id", mapId)
    .single();
  if (!map) return { error: "Map not found." };

  // 아직 레거시(React Flow 시절) {nodes,edges} 형식 그대로 저장된 맵도
  // 정규화해서 변환한다 — 캔버스는 parseInitialData 로 이 형식을 이미 정상
  // 렌더링하므로, 소유자가 한 번도 재저장하지 않았다는 이유만으로 view-only
  // 사용자의 변환을 막을 이유가 없다.
  const normalized = parseInitialData(map.data, map.title);
  const content = mindmapToDocumentJSON(normalized.nodeData);
  const title = `${map.title} (Outline)`;

  const { data, error } = await supabase
    .from("documents")
    .insert({ owner_id: user.id, title, content: content as unknown as Json })
    .select("id, title, content")
    .single();
  if (error || !data) return { error: "Failed to create document." };

  after(async () => {
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      target_type: "document",
      target_id: data.id,
      action: "create",
    });
    const tags = extractTagsFromText(`${data.title} ${extractTiptapPlainText(data.content)}`);
    await supabase.rpc("sync_object_tags", {
      p_kind: "document",
      p_id: data.id,
      p_tag_names: tags,
    });
  });

  return {
    id: data.id,
    title: data.title,
    seed: {
      id: data.id,
      title: data.title,
      content: data.content,
      initialYjsState: null,
      isPublic: false,
      canEdit: true,
      isOwner: true,
      myShareId: user.id,
    },
  };
}

/** 마인드맵 → 새 시트(계층형 행). A열=깊이, B열=토픽. */
export async function createSheetFromMindmap(mapId: string): Promise<TabResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication required." };

  const { data: map } = await supabase
    .from("mind_maps")
    .select("id, title, data")
    .eq("id", mapId)
    .single();
  if (!map) return { error: "Map not found." };

  const normalized = parseInitialData(map.data, map.title);
  const cells = mindmapToSheetRows(normalized.nodeData);
  const sheetData = [
    {
      name: "Sheet1",
      id: "sheet-01",
      celldata: cells,
      row: Math.max(100, cells.length + 10),
      column: 30,
      status: 1,
    },
  ];
  const title = `${map.title} (Rows)`;

  const { data, error } = await supabase
    .from("sheets")
    .insert({ owner_id: user.id, title, data: sheetData as unknown as Json })
    .select("id, title, data")
    .single();
  if (error || !data) return { error: "Failed to create sheet." };

  after(async () => {
    const tags = extractTagsFromText(data.title);
    await supabase.rpc("sync_object_tags", {
      p_kind: "sheet",
      p_id: data.id,
      p_tag_names: tags,
    });
  });

  return {
    id: data.id,
    title: data.title,
    seed: {
      id: data.id,
      title: data.title,
      data: data.data,
      isPublic: false,
      canEdit: true,
      isOwner: true,
      myShareId: user.id,
    },
  };
}

/** 문서 → 새 마인드맵. 헤딩 depth 로 트리를 만든다(문단은 note 자식으로). */
export async function createMindmapFromDocument(docId: string): Promise<TabResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication required." };

  const { data: doc } = await supabase
    .from("documents")
    .select("id, title, content")
    .eq("id", docId)
    .single();
  if (!doc) return { error: "Document not found." };

  const content = doc.content as { type?: string; content?: unknown[] } | null;
  if (!content || content.type !== "doc" || !Array.isArray(content.content) || content.content.length === 0) {
    return { error: "This document has no content to convert yet." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mindmapData = documentJSONToMindmapData(content as any, doc.title);
  const title = `${doc.title} (Map)`;

  const { data, error } = await supabase
    .from("mind_maps")
    .insert({ owner_id: user.id, title, data: mindmapData as unknown as Json })
    .select("id, title, data")
    .single();
  if (error || !data) return { error: "Failed to create map." };

  const items = await listWorkspaceItemsForConvert(supabase);

  return {
    id: data.id,
    title: data.title,
    seed: {
      id: data.id,
      title: data.title,
      data: data.data,
      initialYjsState: null,
      isPublic: false,
      canEdit: true,
      isOwner: true,
      myShareId: user.id,
      items,
    },
  };
}

/** 시트 → 새 마인드맵. A열(깊이 숫자)/B열(토픽) 규칙으로 첫 번째 시트를 읽는다. */
export async function createMindmapFromSheet(sheetId: string): Promise<TabResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication required." };

  const { data: sheet } = await supabase
    .from("sheets")
    .select("id, title, data")
    .eq("id", sheetId)
    .single();
  if (!sheet) return { error: "Sheet not found." };

  const sheets = sheet.data as { celldata?: SheetCell[] }[] | null;
  const celldata = sheets?.[0]?.celldata;
  if (!Array.isArray(celldata) || celldata.length === 0) {
    return { error: "This sheet has no data to convert yet." };
  }

  const result = sheetRowsToMindmapData(celldata, sheet.title);
  if ("error" in result) return result;

  const title = `${sheet.title} (Map)`;
  const { data, error } = await supabase
    .from("mind_maps")
    .insert({ owner_id: user.id, title, data: result as unknown as Json })
    .select("id, title, data")
    .single();
  if (error || !data) return { error: "Failed to create map." };

  const items = await listWorkspaceItemsForConvert(supabase);

  return {
    id: data.id,
    title: data.title,
    seed: {
      id: data.id,
      title: data.title,
      data: data.data,
      initialYjsState: null,
      isPublic: false,
      canEdit: true,
      isOwner: true,
      myShareId: user.id,
      items,
    },
  };
}

/** mindmap/actions.ts 의 listWorkspaceItems 와 동일한 조회를 여기서도 필요로 해서
 * (참조 노드 선택기용) 별도로 복제 — 순환 import 를 피하기 위함. */
async function listWorkspaceItemsForConvert(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ id: string; label: string; kind: "file" | "code" | "document" }[]> {
  const [files, code, docs] = await Promise.all([
    supabase.from("files").select("id, file_name").order("created_at", { ascending: false }).limit(200),
    supabase.from("code_files").select("id, name").order("updated_at", { ascending: false }).limit(200),
    supabase.from("documents").select("id, title").order("updated_at", { ascending: false }).limit(200),
  ]);
  const out: { id: string; label: string; kind: "file" | "code" | "document" }[] = [];
  for (const f of files.data ?? []) out.push({ id: f.id, label: f.file_name, kind: "file" });
  for (const c of code.data ?? []) out.push({ id: c.id, label: c.name, kind: "code" });
  for (const d of docs.data ?? []) out.push({ id: d.id, label: d.title || "Untitled", kind: "document" });
  return out;
}
