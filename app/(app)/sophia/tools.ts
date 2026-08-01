import { after } from "next/server";
import type { NodeObj } from "mind-elixir";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { extractTagsFromText } from "@/lib/tags";
import { detectLanguage, isLangKey } from "@/lib/languages";
import { ensureCodeSpace, uniquePath } from "@/lib/code-space";
import { mergeContentIntoSnapshot } from "@/lib/text-delta";
import { markdownToTiptapDoc, tiptapToPlainText, tiptapToMarkdown } from "@/lib/doc-convert";
import { importFileToSheetData, exportSheetToCsv } from "@/lib/sheet-convert";
import { sheetRowsToMindmapData, type SheetCell } from "@/lib/outline-convert";
import { searchOntology, searchSemantic } from "../search/actions";
import { getDocumentForTab, saveDocument } from "../documents/actions";
import { getCodeFileForTab, saveCodeFile } from "../code/actions";
import { getSheetForTab, saveSheet } from "../sheets/actions";
import { getMindMapForTab, saveMindMap } from "../mindmap/actions";
import { searchPapersAndCode } from "@/lib/paper-code-search";

// ============================================================================
// Sophia 도구 사용(function calling) — NVIDIA NIM 의 OpenAI 호환 tools API 로
// 호출된다. 모든 구현체는 요청자의 쿠키 기반 supabase 클라이언트(RLS 적용)를
// 그대로 쓰는 기존 서버 액션을 재사용하므로, Sophia 는 사용자 본인이 보거나
// 고칠 권한이 있는 항목만 건드릴 수 있다 — 권한 우회 경로가 없다.
// ============================================================================

const READ_CHAR_LIMIT = 6000;
/** Realtime 브로드캐스트 페이로드 한도(base64 기준 여유 있게). */
const MAX_BROADCAST_CHARS = 180_000;

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
              "Name of the Code Space to put this in. Created if it doesn't exist. Defaults to 'Sophia'.",
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
      name: "update_sheet",
      description:
        "Replace the contents of an existing sheet the user can edit, from CSV text. Read it first with read_sheet if you only mean to change part of it — this overwrites the whole sheet.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Sheet UUID." },
          csv: { type: "string", description: "Full CSV for the sheet, first row is the header." },
        },
        required: ["id", "csv"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_mindmap",
      description:
        "Replace the branches of an existing mind map the user can edit, from an indented outline. Same format read_mindmap returns, so read it first, change what you need, and send the whole outline back. Don't repeat the root/title line.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Mind map UUID." },
          outline: {
            type: "string",
            description: "Indented outline of the top-level branches (excluding the root/title).",
          },
        },
        required: ["id", "outline"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_repositories",
      description:
        "List the user's repositories and Code Spaces. A repository groups docs/sheets/link graphs/files; a Code Space holds code files. Use this to find what to work in.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_repository",
      description:
        "List what is inside a repository or Code Space — every item with its kind and id, so you can read or edit them.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Repository or Code Space UUID." },
          kind: {
            type: "string",
            enum: ["repository", "code_space"],
            description: "Which of the two the id refers to.",
          },
        },
        required: ["id", "kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_papers_and_code",
      description: "Search external academic papers (OpenAlex, Semantic Scholar) and public GitHub code.",
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

/**
 * 시트 전체를 CSV 로 교체한다.
 *
 * yjs_state 를 비우는 이유: 에디터는 스냅샷이 있으면 data 보다 그걸 우선하므로
 * 그냥 두면 이 수정이 화면에 안 나타난다. 시트의 Yjs 구조를 서버에서 정확히
 * 재구성하는 것도 가능하지만(lib/sheet-yjs.ts 는 순수 모듈), 여기서는 통째
 * 교체라 스냅샷을 비우고 에디터가 data 에서 다시 시드하게 하는 편이 단순하다.
 */
async function toolUpdateSheet(args: { id?: string; csv?: string }): Promise<ToolResult> {
  const id = String(args.id ?? "");
  const sheet = await getSheetForTab(id);
  if (!sheet) return { error: "Not found, or you don't have access to it." };
  if (!sheet.canEdit) return { error: "You don't have edit access to this sheet." };

  let imported;
  try {
    imported = await importFileToSheetData(
      `${sheet.title || "sheet"}.csv`,
      Buffer.from(String(args.csv ?? ""), "utf-8")
    );
  } catch {
    return { error: "Could not parse that CSV." };
  }

  const res = await saveSheet(id, sheet.title, imported.data, null);
  if (!res.ok) return { error: res.error };
  return { ok: true };
}

/** 마인드맵의 가지를 아웃라인으로 교체한다. 스냅샷 처리는 시트와 같은 이유. */
async function toolUpdateMindmap(args: { id?: string; outline?: string }): Promise<ToolResult> {
  const id = String(args.id ?? "");
  const map = await getMindMapForTab(id);
  if (!map) return { error: "Not found, or you don't have access to it." };
  if (!map.canEdit) return { error: "You don't have edit access to this mind map." };

  const cells = outlineTextToSheetCells(String(args.outline ?? ""));
  const result = sheetRowsToMindmapData(cells, map.title);
  if ("error" in result) return { error: result.error };

  const res = await saveMindMap(
    id,
    map.title,
    { nodeData: result.nodeData, arrows: [] } as unknown as Json,
    null
  );
  if (!res.ok) return { error: res.error };
  return { ok: true };
}

/** 저장소와 Code Space 목록 — 어시스턴트가 "어디에서" 일할지 고를 수 있게. */
async function toolListRepositories(): Promise<ToolResult> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const [repos, spaces] = await Promise.all([
    supabase.from("repositories").select("id, name").eq("owner_id", userId),
    supabase
      .from("code_repositories")
      .select("id, name, github_owner, github_repo")
      .is("deleted_at", null)
      .eq("owner_id", userId),
  ]);
  return {
    repositories: (repos.data ?? []).map((r) => ({ id: r.id, name: r.name })),
    code_spaces: (spaces.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      github: c.github_owner ? `${c.github_owner}/${c.github_repo}` : null,
    })),
  };
}

