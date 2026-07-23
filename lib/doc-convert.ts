import type { Json } from "@/lib/database.types";

type TTMark = { type: string; attrs?: Record<string, unknown> };
type TTNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TTNode[];
  text?: string;
  marks?: TTMark[];
};

function asDoc(content: Json): TTNode {
  if (
    content &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    (content as TTNode).type === "doc"
  ) {
    return content as TTNode;
  }
  return { type: "doc", content: [] };
}

function textOf(node: TTNode): string {
  if (node.type === "text") return node.text ?? "";
  if (!node.content) return "";
  return node.content.map(textOf).join("");
}

function hasMark(node: TTNode, type: string): boolean {
  return !!node.marks?.some((m) => m.type === type);
}

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

function listItemMarker(listType: string | undefined, item: TTNode, index: number): string {
  if (listType === "orderedList") return `${index + 1}. `;
  if (listType === "taskList") return `${item.attrs?.checked ? "[x]" : "[ ]"} `;
  return "• ";
}

/** 목록 노드(중첩 포함)를 하나의 블록 문자열로 렌더링한다. 중첩된
 * bulletList/orderedList/taskList 는 인라인 walker 로 흘려보내면 구분자 없이
 * 자식 텍스트가 그대로 이어붙어버리므로(예: "Child oneChild two"), 블록
 * 수준에서 직접 재귀하며 레벨마다 들여쓰기를 준다. */
function renderPlainList(node: TTNode, depth: number): string {
  const indent = "  ".repeat(depth);
  const items = node.content ?? [];
  return items
    .map((item, i) => {
      const inline: string[] = [];
      const nested: string[] = [];
      for (const child of item.content ?? []) {
        if (LIST_TYPES.has(child.type)) nested.push(renderPlainList(child, depth + 1));
        else inline.push(textOf(child));
      }
      const marker = listItemMarker(node.type, item, i);
      const lines = [`${indent}${marker}${inline.join(" ").trim()}`, ...nested];
      return lines.join("\n");
    })
    .join("\n");
}

function renderPlainTable(node: TTNode): string {
  return (node.content ?? [])
    .map((row) => (row.content ?? []).map((cell) => textOf(cell).trim()).join(" | "))
    .join("\n");
}

// ============================================================================
// Export: Tiptap JSON → plain text (.txt)
// ============================================================================
export function tiptapToPlainText(content: Json): string {
  const doc = asDoc(content);
  const blocks: string[] = [];

  function walkBlock(node: TTNode) {
    switch (node.type) {
      case "paragraph":
      case "heading":
        blocks.push(textOf(node));
        break;
      case "bulletList":
      case "orderedList":
      case "taskList":
        blocks.push(renderPlainList(node, 0));
        break;
      case "table":
        blocks.push(renderPlainTable(node));
        break;
      case "blockquote":
        for (const child of node.content ?? []) blocks.push(`> ${textOf(child)}`);
        break;
      case "codeBlock":
        blocks.push(textOf(node));
        break;
      case "horizontalRule":
        blocks.push("---");
        break;
      case "image": {
        const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
        blocks.push(alt ? `[Image: ${alt}]` : "[Image]");
        break;
      }
      case "video":
        blocks.push("[Video]");
        break;
      default:
        if (node.content) for (const child of node.content) walkBlock(child);
    }
  }

  for (const node of doc.content ?? []) walkBlock(node);
  return blocks.join("\n\n");
}

// ============================================================================
// Export: Tiptap JSON → Markdown (hwpx 변환의 중간 표현으로 사용)
// ============================================================================
function inlineMarkdown(node: TTNode): string {
  if (node.type === "text") {
    let t = node.text ?? "";
    if (hasMark(node, "code")) t = `\`${t}\``;
    if (hasMark(node, "bold")) t = `**${t}**`;
    if (hasMark(node, "italic")) t = `*${t}*`;
    return t;
  }
  return (node.content ?? []).map(inlineMarkdown).join("");
}

function markdownListMarker(listType: string | undefined, item: TTNode, index: number): string {
  if (listType === "orderedList") return `${index + 1}. `;
  if (listType === "taskList") return `- [${item.attrs?.checked ? "x" : " "}] `;
  return "- ";
}

