import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { SOPHIA_TOOLS, executeSophiaTool } from "@/app/(app)/sophia/tools";
import { runBigBrotherGemini, toGeminiTools } from "@/lib/big-brother-gemini";
import { runBigBrotherClaude, toClaudeTools } from "@/lib/big-brother-claude";
import { bbModel, DEFAULT_BB_MODEL } from "@/lib/big-brother-models";

// ============================================================================
// 팀/1:1 채팅에서 @bigbrother 로 부를 때만 도는 경로.
//
// 답변은 chat_messages 에 봇 메시지로 저장한다 — 기존 fanout 트리거가 멤버
// 전원에게 브로드캐스트하므로, 클라이언트는 평소처럼 실시간으로 받는다.
// 그래서 이 요청을 기다릴 필요가 없고, 창을 옮겨도 답이 도착한다.
//
// 대화 전체를 모델에 넘기지 않는다 — 호출된 메시지와 직전 맥락만 보낸다.
// 팀 채팅 전문을 외부 모델로 보내는 것은 기본값이 되어선 안 된다.
// ============================================================================

export const maxDuration = 60;

/** 모델에 넘길 직전 대화 길이. 전체가 아니라 맥락만. */
const CONTEXT_MESSAGES = 20;
const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_RESULT_CHARS = 6_000;
const REQUEST_BUDGET_MS = 50_000;

const CHAT_SYSTEM = `You are Big Brother, taking part in a team chat inside Possion.

You were invoked with @bigbrother. Answer that request, then stop. You are a
participant, not the host: do not summarize the conversation unless asked, do not
greet the room, and do not address people who did not call you.

Write plainly and briefly — this is a chat window, so a couple of sentences beat
a formatted report. Do not use emoji. Do not open with filler or close with an
offer of further help. Use a list only for a genuinely enumerable answer.

You can see the recent messages for context, and the names attached to them. You
have the workspace tools; use them when the answer depends on something in the
workspace rather than guessing. Before you change or create anything, say what
you are about to do — several people share this conversation and an unannounced
edit is worse here than in a private chat.`;

export async function POST(request: NextRequest) {
  await requireUser();

  let body: { conversationId?: string; model?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const conversationId = body.conversationId;
  if (!conversationId) {
    return NextResponse.json({ error: "No conversation given." }, { status: 400 });
  }

  const supabase = await createClient();

  // RLS 가 남의 대화를 걸러주지만, 봇이 켜져 있는지는 여기서 확인한다.
  const { data: conv } = await supabase
    .from("chat_conversations")
    .select("id, bigbrother_enabled")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  if (!conv.bigbrother_enabled) {
    return NextResponse.json(
      { error: "Big Brother is not in this conversation." },
      { status: 403 }
    );
  }

  const { data: rows } = await supabase.rpc("get_chat_messages", {
    p_conversation: conversationId,
    p_limit: CONTEXT_MESSAGES,
  });
  // get_chat_messages 는 최신순이라 뒤집어 시간순으로 만든다.
  const recent = [...(rows ?? [])].reverse();
  if (recent.length === 0) {
    return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });
  }

  // 화자 이름을 붙여 한 덩어리로 넘긴다 — 누가 무엇을 말했는지가 팀 대화에서는
  // 내용만큼 중요하다. 봇 자신의 과거 답변은 assistant 턴으로 넘긴다.
  const history = recent.map((m) => ({
    role: m.is_bot ? "assistant" : "user",
    content: m.is_bot ? m.content : `${m.sender_name}: ${m.content}`,
  }));

  const chosen = bbModel(body.model) ?? bbModel(DEFAULT_BB_MODEL);
  const deadline = Date.now() + REQUEST_BUDGET_MS;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const claudeKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;

  let text = "";
  let error: string | undefined;

  try {
    if (chosen?.provider === "claude" && claudeKey) {
      const res = await runBigBrotherClaude({
        apiKey: claudeKey,
        model: chosen.id,
        system: CHAT_SYSTEM,
        history,
        tools: toClaudeTools(SOPHIA_TOOLS),
        execute: (name, args) => executeSophiaTool(name, args),
        forward: () => {},
        maxRounds: MAX_TOOL_ROUNDS,
        maxHistoryTurns: CONTEXT_MESSAGES,
        maxToolResultChars: MAX_TOOL_RESULT_CHARS,
        deadline,
      });
      text = res.text;
      error = res.error;
    } else if (geminiKey) {
      const res = await runBigBrotherGemini({
        apiKey: geminiKey,
        model: chosen?.provider === "gemini" ? chosen.id : undefined,
        system: CHAT_SYSTEM,
        history,
        tools: toGeminiTools(SOPHIA_TOOLS),
        execute: (name, args) => executeSophiaTool(name, args),
        forward: () => {},
        maxRounds: MAX_TOOL_ROUNDS,
        maxHistoryTurns: CONTEXT_MESSAGES,
        maxToolResultChars: MAX_TOOL_RESULT_CHARS,
        deadline,
      });
      text = res.text;
      error = res.error;
    } else {
      error = "No model key is configured on the server.";
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Big Brother failed.";
  }

  // 실패해도 채팅에 남긴다 — 부른 사람이 아무 반응도 못 받는 게 최악이다.
  const content = text.trim() || error || "I couldn't produce an answer.";
  const { error: postErr } = await supabase.rpc("post_bigbrother_message", {
    p_conversation: conversationId,
    p_content: content.slice(0, 8000),
  });
  if (postErr) {
    return NextResponse.json({ error: "Could not post the reply." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
