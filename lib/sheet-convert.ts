import type { Json } from "@/lib/database.types";

// @fortune-sheet/core 의 Sheet/Cell 타입을 그대로 가져오면 서버 액션에서도
// 클라이언트 전용 번들 경로를 끌고 올 위험이 있어, 여기서는 필요한 형태만
// 최소 구조로 정의한다(구조적으로 호환).
type CellData = { r: number; c: number; v: { v?: string | number | boolean; m?: string } | null };
type SheetLike = {
  name: string;
  id: string;
  celldata: CellData[];
  row: number;
  column: number;
  status: number;
};

const MAX_ROWS = 2000;
const MAX_COLS = 200;

// ExcelJS cell.value 는 수식/리치텍스트/하이퍼링크/오류/Date 등 원시값이 아닌
// 형태로 오는 경우가 많다. 이를 무시하고 String(v) 로 바로 변환하면 모두
// "[object Object]" 가 되어 셀 내용이 깨진다 — 각 형태에서 실제 표시값을 뽑는다.
function excelCellToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v !== "object") return String(v);
  const obj = v as Record<string, unknown>;
  if (Array.isArray(obj.richText)) {
    return (obj.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
  }
  if ("formula" in obj) return excelCellToString(obj.result);
  if ("error" in obj) return String(obj.error ?? "");
  if ("text" in obj) return excelCellToString(obj.text); // hyperlink cell
  return String(v);
}

function sheetFromRows(name: string, id: string, rows: string[][], active: boolean): SheetLike {
  const celldata: CellData[] = [];
  let maxCol = 0;
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell === "" || cell == null) return;
      maxCol = Math.max(maxCol, c + 1);
      const num = Number(cell);
      const isNumeric = cell.trim() !== "" && !Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(cell.trim());
      celldata.push({ r, c, v: isNumeric ? { v: num, m: cell } : { v: cell, m: cell } });
    });
  });
  return {
    name,
    id,
    celldata,
    row: Math.max(rows.length + 20, 100),
    column: Math.max(maxCol + 10, 30),
    status: active ? 1 : 0,
  };
}

function rowsFromSheet(sheet: SheetLike): string[][] {
  let maxR = 0;
  let maxC = 0;
  for (const cell of sheet.celldata ?? []) {
    maxR = Math.max(maxR, cell.r);
    maxC = Math.max(maxC, cell.c);
  }
  const rows: string[][] = Array.from({ length: maxR + 1 }, () => Array(maxC + 1).fill(""));
  for (const cell of sheet.celldata ?? []) {
    const val = cell.v?.m ?? (cell.v?.v != null ? String(cell.v.v) : "");
    rows[cell.r][cell.c] = val;
  }
  return rows;
}

// ============================================================================
// Import: csv/xlsx → fortune-sheet Sheet[]
// ============================================================================
export type ImportedSheet = { title: string; data: Json };

export async function importFileToSheetData(fileName: string, bytes: Buffer): Promise<ImportedSheet> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const title = fileName.replace(/\.[^./\\]+$/, "") || "Untitled sheet";

  if (ext === "csv") {
    const Papa = (await import("papaparse")).default;
    const text = bytes.toString("utf-8");
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
    const rows = (parsed.data as string[][]).slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS));
    return { title, data: [sheetFromRows("Sheet1", "sheet-01", rows, true)] as unknown as Json };
  }

  if (ext === "xlsx" || ext === "xls") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

    const sheets: SheetLike[] = [];
    wb.eachSheet((ws, idx) => {
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          cells.push(excelCellToString(cell.value));
        });
        rows[rowNumber - 1] = cells;
      });
      sheets.push(
        sheetFromRows(
          ws.name || `Sheet${idx}`,
          `sheet-${String(idx).padStart(2, "0")}`,
          rows.slice(0, MAX_ROWS).map((r) => (r ?? []).slice(0, MAX_COLS)),
          idx === 1
        )
      );
    });

    if (sheets.length === 0) sheets.push(sheetFromRows("Sheet1", "sheet-01", [], true));
    return { title, data: sheets as unknown as Json };
  }

  throw new Error(`Unsupported file type: .${ext}`);
}

// ============================================================================
// Export: fortune-sheet Sheet[] → csv/xlsx/pdf
// ============================================================================
function normalizeSheets(data: Json): SheetLike[] {
  if (Array.isArray(data) && data.length > 0) return data as unknown as SheetLike[];
  return [sheetFromRows("Sheet1", "sheet-01", [], true)];
}

export function exportSheetToCsv(data: Json): string {
  const sheets = normalizeSheets(data);
  const active = sheets.find((s) => s.status === 1) ?? sheets[0];
  const rows = rowsFromSheet(active);
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function exportSheetToXlsxBuffer(data: Json): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();

  for (const sheet of normalizeSheets(data)) {
    const ws = wb.addWorksheet(sheet.name || "Sheet1");
    const rows = rowsFromSheet(sheet);
    rows.forEach((row, r) => {
      row.forEach((val, c) => {
        if (val === "") return;
        const num = Number(val);
        ws.getCell(r + 1, c + 1).value = val.trim() !== "" && !Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(val.trim())
          ? num
          : val;
      });
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function exportSheetToPdfBytes(data: Json, title: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const sheets = normalizeSheets(data);
  const active = sheets.find((s) => s.status === 1) ?? sheets[0];
  const rows = rowsFromSheet(active).slice(0, 500);

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Courier);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 841.89; // A4 landscape
  const pageHeight = 595.28;
  const margin = 40;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  page.drawText(title || "Untitled sheet", { x: margin, y, size: 16, font: boldFont, color: rgb(0.1, 0.1, 0.12) });
  y -= 28;

  const size = 8;
  for (const row of rows) {
    if (y < margin + size) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    const line = row.map((c) => (c.length > 14 ? `${c.slice(0, 13)}…` : c.padEnd(14))).join(" ");
    page.drawText(line.slice(0, 160), { x: margin, y, size, font, color: rgb(0.15, 0.15, 0.18) });
    y -= size + 4;
  }

  return pdfDoc.save();
}
