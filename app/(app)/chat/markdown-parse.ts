// ============================================================================
// 채팅 메시지 경량 마크다운 파서 (순수 함수 — 렌더링은 chat-shell 에서).
// 지원: **굵게** *기울임* __밑줄__ ~~취소선~~ `인라인 코드` ```코드 블록```
// [텍스트](URL) · 맨 URL 자동 링크 · @멘션 · 번호/글머리표 목록 + 들여쓰기 ·
// 워크스페이스 첨부 토큰([[kind:uuid|Title]])과 내부 경로.
// 중첩 서식(굵게 안 기울임 등)은 지원하지 않는다 — 단순함이 우선.
// ============================================================================

export const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export type RefKind = "document" | "code" | "sheet" | "mindmap";

export type InlineToken =
  | { t: "text"; text: string }
  | { t: "bold" | "italic" | "underline" | "strike" | "code" | "mention"; text: string }
  | { t: "link"; text: string; href: string }
  | { t: "ref"; kind: RefKind; id: string; title: string };

export type Block =
  | { t: "codeblock"; text: string }
  | { t: "list"; items: { indent: number; marker: string; tokens: InlineToken[] }[] }
  | { t: "para"; lines: InlineToken[][] };

const ROUTE_TO_KIND: Record<string, RefKind> = {
  documents: "document",
  code: "code",
  sheets: "sheet",
  mindmap: "mindmap",
};

const INLINE_RE = new RegExp(
  "(?<code>`[^`\\n]+`)" +
    "|(?<bold>\\*\\*[^*\\n]+\\*\\*)" +
    "|(?<und>__[^_\\n]+__)" +
    "|(?<ital>\\*[^*\\n]+\\*)" +
    "|(?<strike>~~[^~\\n]+~~)" +
    "|(?<link>\\[[^\\]\\n]+\\]\\(https?://[^\\s)]+\\))" +
    `|(?<reftok>\\[\\[(?:document|code|sheet|mindmap):${UUID_PATTERN}\\|[^\\]]{1,160}\\]\\])` +
    `|(?<refpath>(?:https?://[^\\s]*)?/(?:documents|code|sheets|mindmap)/${UUID_PATTERN})` +
    "|(?<url>https?://[^\\s]+)" +
    "|(?<mention>@[\\p{L}\\p{N}_.-]+)",
  "gu"
);

const REFTOK_RE = new RegExp(
  `\\[\\[(document|code|sheet|mindmap):(${UUID_PATTERN})\\|([^\\]]{1,160})\\]\\]`,
  "i"
);
const REFPATH_RE = new RegExp(`/(documents|code|sheets|mindmap)/(${UUID_PATTERN})`, "i");
const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/;

export function parseInline(line: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  for (const m of line.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ t: "text", text: line.slice(last, idx) });
    const g = m.groups ?? {};
    if (g.code) out.push({ t: "code", text: g.code.slice(1, -1) });
    else if (g.bold) out.push({ t: "bold", text: g.bold.slice(2, -2) });
    else if (g.und) out.push({ t: "underline", text: g.und.slice(2, -2) });
    else if (g.ital) out.push({ t: "italic", text: g.ital.slice(1, -1) });
    else if (g.strike) out.push({ t: "strike", text: g.strike.slice(2, -2) });
    else if (g.link) {
      const lm = g.link.match(LINK_RE)!;
      out.push({ t: "link", text: lm[1], href: lm[2] });
    } else if (g.reftok) {
      const rm = g.reftok.match(REFTOK_RE)!;
      out.push({ t: "ref", kind: rm[1].toLowerCase() as RefKind, id: rm[2].toLowerCase(), title: rm[3] });
    } else if (g.refpath) {
      const rm = g.refpath.match(REFPATH_RE)!;
      const kind = ROUTE_TO_KIND[rm[1].toLowerCase()];
      out.push({ t: "ref", kind, id: rm[2].toLowerCase(), title: kind });
    } else if (g.url) {
      out.push({ t: "link", text: g.url, href: g.url });
    } else if (g.mention) {
      out.push({ t: "mention", text: g.mention });
    }
    last = idx + m[0].length;
  }
  if (last < line.length) out.push({ t: "text", text: line.slice(last) });
  return out;
}

const LIST_LINE_RE = /^(\s*)([-*•]|\d{1,3}[.)])\s+(.*)$/;
const FENCE_SPLIT_RE = /```(?:[\w-]*)\n?([\s\S]*?)```/g;

function parseTextChunk(chunk: string, out: Block[]): void {
  const lines = chunk.split("\n");
  let paraLines: InlineToken[][] = [];
  let listItems: { indent: number; marker: string; tokens: InlineToken[] }[] = [];

  const flushPara = () => {
    // 앞뒤의 완전히 빈 줄은 버리되, 문단 중간의 빈 줄은 줄바꿈으로 유지한다.
    while (paraLines.length && paraLines[0].length === 0) paraLines.shift();
    while (paraLines.length && paraLines[paraLines.length - 1].length === 0) paraLines.pop();
    if (paraLines.length) out.push({ t: "para", lines: paraLines });
    paraLines = [];
  };
  const flushList = () => {
    if (listItems.length) out.push({ t: "list", items: listItems });
    listItems = [];
  };

  for (const line of lines) {
    const lm = line.match(LIST_LINE_RE);
    if (lm) {
      flushPara();
      const indent = Math.min(Math.floor(lm[1].replace(/\t/g, "  ").length / 2), 4);
      listItems.push({ indent, marker: lm[2], tokens: parseInline(lm[3]) });
    } else {
      flushList();
      paraLines.push(line.trim() === "" ? [] : parseInline(line));
    }
  }
  flushPara();
  flushList();
}

export function parseMessage(content: string): Block[] {
  const out: Block[] = [];
  let last = 0;
  for (const m of content.matchAll(FENCE_SPLIT_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parseTextChunk(content.slice(last, idx), out);
    const code = m[1].replace(/\n$/, "");
    if (code.trim()) out.push({ t: "codeblock", text: code });
    last = idx + m[0].length;
  }
  if (last < content.length) parseTextChunk(content.slice(last), out);
  return out;
}