/** renderPlainList 와 동일한 이유(중첩 목록의 구분자 유실 방지)로 블록 수준
 * 재귀가 필요하다 — 레벨마다 2칸씩 들여쓴다. */
function renderMarkdownList(node: TTNode, depth: number): string {
  const indent = "  ".repeat(depth);
  const items = node.content ?? [];
  return items
    .map((item, i) => {
      const inline: string[] = [];
      const nested: string[] = [];
      for (const child of item.content ?? []) {
        if (LIST_TYPES.has(child.type)) nested.push(renderMarkdownList(child, depth + 1));
        else inline.push(inlineMarkdown(child));
      }
      const marker = markdownListMarker(node.type, item, i);
      const lines = [`${indent}${marker}${inline.join(" ").trim()}`, ...nested];
      return lines.join("\n");
    })
    .join("\n");
}

/** GFM 표 문법(헤더 행 + `---` 구분선 + 본문 행)으로 렌더링한다. 헤더 행이
 * 없는 데이터(외부에서 온 표 등)는 빈 헤더를 하나 만들어 형식을 지킨다 —
 * GFM 표는 헤더 없이 존재할 수 없다. */
function renderMarkdownTable(node: TTNode): string {
  const rows = node.content ?? [];
  if (rows.length === 0) return "";
  const cellText = (cell: TTNode) => {
    const t = (cell.content ?? []).map(inlineMarkdown).join("").trim();
    return t || " ";
  };
  const rowLine = (row: TTNode) => `| ${(row.content ?? []).map(cellText).join(" | ")} |`;

  const [firstRow, ...restRows] = rows;
  const colCount = (firstRow.content ?? []).length || 1;
  const divider = `| ${Array(colCount).fill("---").join(" | ")} |`;
  const hasHeaderRow = (firstRow.content ?? []).every((c) => c.type === "tableHeader");

  const lines: string[] = [];
  if (hasHeaderRow) {
    lines.push(rowLine(firstRow), divider);
    for (const r of restRows) lines.push(rowLine(r));
  } else {
    lines.push(`| ${Array(colCount).fill(" ").join(" | ")} |`, divider);
    for (const r of rows) lines.push(rowLine(r));
  }
  return lines.join("\n");
}

export function tiptapToMarkdown(content: Json): string {
  const doc = asDoc(content);
  const blocks: string[] = [];

  function walkBlock(node: TTNode) {
    switch (node.type) {
      case "heading": {
        const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
        blocks.push(`${"#".repeat(level)} ${(node.content ?? []).map(inlineMarkdown).join("")}`);
        break;
      }
      case "paragraph":
        blocks.push((node.content ?? []).map(inlineMarkdown).join(""));
        break;
      case "bulletList":
      case "orderedList":
      case "taskList":
        blocks.push(renderMarkdownList(node, 0));
        break;
      case "blockquote":
        blocks.push((node.content ?? []).map((c) => `> ${inlineMarkdown(c)}`).join("\n"));
        break;
      case "codeBlock":
        blocks.push(`\`\`\`\n${textOf(node)}\n\`\`\``);
        break;
      case "horizontalRule":
        blocks.push("---");
        break;
      case "image": {
        const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
        const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
        blocks.push(`![${alt}](${src})`);
        break;
      }
      case "video": {
        const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
        blocks.push(`[Video](${src})`);
        break;
      }
      case "table":
        blocks.push(renderMarkdownTable(node));
        break;
      default:
        if (node.content) for (const child of node.content) walkBlock(child);
    }
  }

  for (const node of doc.content ?? []) walkBlock(node);
  return blocks.join("\n\n");
}

// ============================================================================
// Import: 임의 텍스트/마크다운 → Tiptap JSON (제목/굵게/기울임/목록/표를 인식.
// 표는 GFM 형식(|header|---|row|)만 인식하고, 형식에 안 맞는 |...| 줄은
// 열 개수가 안 맞을 수 있어도 최대한 표로 취급한다 — best-effort.)
// ============================================================================
// markdown 이스케이프(\., \*, \_ 등) 제거 — mammoth/hwp-convert 출력에 흔함.
function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1");
}

