import { after } from "next/server";
import type { NodeObj } from "mind-elixir";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { extractTagsFromText } from "@/lib/tags";
import { detectLanguage, isLangKey } from "@/lib/languages";
import { ensureCodeSpace, uniquePath } from "@/lib/code-space";
import { markdownToTiptapDoc, tiptapToPlainText, tiptapToMarkdown } from "@/lib/doc-convert";
import { importFileToSheetData, exportSheetToCsv } from "@/lib/sheet-convert";
import { sheetRowsToMindmapData, type SheetCell } from "@/lib/outline-convert";
import { searchOntology, searchSemantic } from "../search/actions";
import { getDocumentForTab, saveDocument } from "../documents/actions";
import { getCodeFileForTab, saveCodeFile } from "../code/actions";
import { getSheetForTab } from "../sheets/actions";
import { getMindMapForTab } from "../mindmap/actions";
import { searchBigBrother } from "../big-brother/actions";

// ============================================================================
// Sophia 도구 사용(function calling) — NVIDIA NIM 의 OpenAI 호환 tools API 로
// 호출된다. 모든 구현체는 요청자의 쿠키 기반 supabase 클라이언트(RLS 적용)를
// 그대로 쓰는 기존 서버 액션을 재사용하므로, Sophia 는 사용자 본인이 보거나
// 고칠 권한이 있는 항목만 건드릴 수 있다 — 권한 우회 경로가 없다.
// ============================================================================

const READ_CHAR_LIMIT = 6000;

export const SOPHIA_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_possion",
      description:
        "Search the user's Possion workspace (documents, code files, sheets, mind maps) by title/content, or by #tag. Use this before reading or editing something to find its id.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search text, or a #tag (e.g. '#project-x')." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "semantic_search",
      description:
        "Find workspace items related to a concept by MEANING (vector similarity), even when the words don't match. Use this when keyword search (search_possion) finds nothing, or when the user asks about a topic/idea rather than an exact title.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The concept or question to find related items for." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_document",
      description: "Read the plain-text content of a document by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Document UUID." } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_code_file",
      description: "Read the content of a code file by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Code file UUID." } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_sheet",
      description: "Read a sheet by id, returned as CSV text.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Sheet UUID." } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_mindmap",
      description: "Read a mind map by id, returned as an indented outline.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Mind map UUID." } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_document",
      description:
        "Create a brand-new document. Markdown-ish input: lines starting with '#'/'##'/etc become headings, blank-line-separated text becomes paragraphs.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          markdown: { type: "string", description: "Document body (heading lines + paragraphs)." },
        },
        required: ["title", "markdown"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_code_file",
      description:
        "Create a brand-new code file inside a Code Space. Code files cannot exist outside one.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Path inside the Code Space including extension, e.g. 'src/utils.ts'.",
          },
          content: { type: "string" },
          language: { type: "string", description: "Optional; auto-detected from the file name if omitted." },
          code_space: {
            type: "string",
            description:
              "Name of the Code Space to put this in. Created if it doesn't exist. Defaults to 'Big Brother'.",
          },
        },
        required: ["name", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_sheet",
      description: "Create a brand-new sheet from CSV text (first row is treated as the header row).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          csv: { type: "string", description: "CSV text, comma-separated, one row per line." },
        },
        required: ["title", "csv"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_mindmap",
      description:
        "Create a brand-new mind map from an indented outline. The map's root node is 'title' — don't repeat it as the first outline line, just list the top-level branches. Each line is one node; indent with 2 spaces per level, an optional leading '-' is stripped. Same format read_mindmap returns, so you can round-trip a map you just read.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          outline: {
            type: "string",
            description: "Indented outline of the map's top-level branches (excluding the root/title itself).",
          },
        },
        required: ["title", "outline"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_document",
      description:
        "Edit an existing document the user can edit. 'replace' overwrites the whole body; 'append' adds to the end. Always confirm with the user before a 'replace' unless they clearly asked for it.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          markdown: { type: "string" },
          mode: { type: "string", enum: ["replace", "append"] },
        },
        required: ["id", "markdown", "mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_code_file",
      description:
        "Edit an existing code file the user can edit. 'replace' overwrites the whole file; 'append' adds to the end.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          content: { type: "string" },
          mode: { type: "string", enum: ["replace", "append"] },
        },
        required: ["id", "content", "mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_papers_and_code",
      description: "Search external academic papers (OpenAlex, Semantic Scholar) and public GitHub code (Big Brother).",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
] as const;

