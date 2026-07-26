"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { Json } from "@/lib/database.types";

// Agent 실행 기록 — 브라우저를 닫아도 무엇을 시켰고 무엇을 했는지가 남고,
// 다시 들어오면 콘솔이 그 자리에서 이어진다.

export type StoredRun = {
  lines: unknown[];
  interactionId: string | null;
  environmentId: string | null;
  model: string | null;
  turns: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  status: string;
};

export async function loadRun(spaceId: string): Promise<StoredRun | null> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("agent_runs")
    .select(
      "lines, interaction_id, environment_id, model, turns, total_tokens, input_tokens, output_tokens, status"
    )
    .eq("space_id", spaceId)
    .maybeSingle();
  if (!data) return null;
  return {
    lines: Array.isArray(data.lines) ? (data.lines as unknown[]) : [],
    interactionId: data.interaction_id,
    environmentId: data.environment_id,
    model: data.model,
    turns: data.turns,
    totalTokens: Number(data.total_tokens),
    inputTokens: Number(data.input_tokens),
    outputTokens: Number(data.output_tokens),
    status: data.status,
  };
}

export async function saveRun(input: {
  spaceId: string;
  lines: unknown[];
  interactionId?: string | null;
  environmentId?: string | null;
  model?: string | null;
  turns: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  status: string;
}): Promise<void> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  // 콘솔이 길어지면 행이 계속 커진다 — 최근 400줄만 남긴다.
  const lines = input.lines.slice(-400);
  await supabase.from("agent_runs").upsert(
    {
      space_id: input.spaceId,
      owner_id: userId,
      lines: lines as unknown as Json,
      interaction_id: input.interactionId ?? null,
      environment_id: input.environmentId ?? null,
      model: input.model ?? null,
      turns: input.turns,
      total_tokens: input.totalTokens,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      status: input.status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "space_id" }
  );
}