function parseInline(rawText: string): TTNode[] {
  const text = unescapeMarkdown(rawText);
  const nodes: TTNode[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|`(.+?)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) nodes.push({ type: "text", text: m[1], marks: [{ type: "bold" }] });
    else if (m[2] !== undefined) nodes.push({ type: "text", text: m[2], marks: [{ type: "bold" }] });
    else if (m[3] !== undefined) nodes.push({ type: "text", text: m[3], marks: [{ type: "italic" }] });
    else if (m[4] !== undefined) nodes.push({ type: "text", text: m[4], marks: [{ type: "italic" }] });
    else if (m[5] !== undefined) nodes.push({ type: "text", text: m[5], marks: [{ type: "code" }] });
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes.length ? nodes : [{ type: "text", text }];
}

function tableCellNode(text: string, isHeader: boolean): TTNode {
  return {
    type: isHeader ? "tableHeader" : "tableCell",
    content: [{ type: "paragraph", content: text ? parseInline(text) : [] }],
  };
}

function buildTableNode(headerRow: string[] | null, bodyRows: string[][]): TTNode {
  const colCount = Math.max(headerRow?.length ?? 0, ...bodyRows.map((r) => r.length), 1);
  const pad = (row: string[]) => {
    const out = row.slice(0, colCount);
    while (out.length < colCount) out.push("");
    return out;
  };
  const rows: TTNode[] = [];
  if (headerRow) rows.push({ type: "tableRow", content: pad(headerRow).map((c) => tableCellNode(c, true)) });
  for (const r of bodyRows) rows.push({ type: "tableRow", content: pad(r).map((c) => tableCellNode(c, false)) });
  return { type: "table", content: rows };
}

export function markdownToTiptapDoc(markdown: string): Json {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const content: TTNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: { headerRow: string[] | null; rows: string[][] } | null = null;

  const flushPara = () => {
    if (para.length) {
      content.push({ type: "paragraph", content: parseInline(para.join(" ").trim()) });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      content.push({
        type: list.ordered ? "orderedList" : "bulletList",
        content: list.items.map((t) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInline(t) }],
        })),
      });
      list = null;
    }
  };
  const flushTable = () => {
    if (table && (table.headerRow || table.rows.length)) {
      content.push(buildTableNode(table.headerRow, table.rows));
    }
    table = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    const tableRow = /^\|(.+)\|$/.exec(line.trim());

    if (line.trim() === "") {
      flushPara();
      flushList();
      flushTable();
      continue;
    }
    if (heading) {
      flushPara();
      flushList();
      flushTable();
      content.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: parseInline(heading[2]),
      });
      continue;
    }
    if (bullet) {
      flushPara();
      flushTable();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }
    if (ordered) {
      flushPara();
      flushTable();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }
    if (tableRow) {
      flushPara();
      flushList();
      // 구분선(예: |---|:--:|) 행은 표 자체를 그리지 않고, 바로 앞줄을 헤더로
      // 승격하는 신호로만 쓴다 — GFM 표 규칙상 항상 헤더 다음 한 줄에 온다.
      if (/^[-|\s:]+$/.test(tableRow[1])) {
        if (table && table.rows.length === 1 && !table.headerRow) {
          table.headerRow = table.rows.pop() ?? null;
        }
        continue;
      }
      const cells = tableRow[1].split("|").map((c) => c.trim());
      if (!table) table = { headerRow: null, rows: [] };
      table.rows.push(cells);
      continue;
    }
    flushTable();

    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  flushTable();

  if (content.length === 0) content.push({ type: "paragraph" });
  return { type: "doc", content } as unknown as Json;
}

export function plainTextToTiptapDoc(text: string): Json {
  const content: TTNode[] = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => ({ type: "paragraph", content: [{ type: "text", text: block.replace(/\n/g, " ") }] }));
  if (content.length === 0) content.push({ type: "paragraph" });
  return { type: "doc", content } as unknown as Json;
}

// ============================================================================
// 확장자별 원본 바이트 → Tiptap JSON
// ============================================================================
export type ImportedDoc = { title: string; content: Json };

export async function importFileToTiptapDoc(
  fileName: string,
  bytes: Buffer
): Promise<ImportedDoc> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const title = fileName.replace(/\.[^./\\]+$/, "") || "Untitled";

  if (ext === "txt" || ext === "md" || ext === "markdown") {
    const text = bytes.toString("utf-8");
    return { title, content: ext === "txt" ? plainTextToTiptapDoc(text) : markdownToTiptapDoc(text) };
  }

  if (ext === "docx") {
    const mammoth = await import("mammoth");
    // mammoth 런타임에는 convertToMarkdown 이 있지만 패키지 타입 선언에는
    // 누락되어 있어(문서화 안 된 API) 안전하게 캐스팅해 호출한다.
    const convertToMarkdown = (
      mammoth as unknown as {
        convertToMarkdown: (input: { buffer: Buffer }) => Promise<{ value: string }>;
      }
    ).convertToMarkdown;
    const { value: markdown } = await convertToMarkdown({ buffer: bytes });
    return { title, content: markdownToTiptapDoc(markdown) };
  }

  if (ext === "hwpx") {
    const { HwpxReader } = await import("hwp-convert");
    const reader = new HwpxReader();
    await reader.loadFromArrayBuffer(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    );
    const markdown = await reader.extractMarkdown();
    return { title, content: markdownToTiptapDoc(markdown) };
  }

  if (ext === "hwp") {
    const { hwpToMarkdown } = await import("hwp-convert");
    const markdown = await hwpToMarkdown(new Uint8Array(bytes));
    return { title, content: markdownToTiptapDoc(markdown) };
  }

  if (ext === "pages") {
    const { extractPagesText } = await import("@/lib/pages-convert");
    const text = await extractPagesText(bytes);
    return { title, content: plainTextToTiptapDoc(text) };
  }

  throw new Error(`Unsupported file type: .${ext}`);
}

// ============================================================================
// Export: Tiptap JSON → docx (Buffer)
// ============================================================================
export async function tiptapToDocxBuffer(content: Json, title: string): Promise<Buffer> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    ShadingType,
  } = await import("docx");

  const doc = asDoc(content);
  const HEADING_MAP = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ];

  function runsOf(node: TTNode): InstanceType<typeof TextRun>[] {
    if (node.type === "text") {
      return [
        new TextRun({
          text: node.text ?? "",
          bold: hasMark(node, "bold"),
          italics: hasMark(node, "italic"),
          underline: hasMark(node, "underline") ? {} : undefined,
          strike: hasMark(node, "strike"),
          font: hasMark(node, "code") ? "Courier New" : undefined,
        }),
      ];
    }
    return (node.content ?? []).flatMap(runsOf);
  }

  const paragraphs: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
  ];

  function buildDocxTable(node: TTNode): InstanceType<typeof Table> {
    const rows = (node.content ?? []).map((row) => {
      const cells = (row.content ?? []).map((cell) => {
        const isHeader = cell.type === "tableHeader";
        const cellParagraphs = (cell.content ?? []).map(
          (block) => new Paragraph({ children: (block.content ?? []).flatMap(runsOf) })
        );
        return new TableCell({
          children: cellParagraphs.length ? cellParagraphs : [new Paragraph({})],
          shading: isHeader ? { type: ShadingType.CLEAR, fill: "E8E8E8" } : undefined,
        });
      });
      return new TableRow({ children: cells });
    });
    return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
  }

  // 목록 안의 인라인 콘텐츠와 중첩된 하위 목록을 분리해, 하위 목록은 별도
  // 문단으로 한 단계 깊은 level 에 재귀 렌더링한다 — 그냥 runsOf 로 흘려보내면
  // 하위 항목 텍스트가 구분자 없이 부모 문단에 그대로 이어붙는다.
  function pushListItems(node: TTNode, level: number) {
    const items = node.content ?? [];
    items.forEach((item, i) => {
      const inline: TTNode[] = [];
      const nested: TTNode[] = [];
      for (const child of item.content ?? []) {
        if (LIST_TYPES.has(child.type)) nested.push(child);
        else inline.push(child);
      }
      const runs = inline.flatMap(runsOf);
      if (node.type === "taskList") {
        const prefix = item.attrs?.checked ? "☑ " : "☐ ";
        paragraphs.push(
          new Paragraph({ children: [new TextRun(prefix), ...runs], indent: { left: 240 * level } })
        );
      } else if (node.type === "orderedList") {
        paragraphs.push(
          new Paragraph({ children: runs, numbering: { reference: "mobil-numbered-list", level } })
        );
      } else {
        paragraphs.push(new Paragraph({ children: runs, bullet: { level } }));
      }
      for (const n of nested) pushListItems(n, level + 1);
    });
  }

  function walkBlock(node: TTNode) {
    switch (node.type) {
      case "heading": {
        const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
        paragraphs.push(
          new Paragraph({ children: (node.content ?? []).flatMap(runsOf), heading: HEADING_MAP[level - 1] })
        );
        break;
      }
      case "paragraph":
        paragraphs.push(new Paragraph({ children: (node.content ?? []).flatMap(runsOf) }));
        break;
      case "bulletList":
      case "orderedList":
      case "taskList":
        pushListItems(node, 0);
        break;
      case "table":
        paragraphs.push(buildDocxTable(node));
        break;
      case "blockquote":
        for (const child of node.content ?? []) {
          paragraphs.push(new Paragraph({ children: runsOf(child), indent: { left: 480 } }));
        }
        break;
      case "codeBlock":
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: textOf(node), font: "Courier New" })] }));
        break;
      case "horizontalRule":
        paragraphs.push(new Paragraph({ text: "───────────" }));
        break;
      case "image": {
        const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
        paragraphs.push(
          new Paragraph({ children: [new TextRun({ text: alt ? `[Image: ${alt}]` : "[Image]", italics: true })] })
        );
        break;
      }
      case "video":
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: "[Video]", italics: true })] }));
        break;
      default:
        if (node.content) for (const child of node.content) walkBlock(child);
    }
  }

  for (const node of doc.content ?? []) walkBlock(node);

  const docx = new Document({
    numbering: {
      config: [
        {
          reference: "mobil-numbered-list",
          // level 0 은 top-level, 1-3 은 중첩된 orderedList 용.
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: "decimal" as const,
            text: "%1.",
            alignment: "start" as const,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: paragraphs }],
  });

  return Packer.toBuffer(docx);
}

// ============================================================================
// Export: Tiptap JSON → pdf (기본 텍스트 흐름, 서식은 굵게/제목 크기 정도만 반영)
// ============================================================================
export async function tiptapToPdfBytes(content: Json, title: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const margin = 56;
  const maxWidth = pageWidth - margin * 2;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const newPage = () => {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  function wrap(text: string, useFont: typeof font, size: number, availWidth = maxWidth): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const out: string[] = [];
    let line = "";
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (useFont.widthOfTextAtSize(trial, size) > availWidth && line) {
        out.push(line);
        line = w;
      } else {
        line = trial;
      }
    }
    if (line) out.push(line);
    return out;
  }

  function writeLine(text: string, size: number, useFont: typeof font, gap = 6, indent = 0) {
    for (const line of wrap(text, useFont, size, maxWidth - indent)) {
      if (y < margin + size) newPage();
      page.drawText(line, { x: margin + indent, y, size, font: useFont, color: rgb(0.1, 0.1, 0.12) });
      y -= size + gap;
    }
  }

  // 표: PDF 는 표 개념이 없어 열 폭을 균등 분할해 셀마다 rectangle 을 그리고
  // 텍스트를 채운다. 행 높이는 그 행에서 가장 많이 줄바꿈된 셀에 맞춘다.
  function drawTable(node: TTNode) {
    const rows = node.content ?? [];
    if (rows.length === 0) return;
    const colCount = Math.max(...rows.map((r) => (r.content ?? []).length), 1);
    const colWidth = maxWidth / colCount;
    const fontSize = 10;
    const cellPad = 5;
    const lineHeight = fontSize + 3;

    for (const row of rows) {
      const cells = row.content ?? [];
      const isHeader = cells.length > 0 && cells.every((c) => c.type === "tableHeader");
      const cellLines = cells.map((cell) => wrap(textOf(cell).trim(), font, fontSize, colWidth - cellPad * 2));
      const maxLines = Math.max(1, ...cellLines.map((l) => l.length));
      const rowHeight = maxLines * lineHeight + cellPad * 2;

      if (y - rowHeight < margin) newPage();
      const rowTop = y;

      for (let c = 0; c < colCount; c++) {
        const cellX = margin + c * colWidth;
        page.drawRectangle({
          x: cellX,
          y: rowTop - rowHeight,
          width: colWidth,
          height: rowHeight,
          borderColor: rgb(0.7, 0.7, 0.72),
          borderWidth: 0.75,
          color: isHeader ? rgb(0.93, 0.93, 0.94) : undefined,
        });
        for (const [li, line] of (cellLines[c] ?? []).entries()) {
          page.drawText(line, {
            x: cellX + cellPad,
            y: rowTop - cellPad - fontSize - li * lineHeight,
            size: fontSize,
            font: isHeader ? boldFont : font,
            color: rgb(0.1, 0.1, 0.12),
          });
        }
      }
      y = rowTop - rowHeight;
    }
    y -= 8;
  }

  writeLine(title || "Untitled", 20, boldFont, 14);

  // 중첩된 목록은 depth 를 늘려 재귀하며 왼쪽 들여쓰기를 더한다 — textOf 로
  // 통째로 흘려보내면 하위 항목 텍스트가 구분자 없이 이어붙는다.
  function writeListBlock(node: TTNode, depth: number) {
    const items = node.content ?? [];
    items.forEach((item, i) => {
      const marker =
        node.type === "orderedList"
          ? `${i + 1}.`
          : node.type === "taskList"
            ? item.attrs?.checked
              ? "[x]"
              : "[ ]"
            : "•";
      const inline: string[] = [];
      const nested: TTNode[] = [];
      for (const child of item.content ?? []) {
        if (LIST_TYPES.has(child.type)) nested.push(child);
        else inline.push(textOf(child));
      }
      writeLine(`${marker}  ${inline.join(" ").trim()}`, 11, font, 6, depth * 16);
      for (const n of nested) writeListBlock(n, depth + 1);
    });
  }

  const doc = asDoc(content);
  function walkBlock(node: TTNode) {
    switch (node.type) {
      case "heading": {
        const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 1));
        writeLine(textOf(node), 16 - (level - 1) * 2, boldFont, 8);
        break;
      }
      case "paragraph":
        writeLine(textOf(node) || " ", 11, font, 10);
        break;
      case "bulletList":
      case "orderedList":
      case "taskList":
        writeListBlock(node, 0);
        break;
      case "table":
        drawTable(node);
        break;
      case "blockquote":
        for (const child of node.content ?? []) writeLine(`"  ${textOf(child)}`, 11, font, 6);
        break;
      case "codeBlock":
        writeLine(textOf(node), 10, font, 10);
        break;
      case "horizontalRule":
        y -= 6;
        break;
      case "image": {
        const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
        writeLine(alt ? `[Image: ${alt}]` : "[Image]", 11, font, 10);
        break;
      }
      case "video":
        writeLine("[Video]", 11, font, 10);
        break;
      default:
        if (node.content) for (const child of node.content) walkBlock(child);
    }
  }
  for (const node of doc.content ?? []) walkBlock(node);

  return pdfDoc.save();
}

// ============================================================================
// Export: Tiptap JSON → HWPX (hwp-convert 의 markdownToHwpx 경유)
// ============================================================================
export async function tiptapToHwpxBytes(content: Json, title: string): Promise<Uint8Array> {
  const { markdownToHwpx } = await import("hwp-convert");
  const markdown = `# ${title}\n\n${tiptapToMarkdown(content)}`;
  return markdownToHwpx(markdown, { title });
}