function outlineFromNode(node: NodeObj, depth: number, lines: string[]): void {
  lines.push(`${"  ".repeat(depth)}- ${node.topic ?? ""}${node.note ? ` — ${node.note}` : ""}`);
  for (const child of node.children ?? []) outlineFromNode(child, depth + 1, lines);
}

function outlineTextToSheetCells(outline: string): SheetCell[] {
  const cells: SheetCell[] = [
    { r: 0, c: 0, v: { v: "Level", m: "Level" } },
    { r: 0, c: 1, v: { v: "Topic", m: "Topic" } },
  ];
  let r = 1;
  for (const rawLine of outline.split("\n")) {
    if (!rawLine.trim()) continue;
    const indentMatch = rawLine.match(/^[ \t]*/);
    const indent = (indentMatch?.[0] ?? "").replace(/\t/g, "  ").length;
    const level = Math.floor(indent / 2);
    const topic = rawLine.trim().replace(/^[-*]\s*/, "");
    if (!topic) continue;
    cells.push({ r, c: 0, v: { v: level, m: String(level) } });
    cells.push({ r, c: 1, v: { v: topic, m: topic } });
    r++;
  }
  return cells;
}

type ToolResult = Record<string, unknown>;

async function toolSearchPossion(args: { query?: string }): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return { error: "query is required." };
  const results = await searchOntology(query);
  return {
    results: results.slice(0, 8).map((r) => ({
      kind: r.kind,
      id: r.id,
      title: r.title,
      updated_at: r.updated_at,
    })),
  };
}

async function toolSemanticSearch(args: { query?: string }): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return { error: "query is required." };
  const results = await searchSemantic(query);
  if (results.length === 0) {
    return { results: [], note: "No semantically related items (or semantic search is unavailable)." };
  }
  return {
    results: results.map((r) => ({
      kind: r.kind,
      id: r.id,
      title: r.title,
      similarity: Math.round(r.similarity * 100) / 100,
    })),
  };
}

async function toolReadDocument(args: { id?: string }): Promise<ToolResult> {
  const id = String(args.id ?? "");
  const doc = await getDocumentForTab(id);
  if (!doc) return { error: "Not found, or you don't have access to it." };
  return { title: doc.title, text: tiptapToPlainText(doc.content).slice(0, READ_CHAR_LIMIT) };
}

async function toolReadCodeFile(args: { id?: string }): Promise<ToolResult> {
  const id = String(args.id ?? "");
  const file = await getCodeFileForTab(id);
  if (!file) return { error: "Not found, or you don't have access to it." };
  return {
    name: file.name,
    language: file.language,
    content: (file.content ?? "").slice(0, READ_CHAR_LIMIT),
  };
}

async function toolReadSheet(args: { id?: string }): Promise<ToolResult> {
  const id = String(args.id ?? "");
  const sheet = await getSheetForTab(id);
  if (!sheet) return { error: "Not found, or you don't have access to it." };
  return { title: sheet.title, csv: exportSheetToCsv(sheet.data).slice(0, READ_CHAR_LIMIT) };
}