/** 저장소/Code Space 안의 항목을 종류·id 와 함께 돌려준다. */
async function toolReadRepository(args: { id?: string; kind?: string }): Promise<ToolResult> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const id = String(args.id ?? "");
  if (!id) return { error: "Give the repository id." };

  if (args.kind === "code_space") {
    const { data: space } = await supabase
      .from("code_repositories")
      .select("id, name")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!space) return { error: "Code Space not found, or you don't have access to it." };
    const { data: files } = await supabase
      .from("code_files")
      .select("id, path, language")
      .eq("code_repository_id", id)
      .is("deleted_at", null)
      .order("path");
    return {
      code_space: space.name,
      files: (files ?? []).map((f) => ({ id: f.id, path: f.path, language: f.language })),
    };
  }

  const { data: repo } = await supabase
    .from("repositories")
    .select("id, name")
    .eq("id", id)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!repo) return { error: "Repository not found, or you don't have access to it." };

  // 하나의 저장소에 여러 종류가 섞여 있다 — 종류별로 모아 돌려준다.
  const [docs, sheets, maps, files] = await Promise.all([
    supabase.from("documents").select("id, title").eq("repository_id", id).is("deleted_at", null),
    supabase.from("sheets").select("id, title").eq("repository_id", id).is("deleted_at", null),
    supabase.from("mind_maps").select("id, title").eq("repository_id", id).is("deleted_at", null),
    supabase.from("files").select("id, file_name").eq("repository_id", id).is("deleted_at", null),
  ]);
  return {
    repository: repo.name,
    documents: (docs.data ?? []).map((d) => ({ id: d.id, title: d.title })),
    sheets: (sheets.data ?? []).map((x) => ({ id: x.id, title: x.title })),
    mindmaps: (maps.data ?? []).map((m) => ({ id: m.id, title: m.title })),
    files: (files.data ?? []).map((f) => ({ id: f.id, name: f.file_name })),
  };
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

  // yjs_state 를 반드시 비운다. 에디터는 스냅샷이 있으면 본문보다 그걸 우선하므로,
  // 그냥 두면 어시스턴트가 고쳐도 문서를 열었을 때 예전 내용이 보인다(실제로
  // 문서 14개 중 12개가 스냅샷을 갖고 있어 이 수정이 거의 항상 무시됐다).
  // 문서의 Yjs 구조는 Tiptap/ProseMirror 라 서버에서 재구성할 수 없어(y-prosemirror
  // 미설치) 비우는 쪽을 택한다 — 그러면 에디터가 본문에서 다시 시드한다.
  const res = await saveDocument(id, doc.title, newContent, null);
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

  // 코드의 Yjs 구조는 단순 Y.Text 라 서버에서 이전 스냅샷 위에 최소 델타를
  // 얹을 수 있다 — 그러면 이 파일을 열어 둔 사람의 협업 이력이 살아 있고,
  // 증분 업데이트를 브로드캐스트하면 화면에도 바로 반영된다.
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("code_files")
    .select("yjs_state")
    .eq("id", id)
    .single();
  const merged = mergeContentIntoSnapshot(row?.yjs_state ?? null, newContent);

  const res = await saveCodeFile(id, file.name, file.language, newContent, merged.snapshot);
  if (!res.ok) return { error: res.error };

  if (merged.update && merged.update.length <= MAX_BROADCAST_CHARS) {
    await supabase
      .rpc("broadcast_code_yupdate", { p_file_id: id, p_update: merged.update })
      .then(
        () => {},
        () => {} // 알림 실패가 저장을 되돌리면 안 된다.
      );
  }
  return { ok: true };
}

async function toolSearchPapersAndCode(args: { query?: string }): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return { error: "query is required." };
  const res = await searchPapersAndCode(query);
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
  update_sheet: toolUpdateSheet,
  update_mindmap: toolUpdateMindmap,
  list_repositories: toolListRepositories,
  read_repository: toolReadRepository,
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
