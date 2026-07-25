import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { detectLanguage } from "@/lib/languages";
import {
  AGENT_MODELS,
  buildSources,
  startTurn,
  pollTurn,
  type CommitHandlers,
  type MountFile,
} from "@/lib/antigravity";

// ============================================================================
// Code Space 단위 Antigravity 세션.
//
// action=start  첫 턴이면 Code Space 전체를 원격 샌드박스에 마운트하고 에이전트를
//               background 로 띄운다. 이어가는 턴이면 기존 환경을 재사용한다.
// action=poll   진행 상황을 한 번 확인한다. 에이전트가 도구를 기다리고 있으면
//               여기서 파일을 DB 에 쓰고 다음 interaction 을 띄운다.
//
// 에이전트 실행은 몇 분이 걸릴 수 있어서 한 요청에 다 태우면 서버리스 함수
// 타임아웃에 걸린다. 그래서 두 단계로 쪼갠다 — 요청 하나는 항상 짧게 끝난다.
// ============================================================================

export const maxDuration = 60;

type Body = {
  action?: "start" | "poll";
  spaceId?: string;
  input?: string;
  interactionId?: string;
  previousInteractionId?: string;
  environmentId?: string;
  model?: string;
};

export async function POST(request: NextRequest) {
  const { userId } = await requireUser();

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "No Gemini API key configured on the server." },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const spaceId = body.spaceId;
  if (!spaceId) return NextResponse.json({ error: "No Code Space given." }, { status: 400 });

  const model = AGENT_MODELS.includes(body.model as (typeof AGENT_MODELS)[number])
    ? (body.model as string)
    : AGENT_MODELS[0];

  const supabase = await createClient();

  // RLS 가 남의 것을 걸러주지만, 에이전트는 소유자만 돌릴 수 있게 한 번 더 막는다.
  const { data: space } = await supabase
    .from("code_repositories")
    .select("id, owner_id")
    .eq("id", spaceId)
    .single();
  if (!space) return NextResponse.json({ error: "Code Space not found." }, { status: 404 });
  if (space.owner_id !== userId) {
    return NextResponse.json({ error: "Not your Code Space." }, { status: 403 });
  }

  const pathKey = (p: string) => p.replace(/^\/+/, "").replace(/^workspace\//, "");

  const handlers: CommitHandlers = {
    async commit(files) {
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
        // 남겨두면 새로 쓴 content 가 파일을 열었을 때 안 보인다.
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

    async remove(paths) {
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

  try {
    // ---- 폴링 ----
    if (body.action === "poll") {
      if (!body.interactionId) {
        return NextResponse.json({ error: "No interaction to poll." }, { status: 400 });
      }
      const res = await pollTurn({
        apiKey,
        interactionId: body.interactionId,
        model,
        environmentId: body.environmentId,
        handlers,
      });
      return NextResponse.json(res);
    }

    // ---- 시작 ----
    const input = (body.input ?? "").trim();
    if (!input) return NextResponse.json({ error: "Nothing to send." }, { status: 400 });

    const resuming = Boolean(body.environmentId && body.previousInteractionId);
    let sources: { type: "inline"; content: string; target: string }[] | undefined;
    let skipped: string[] = [];
    let mountedCount = 0;

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
      skipped.length === 0
        ? input
        : `${input}\n\n[Note: these files were too large to mount and are not in /workspace: ${skipped
            .slice(0, 20)
            .join(", ")}]`;

    const started = await startTurn({
      apiKey,
      input: prompt,
      model,
      sources,
      previousInteractionId: body.previousInteractionId,
      environmentId: body.environmentId,
    });
    return NextResponse.json({ ...started, model, mountedCount, skipped });
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
    if (/NOT_FOUND|not found|unsupported|is not available/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "The Antigravity agent is not available on this API key — it is in preview. " +
            msg.slice(0, 200),
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: `Agent request failed: ${msg.slice(0, 200)}` },
      { status: 502 }
    );
  }
}