async function toolReadMindmap(args: { id?: string }): Promise<ToolResult> {
  const id = String(args.id ?? "");
  const map = await getMindMapForTab(id);
  if (!map) return { error: "Not found, or you don't have access to it." };
  const data = map.data as { nodeData?: NodeObj } | null;
  if (!data?.nodeData) return { title: map.title, outline: "" };
  // 루트 자체의 topic 은 map.title 로 이미 알려주므로 outline 에는 자식들만
  // depth 0 부터 나열한다 — create_mindmap 이 기대하는 입력 형태(최상위
  // 줄들이 새 root 의 자식이 되는 것)와 대칭이 맞아야 읽은 그대로 다시
  // create_mindmap 에 넣어도 제목이 한 겹 더 중첩되지 않는다.
  const lines: string[] = [];
  for (const child of data.nodeData.children ?? []) outlineFromNode(child, 0, lines);
  return { title: map.title, outline: lines.join("\n").slice(0, READ_CHAR_LIMIT) };
}

async function toolCreateDocument(args: { title?: string; markdown?: string }): Promise<ToolResult> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const title = String(args.title ?? "Untitled").trim() || "Untitled";
  const content = markdownToTiptapDoc(String(args.markdown ?? ""));

  const { data, error } = await supabase
    .from("documents")
    .insert({ owner_id: userId, title, content })
    .select("id, title")
    .single();
  if (error || !data) return { error: "Failed to create document." };

  after(async () => {
    await supabase.from("audit_logs").insert({
      user_id: userId,
      target_type: "document",
      target_id: data.id,
      action: "create",
    });
    const tags = extractTagsFromText(`${title} ${args.markdown ?? ""}`);
    await supabase.rpc("sync_object_tags", { p_kind: "document", p_id: data.id, p_tag_names: tags }).then(
      () => {},
      () => {}
    );
  });

  return { id: data.id, title: data.title };
}

async function toolCreateCodeFile(args: {
  name?: string;
  content?: string;
  language?: string;
  code_space?: string;
}): Promise<ToolResult> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const rawPath = String(args.name ?? "untitled.txt").trim() || "untitled.txt";
  const name = rawPath.split("/").pop() || "untitled.txt";
  const language = args.language && isLangKey(args.language) ? args.language : detectLanguage(name);

  // 코드 파일은 Code Space 안에서만 존재한다 — 지정이 없으면 기본 Space 에 모은다.
  const spaceId = await ensureCodeSpace(supabase, userId, args.code_space || undefined);
  if (!spaceId) return { error: "Could not create a Code Space for this file." };
  const path = await uniquePath(supabase, spaceId, rawPath);

  const { data, error } = await supabase
    .from("code_files")
    .insert({
      owner_id: userId,
      name,
      language,
      content: String(args.content ?? ""),
      code_repository_id: spaceId,
      path,
    })
    .select("id, name")
    .single();
  if (error || !data) return { error: "Failed to create code file." };

  after(async () => {
    await supabase.from("audit_logs").insert({
      user_id: userId,
      target_type: "code",
      target_id: data.id,
      action: "create",
    });
    const tags = extractTagsFromText(name);
    await supabase.rpc("sync_object_tags", { p_kind: "code", p_id: data.id, p_tag_names: tags }).then(
      () => {},
      () => {}
    );
  });

  return { id: data.id, name: data.name };
}

async function toolCreateSheet(args: { title?: string; csv?: string }): Promise<ToolResult> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const title = String(args.title ?? "Untitled sheet").trim() || "Untitled sheet";

  let imported;
  try {
    imported = await importFileToSheetData(`${title}.csv`, Buffer.from(String(args.csv ?? ""), "utf-8"));
  } catch {
    return { error: "Could not parse that CSV." };
  }

  const { data, error } = await supabase
    .from("sheets")
    .insert({ owner_id: userId, title, data: imported.data })
    .select("id, title")
    .single();
  if (error || !data) return { error: "Failed to create sheet." };

  after(async () => {
    const tags = extractTagsFromText(title);
    await supabase.rpc("sync_object_tags", { p_kind: "sheet", p_id: data.id, p_tag_names: tags }).then(
      () => {},
      () => {}
    );
  });

  return { id: data.id, title: data.title };
}

