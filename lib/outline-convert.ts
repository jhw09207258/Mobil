import type { MindElixirData, NodeObj } from "mind-elixir";

// ============================================================================
// 마인드맵 트리 ↔ 문서 목차(Outline) ↔ 시트의 계층형 행 — 상호 변환.
// 순수 함수만 두고(프레임워크 의존 없음) 서버 액션에서 데이터베이스 insert 와
// 엮는다.
// ============================================================================

type TiptapTextNode = { type: "text"; text: string };
type TiptapBlock = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapTextNode[];
};
type TiptapDoc = { type: "doc"; content: TiptapBlock[] };

const MAX_HEADING_LEVEL = 6;

// ---------------------------------------------------------------------------
// 마인드맵 → 문서: 트리 depth 를 헤딩 레벨로(0→H1, 1→H2, ... 5+→H6),
// 노트 텍스트는 바로 아래 문단으로.
// ---------------------------------------------------------------------------
export function mindmapToDocumentJSON(nodeData: NodeObj): TiptapDoc {
  const content: TiptapBlock[] = [];

  const walk = (node: NodeObj, depth: number) => {
    const level = Math.min(depth + 1, MAX_HEADING_LEVEL);
    content.push({
      type: "heading",
      attrs: { level },
      content: node.topic ? [{ type: "text", text: node.topic }] : [],
    });
    if (node.note) {
      content.push({ type: "paragraph", content: [{ type: "text", text: node.note }] });
    }
    for (const child of node.children ?? []) walk(child, depth + 1);
  };

  walk(nodeData, 0);
  return { type: "doc", content };
}

// ---------------------------------------------------------------------------
// 문서 → 마인드맵: 헤딩을 레벨대로 중첩시키고, 헤딩 사이의 일반 문단은
// 가장 가까운 헤딩의 note 자식으로 붙인다.
// ---------------------------------------------------------------------------
type LooseTiptapNode = {
  type?: string;
  attrs?: { level?: number };
  content?: LooseTiptapNode[];
  text?: string;
};

function extractPlainText(node: LooseTiptapNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(extractPlainText).join("");
}

export function documentJSONToMindmapData(
  doc: LooseTiptapNode,
  fallbackTitle: string
): MindElixirData {
  const root: NodeObj = { id: "root", topic: fallbackTitle || "Untitled map" };
  const stack: { level: number; node: NodeObj }[] = [{ level: 0, node: root }];
  let idCounter = 0;
  const nextId = () => `n${idCounter++}`;

  for (const block of doc.content ?? []) {
    if (block.type === "heading") {
      const level = Math.max(1, Math.min(block.attrs?.level ?? 1, MAX_HEADING_LEVEL));
      const topic = extractPlainText(block).trim() || "Untitled";
      const node: NodeObj = { id: nextId(), topic };
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1].node;
      (parent.children ??= []).push(node);
      stack.push({ level, node });
    } else {
      const text = extractPlainText(block).trim();
      if (!text) continue;
      const parent = stack[stack.length - 1].node;
      (parent.children ??= []).push({ id: nextId(), topic: text, metadata: { kind: "note" } });
    }
  }

  return { nodeData: root };
}

// ---------------------------------------------------------------------------
// 마인드맵 → 시트: A열 = 깊이(0부터), B열 = 토픽. 1행은 헤더("Level"/"Topic").
// fortune-sheet 의 CellWithRowAndCol({r,c,v:{v,m}}) 형태.
// ---------------------------------------------------------------------------
export type SheetCell = { r: number; c: number; v: { v: string | number; m: string } };

/** 마인드맵 → 문서/시트 변환 시 유실될 참조 노드(파일/코드/문서 링크) 개수.
 * mindmapToDocumentJSON/mindmapToSheetRows 는 topic 텍스트만 옮기고
 * metadata.kind/refId 는 옮기지 않으므로, 변환 전에 사용자에게 몇 개가
 * 평범한 텍스트로 바뀌는지 미리 알려주는 용도로 쓴다. */
export function countReferenceNodes(nodeData: NodeObj): number {
  let count = 0;
  const walk = (node: NodeObj) => {
    const kind = (node.metadata as { kind?: string } | undefined)?.kind;
    if (kind && kind !== "note") count++;
    for (const child of node.children ?? []) walk(child);
  };
  walk(nodeData);
  return count;
}

export function mindmapToSheetRows(nodeData: NodeObj): SheetCell[] {
  const rows: SheetCell[] = [
    { r: 0, c: 0, v: { v: "Level", m: "Level" } },
    { r: 0, c: 1, v: { v: "Topic", m: "Topic" } },
  ];
  let r = 1;

  const walk = (node: NodeObj, depth: number) => {
    rows.push({ r, c: 0, v: { v: depth, m: String(depth) } });
    rows.push({ r, c: 1, v: { v: node.topic, m: node.topic } });
    r++;
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  walk(nodeData, 0);

  return rows;
}

// ---------------------------------------------------------------------------
// 시트 → 마인드맵: A열의 숫자를 깊이로, B열을 토픽으로 읽어 들여쓰기
// 트리를 복원한다. 표준 "레벨 스택" 알고리즘(들여쓰기 텍스트 파싱과 동일).
// ---------------------------------------------------------------------------
export function sheetRowsToMindmapData(
  celldata: { r: number; c: number; v?: { v?: unknown; m?: unknown } | null }[],
  fallbackTitle: string
): MindElixirData | { error: string } {
  const byCell = new Map<string, unknown>();
  const rowIndices = new Set<number>();
  for (const cell of celldata) {
    rowIndices.add(cell.r);
    if (!cell.v) continue;
    const val = cell.v.v ?? cell.v.m;
    if (val !== undefined && val !== null && val !== "") {
      byCell.set(`${cell.r}:${cell.c}`, val);
    }
  }
  const sortedRows = [...rowIndices].sort((a, b) => a - b);

  let startIdx = 0;
  const firstRow = sortedRows[0];
  if (firstRow !== undefined) {
    const a = String(byCell.get(`${firstRow}:0`) ?? "").trim().toLowerCase();
    if (a === "level") startIdx = 1;
  }

  const root: NodeObj = { id: "root", topic: fallbackTitle || "Untitled map" };
  const stack: { depth: number; node: NodeObj }[] = [{ depth: -1, node: root }];
  let idCounter = 0;
  let sawAnyRow = false;

  for (let i = startIdx; i < sortedRows.length; i++) {
    const r = sortedRows[i];
    const topic = String(byCell.get(`${r}:1`) ?? "").trim();
    if (!topic) continue;

    const levelRaw = byCell.get(`${r}:0`);
    const depth = Number(levelRaw);
    if (!Number.isFinite(depth) || depth < 0) {
      return { error: `Row ${r + 1}: the "Level" column must be a non-negative number.` };
    }

    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1].node;
    const node: NodeObj = { id: `n${idCounter++}`, topic };
    (parent.children ??= []).push(node);
    stack.push({ depth, node });
    sawAnyRow = true;
  }

  if (!sawAnyRow) {
    return { error: "No rows found — add a Level (number) and Topic column." };
  }

  return { nodeData: root };
}
