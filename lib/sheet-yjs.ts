import * as Y from "yjs";
import type { Sheet, CellWithRowAndCol } from "@fortune-sheet/core";

// ============================================================================
// 시트(스프레드시트) ↔ Yjs 공유 구조 변환 (셀 단위 실시간 병합).
// ----------------------------------------------------------------------------
// lib/mindmap-yjs.ts 와 동일한 전략을 그대로 따른다 — @fortune-sheet 에도
// 공식 Yjs 바인딩이 없으므로, Workbook 의 onChange 가 매번 돌려주는 전체
// Sheet[] 를 "평평한 구조"로 펼쳐 직전에 동기화한 상태와 비교(diff)해 실제로
// 바뀐 부분만 Yjs 에 쓴다. 어떤 조작이었는지는 몰라도 되고 결과만 알면 된다.
//
//   1. 시트별 메타(celldata 를 뺀 나머지 전부 — name/row/column/config/
//      freeze/필터/서식 등)는 시트 하나당 통째로 하나의 값으로 Y.Map 에 저장
//      한다(필드 단위 병합은 아님 — mind-elixir 의 "rest" 블롭과 동일한
//      트레이드오프, 두 사용자가 동시에 서로 다른 서식/병합을 적용하면 나중에
//      반영된 쪽이 이긴다).
//   2. 셀 값(celldata)은 "sheetId:r:c" 를 키로 하는 별도의 평평한 Y.Map 에
//      하나씩 저장한다 — 서로 다른 셀을 건드린 동시 편집은 Yjs 가 자동으로
//      합쳐준다(진짜 CRDT 병합 지점). 같은 셀을 동시에 고치면 그 셀 항목
//      단위로 last-writer-wins.
//   3. 시트 순서(및 존재 여부)는 별도의 Y.Array<string> 로 관리한다.
//   4. 원격 변경을 반영할 때는 세 구조를 모두 읽어 Sheet[] 로 재조립한다.
// ============================================================================

export type FlatSheets = {
  order: string[];
  /** sheetId -> celldata 를 뺀 나머지 Sheet 필드 전부(id 포함) */
  metas: Map<string, Record<string, unknown>>;
  /** "sheetId:r:c" -> 셀 값(v) */
  cells: Map<string, unknown>;
};

function cellKey(sheetId: string, r: number, c: number): string {
  return `${sheetId}:${r}:${c}`;
}

export function flattenSheets(sheets: Sheet[]): FlatSheets {
  const order: string[] = [];
  const metas = new Map<string, Record<string, unknown>>();
  const cells = new Map<string, unknown>();

  sheets.forEach((sheet, i) => {
    const id = sheet.id ?? `sheet-${i}`;
    order.push(id);
    const { celldata, ...meta } = sheet;
    metas.set(id, { ...meta, id });
    (celldata ?? []).forEach((cell) => {
      cells.set(cellKey(id, cell.r, cell.c), cell.v);
    });
  });

  return { order, metas, cells };
}

function shallowEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** prev(직전 동기화 상태) → next(지금 로컬 상태) 로 바뀐 부분만 Yjs 문서에
 * 반영한다 — mind-elixir 의 syncFlatToYMap 과 동일한 이유: 안 바뀐 항목까지
 * 매번 다시 쓰면 동시편집 중 상대방이 방금 쓴 값을 내가 덮어써버릴 수 있다. */
export function syncFlatToYDoc(ydoc: Y.Doc, prev: FlatSheets, next: FlatSheets): void {
  const yOrder = ydoc.getArray<string>("order");
  const yMetas = ydoc.getMap<Record<string, unknown>>("metas");
  const yCells = ydoc.getMap<unknown>("cells");

  ydoc.transact(() => {
    const orderChanged =
      prev.order.length !== next.order.length ||
      prev.order.some((id, i) => id !== next.order[i]);
    if (orderChanged) {
      yOrder.delete(0, yOrder.length);
      yOrder.push(next.order);
    }

    for (const [id, meta] of next.metas) {
      const before = prev.metas.get(id);
      if (!before || !shallowEqualJson(before, meta)) {
        yMetas.set(id, meta);
      }
    }
    for (const id of prev.metas.keys()) {
      if (!next.metas.has(id)) yMetas.delete(id);
    }

    for (const [key, v] of next.cells) {
      if (!prev.cells.has(key) || !shallowEqualJson(prev.cells.get(key), v)) {
        yCells.set(key, v);
      }
    }
    for (const key of prev.cells.keys()) {
      if (!next.cells.has(key)) yCells.delete(key);
    }
  });
}

export function readFlatFromYDoc(ydoc: Y.Doc): FlatSheets {
  const yOrder = ydoc.getArray<string>("order");
  const yMetas = ydoc.getMap<Record<string, unknown>>("metas");
  const yCells = ydoc.getMap<unknown>("cells");

  const metas = new Map<string, Record<string, unknown>>();
  yMetas.forEach((meta, id) => metas.set(id, meta));
  const cells = new Map<string, unknown>();
  yCells.forEach((v, key) => cells.set(key, v));

  return { order: yOrder.toArray(), metas, cells };
}

/** 평평한 구조를 다시 Sheet[] 로 재조립한다. */
export function reconstructSheets(flat: FlatSheets): Sheet[] {
  if (flat.order.length === 0) return [];

  const bySheet = new Map<string, CellWithRowAndCol[]>();
  for (const [key, v] of flat.cells) {
    const sep1 = key.indexOf(":");
    const sheetId = key.slice(0, sep1);
    const rest = key.slice(sep1 + 1);
    const sep2 = rest.indexOf(":");
    const r = Number(rest.slice(0, sep2));
    const c = Number(rest.slice(sep2 + 1));
    const list = bySheet.get(sheetId) ?? [];
    list.push({ r, c, v: v as CellWithRowAndCol["v"] });
    bySheet.set(sheetId, list);
  }

  return flat.order.map((id) => {
    const meta = (flat.metas.get(id) ?? { name: "Sheet" }) as Sheet;
    return { ...meta, id, celldata: bySheet.get(id) ?? [] };
  });
}