async function toolCreateMindmap(args: { title?: string; outline?: string }): Promise<ToolResult> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const title = String(args.title ?? "Untitled map").trim() || "Untitled map";

  const cells = outlineTextToSheetCells(String(args.outline ?? ""));
  const result = sheetRowsToMindmapData(cells, title);
  if ("error" in result) return { error: result.error };

  const { data, error } = await supabase
    .from("mind_maps")
    .insert({
      owner_id: userId,
      title,
      data: { nodeData: result.nodeData, arrows: [] } as unknown as Json,
    })
    .select("id, title")
    .single();
  if (error || !data) return { error: "Failed to create mind map." };

  after(async () => {
    const tags = extractTagsFromText(title);
    await supabase.rpc("sync_object_tags", { p_kind: "mindmap", p_id: data.id, p_tag_names: tags }).then(
      () => {},
      () => {}
    );
  });

  return { id: data.id, title: data.title };
}

async function toolUpdateDocument(args: {
  id?: string;
  markdown?: string;
  mode?: string;
}): Promise<ToolResult> {
  const id = String(args.id ?? "");
  const doc = await getDocumentForTab(id);
  if (!doc) return { error: "Not found, or you don't have access to it." };
  if (!doc.canEdit) return { error: "You don't have edit access to this document." };

  const addition = String(args.markdown ?? "");
  const newContent =
    args.mode === "append"
      ? markdownToTiptapDoc(`${tiptapToMarkdown(doc.content)}\n\n${addition}`)
      : markdownToTiptapDoc(addition);

  const res = await saveDocument(id, doc.title, newContent);
  if (!res.ok) return { error: res.error };
  return { ok: true };
}

async function toolUpdateCodeFile(args: {
  id?: string;
  content?: string;
  mode?: string;
}): Promise<ToolResult> {
  const id = String(args.id ?? "");
  const file = await getCodeFileForTab(id);
  if (!file) return { error: "Not found, or you don't have access to it." };
  if (!file.canEdit) return { error: "You don't have edit access to this code file." };

  const addition = String(args.content ?? "");
  const newContent = args.mode === "append" ? `${file.content ?? ""}\n${addition}` : addition;

  const res = await saveCodeFile(id, file.name, file.language, newContent);
  if (!res.ok) return { error: res.error };
  return { ok: true };
}

async function toolSearchPapersAndCode(args: { query?: string }): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return { error: "query is required." };
  const res = await searchBigBrother(query);
  return {
    openalex: res.openalex.slice(0, 3).map((p) => ({
      title: p.title,
      authors: p.authors.slice(0, 3),
      year: p.year,
      url: p.url,
      abstract: p.abstract?.slice(0, 220) ?? null,
    })),
    semanticScholar: res.semanticScholar.slice(0, 3).map((p) => ({
      title: p.title,
      authors: p.authors.slice(0, 3),
      year: p.year,
      url: p.url,
      abstract: p.abstract?.slice(0, 220) ?? null,
    })),
    github: res.github.slice(0, 3).map((r) => ({
      owner: r.owner,
      repo: r.repo,
      path: r.path,
      htmlUrl: r.htmlUrl,
      fragment: r.fragment,
    })),
    errors: res.errors,
  };
}

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> = {
  search_possion: toolSearchPossion,
  semantic_search: toolSemanticSearch,
  read_document: toolReadDocument,
  read_code_file: toolReadCodeFile,
  read_sheet: toolReadSheet,
  read_mindmap: toolReadMindmap,
  create_document: toolCreateDocument,
  create_code_file: toolCreateCodeFile,
  create_sheet: toolCreateSheet,
  create_mindmap: toolCreateMindmap,
  update_document: toolUpdateDocument,
  update_code_file: toolUpdateCodeFile,
  search_papers_and_code: toolSearchPapersAndCode,
};

export async function executeSophiaTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const handler = HANDLERS[name];
  if (!handler) return { error: `Unknown tool: ${name}` };
  try {
    return await handler(args);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Tool execution failed." };
  }
}
