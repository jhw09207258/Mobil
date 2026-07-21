import type { MindElixirData, NodeObj } from "mind-elixir";

// ============================================================================
// MindMup "outline" HTML export → Mind Elixir 트리.
// ----------------------------------------------------------------------------
// MindMup 이 내보내는 outline HTML 은 겉보기엔 <ul>/<li> 중첩처럼 보이지만,
// 실제 마크업은 자식이 있는 모든 노드에서 "<li>토픽<ul></li>" 형태로 자식
// 컨테이너(<ul>)를 연 직후 곧바로 </li> 를 내보내는 특이한 패턴을 쓴다.
// 이 마크업을 표준 HTML5 파서(브라우저 DOMParser 등)로 그대로 파싱하면
// "</li>" 가 스펙상 열려 있던 <ul> 까지 강제로 닫아버려(생성 규칙: </li> 는
// li 가 하나 pop 될 때까지 스택을 무조건 pop) 트리 전체가 완전히 평평하게
// 뭉개진다 — 원본 파일로 직접 검증한 결과다. 따라서 여기서는 표준 HTML5
// 파싱 시맨틱을 의도적으로 쓰지 않고, 태그 스트림을 그대로 훑으며 </li> 는
// 무시하고 <ul>/</ul> 만으로 깊이를 추적하는 전용 파서를 쓴다 — 그래야
// MindMup 이 실제로 의도한 들여쓰기 구조가 보존된다.
// ============================================================================

type Tag = { kind: "tag"; closing: boolean; name: string };
type TextTok = { kind: "text"; value: string };
type Token = Tag | TextTok;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body] ?? m;
  });
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    if (m.index > last) tokens.push({ kind: "text", value: html.slice(last, m.index) });
    tokens.push({ kind: "tag", closing: !!m[1], name: m[2].toLowerCase() });
    last = tagRe.lastIndex;
  }
  if (last < html.length) tokens.push({ kind: "text", value: html.slice(last) });
  return tokens;
}

/** <script>/<style> 내용은 노드 텍스트가 아니므로 통째로 잘라낸다. */
function stripNonContent(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
}

export function parseMindmupOutlineHtml(html: string, fallbackTitle: string): MindElixirData {
  const tokens = tokenize(stripNonContent(html));

  let idCounter = 0;
  const nextId = () => `mu${idCounter++}`;

  const root: NodeObj = { id: "root", topic: fallbackTitle || "Untitled map" };
  // 각 스택 프레임은 "이 레벨에서 새 <li> 가 자식으로 붙을 부모 노드".
  let parentStack: NodeObj[] = [root];
  let currentLi: NodeObj | null = null;
  // "topic" 텍스트 수집 중인지, 아니면 <p> 안이라 별도 note 자식으로 모을지.
  let mode: "topic" | "note" | "h1" | null = null;
  let noteBuf = "";
  let h1Node: NodeObj | null = null;

  const flushNote = () => {
    if (currentLi && noteBuf.trim()) {
      (currentLi.children ??= []).push({
        id: nextId(),
        topic: noteBuf.trim().replace(/\s+/g, " "),
        metadata: { kind: "note" },
      });
    }
    noteBuf = "";
  };

  for (const t of tokens) {
    if (t.kind === "text") {
      const clean = decodeEntities(t.value).replace(/\s+/g, " ");
      if (!clean.trim()) continue;
      if (mode === "topic" && currentLi) {
        const piece = clean.trim();
        currentLi.topic = currentLi.topic ? `${currentLi.topic} ${piece}` : piece;
      } else if (mode === "note") {
        noteBuf += clean;
      } else if (mode === "h1" && h1Node) {
        const piece = clean.trim();
        h1Node.topic = h1Node.topic ? `${h1Node.topic} ${piece}` : piece;
      }
      continue;
    }

    switch (t.name) {
      case "h1":
      case "h2":
        if (!t.closing) {
          // 새 최상위 섹션 — 이전 섹션에서 못 닫힌 <ul> 이 있어도 강제로
          // 루트까지 복귀한다(섹션끼리는 서로 중첩되지 않는다).
          parentStack = [root];
          currentLi = null;
          h1Node = { id: nextId(), topic: "" };
          root.children ??= [];
          root.children.push(h1Node);
          mode = "h1";
        } else if (mode === "h1") {
          mode = null;
        }
        break;

      case "li":
        if (!t.closing) {
          flushNote();
          const node: NodeObj = { id: nextId(), topic: "" };
          const parent = parentStack[parentStack.length - 1];
          (parent.children ??= []).push(node);
          currentLi = node;
          mode = "topic";
        }
        // </li> 는 의도적으로 무시한다(위 파일 상단 설명 참고).
        break;

      case "p":
        if (!t.closing) {
          mode = "note";
          noteBuf = "";
        } else if (mode === "note") {
          flushNote();
          mode = currentLi ? "topic" : null;
        }
        break;

      case "ul":
      case "ol":
        if (!t.closing) {
          flushNote();
          // 방금 만든 <li> 를 부모로 삼아 한 단계 내려간다. h1 직후 첫 목록이면
          // h1 노드를 부모로 삼는다.
          const nextParent = currentLi ?? h1Node;
          if (nextParent) parentStack.push(nextParent);
          currentLi = null;
          mode = null;
        } else if (parentStack.length > 1) {
          parentStack.pop();
        }
        break;

      default:
        break;
    }
  }

  if (!root.children || root.children.length === 0) {
    return { nodeData: { id: "root", topic: fallbackTitle || "Untitled map", children: [] } };
  }
  // h1 이 하나뿐이면 굳이 감싸지 말고 그 자체를 루트로 승격— 파일 하나에
  // 섹션이 하나뿐인 흔한 경우 불필요한 껍데기 노드가 안 생기게 한다.
  if (root.children.length === 1) {
    const only = root.children[0];
    only.topic = only.topic || fallbackTitle || "Untitled map";
    return { nodeData: only };
  }

  return { nodeData: root };
}
