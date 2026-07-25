import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { detectLanguage } from "@/lib/languages";
import {
  AGENT_MODELS,
  buildSources,
  runAgentTurn,
  type MountFile,
} from "@/lib/antigravity";

// ============================================================================
// Code Space 단위 Antigravity 세션.
//
// 첫 요청은 Code Space 의 모든 파일을 원격 샌드박스에 마운트하고 환경 ID 를
// 돌려준다. 이어지는 요청은 그 환경 + previous_interaction_id 로 같은 세션을
// 계속하므로, 에이전트는 앞서 한 작업과 샌드박스 상태를 그대로 기억한다.
// ============================================================================

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const { userId } = await requireUser();

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "No Gemini API key configured on the server." },
      { status: 503 }
    );
  }

  let body: {
    spaceId?: string;
    input?: string;
    previousInteractionId?: string;
    environmentId?: string;
    model?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const spaceId = body.spaceId;
  const input = (body.input ?? "").trim();
  if (!spaceId) return NextResponse.json({ error: "No Code Space given." }, { status: 400 });
  if (!input) return NextResponse.json({ error: "Nothing to send." }, { status: 400 });

  const model = AGENT_MODELS.includes(body.model as (typeof AGENT_MODELS)[number])
    ? (body.model as string)
    : AGENT_MODELS[0];

  const supabase = await createClient();

  // RLS 가 남의 Code Space 를 걸러주지만, 소유자만 에이전트를 돌릴 수 있게 한 번 더 확인한다.
  const { data: space } = await supabase
    .from("code_repositories")
    .select("id, name, owner_id")
    .eq("id", spaceId)
    .single();
  if (!space) return NextResponse.json({ error: "Code Space not found." }, { status: 404 });
  if (space.owner_id !== userId) {
    return NextResponse.json({ error: "Not your Code Space." }, { status: 403 });
  }

  // ---- 파일을 DB 에 쓰는 도구 구현 ----
  const pathKey = (p: string) => p.replace(/^\/+/, "").replace(/^workspace\//, "");

  const handlers = {
    async commit(files: MountFile[]) {
      const saved: string[] = [];
      const failed: string[] = [];
      for (const f of files) {
        const path = pathKey(f.path);
        if (!path || typeof f.content !== "string") {
          failed.push(f.path);
          continue;
        }
        const name = path.split("/").pop() || "untitled";
        const { data: existing } = await supabase
          .from("code_files")
          .select("id")
          .eq("code_repository_id", spaceId)
          .eq("path", path)
          .maybeSingle();

        // yjs_state 를 반드시 지운다 — 에디터는 스냅샷이 있으면 그걸 우선하므로,
        // 남겨두면 새로 쓴 content 가 화면에 안 나타난다.
        const { error } = existing
          ? await supabase
              .from("code_files")
              .update({ content: f.content, yjs_state: null, language: detectLanguage(name) })
              .eq("id", existing.id)
          : await supabase.from("code_files").insert({
              owner_id: userId,
              name,
              path,
              language: detectLanguage(name),
              content: f.content,
              code_repository_id: spaceId,
            });
        if (error) failed.push(path);
        else saved.push(path);
      }
      return { saved, failed };
    },

    async remove(paths: string[]) {
      const deleted: string[] = [];
      for (const raw of paths) {
        const path = pathKey(raw);
        const { data: file } = await supabase
          .from("code_files")
          .select("id")
          .eq("code_repository_id", spaceId)
          .eq("path", path)
          .maybeSingle();
        if (!file) continue;
        await supabase.rpc("move_to_trash", { p_kind: "code", p_id: file.id });
        deleted.push(path);
      }
      return { deleted };
    },
  };

  // ---- 첫 턴이면 Code Space 전체를 마운트 ----
  let sources: { type: "inline"; content: string; target: string }[] | undefined;
  let skipped: string[] = [];
  let mountedCount = 0;
  const resuming = Boolean(body.environmentId && body.previousInteractionId);

  if (!resuming) {
    const { data: files } = await supabase
      .from("code_files")
      .select("path, name, content")
      .eq("code_repository_id", spaceId);
    const mount: MountFile[] = (files ?? []).map((f) => ({
      path: pathKey(f.path || f.name || "untitled"),
      content: f.content ?? "",
    }));
    const built = buildSources(mount);
    sources = built.sources;
    skipped = built.skipped;
    mountedCount = built.sources.length;
  }

  const prompt =
    resuming || skipped.length === 0
      ? input
      : `${input}\n\n[Note: these files were too large to mount and are not in /workspace: ${skipped
          .slice(0, 20)
          .join(", ")}]`;

  try {
    const result = await runAgentTurn({
      apiKey,
      input: prompt,
      model,
      sources,
      previousInteractionId: body.previousInteractionId,
      environmentId: body.environmentId,
      handlers,
    });
    return NextResponse.json({ ...result, model, mountedCount, skipped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/API_KEY|api key|PERMISSION_DENIED/i.test(msg)) {
      return NextResponse.json({ error: "The Gemini API key was rejected." }, { status: 401 });
    }
    if (/RESOURCE_EXHAUSTED|quota|429/i.test(msg)) {
      return NextResponse.json(
        { error: "Gemini quota or rate limit reached — try again shortly." },
        { status: 429 }
      );
    }
    if (/not found|unsupported|INVALID_ARGUMENT/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "The Antigravity agent rejected this request. It is in preview — your API key's project may not have access yet. Details: " +
            msg.slice(0, 200),
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: `Agent request failed: ${msg.slice(0, 200)}` }, { status: 502 });
  }
}
