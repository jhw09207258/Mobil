"use server";

import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser as requireUser } from "@/lib/auth";
import { pushToGitHub, whoami } from "@/lib/github-push";
import { deployToVercel, toProjectName, vercelWhoami } from "@/lib/vercel-deploy";

// ============================================================================
// Code Space 내보내기 — GitHub 푸시 / Vercel 배포 / 연동 토큰 관리.
//
// 토큰은 절대 클라이언트로 돌려주지 않는다. 상태 조회는 연결 여부와 계정명,
// 끝 4자리만 준다.
// ============================================================================

export type Provider = "github" | "vercel" | "supabase";

export type IntegrationStatus = {
  provider: Provider;
  connected: boolean;
  account: string | null;
  tokenTail: string | null;
  meta: Record<string, unknown>;
};

export async function getIntegrations(): Promise<IntegrationStatus[]> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_integrations")
    .select("provider, token, account, meta")
    .eq("user_id", userId);

  const byProvider = new Map((data ?? []).map((r) => [r.provider, r]));
  return (["github", "vercel", "supabase"] as Provider[]).map((p) => {
    const row = byProvider.get(p);
    return {
      provider: p,
      connected: !!row,
      account: row?.account ?? null,
      tokenTail: row ? `…${String(row.token).slice(-4)}` : null,
      meta: (row?.meta as Record<string, unknown>) ?? {},
    };
  });
}

/** 토큰을 저장하기 전에 실제로 찔러서 유효한지 확인한다. */
export async function connectIntegration(
  provider: Provider,
  token: string,
  meta?: Record<string, unknown>
): Promise<{ ok: true; account: string } | { error: string }> {
  const { userId } = await requireUser();
  const trimmed = token.trim();
  if (!trimmed) return { error: "Paste a token first." };

  let account = "";
  try {
    if (provider === "github") account = (await whoami(trimmed)).login;
    else if (provider === "vercel") account = (await vercelWhoami(trimmed)).username;
    else account = String(meta?.projectRef ?? "supabase");
  } catch (e) {
    return { error: e instanceof Error ? e.message : "That token was rejected." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("user_integrations").upsert(
    {
      user_id: userId,
      provider,
      token: trimmed,
      account,
      meta: (meta ?? {}) as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" }
  );
  if (error) return { error: "Could not save the connection." };
  return { ok: true, account };
}

export async function disconnectIntegration(
  provider: Provider
): Promise<{ ok: true } | { error: string }> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_integrations")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);
  if (error) return { error: "Could not remove the connection." };
  return { ok: true };
}

async function loadToken(provider: Provider): Promise<string | null> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_integrations")
    .select("token")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  return data?.token ?? null;
}

/** Code Space 의 모든 파일을 경로와 함께 읽는다. */
async function loadSpaceFiles(
  spaceId: string
): Promise<{ files: { path: string; content: string }[]; ownerOk: boolean }> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const { data: space } = await supabase
    .from("code_repositories")
    .select("owner_id")
    .eq("id", spaceId)
    .single();
  if (!space || space.owner_id !== userId) return { files: [], ownerOk: false };

  const { data } = await supabase
    .from("code_files")
    .select("path, name, content")
    .eq("code_repository_id", spaceId);
  const files = (data ?? [])
    .map((f) => ({
      path: (f.path || f.name || "").replace(/^\/+/, ""),
      content: f.content ?? "",
    }))
    .filter((f) => f.path);
  return { files, ownerOk: true };
}

export async function pushSpaceToGitHub(opts: {
  spaceId: string;
  repo: string;
  message?: string;
  private?: boolean;
}): Promise<
  { ok: true; url: string; commitSha: string; fileCount: number; created: boolean } | { error: string }
> {
  const token = await loadToken("github");
  if (!token) return { error: "Connect a GitHub token first." };

  const { files, ownerOk } = await loadSpaceFiles(opts.spaceId);
  if (!ownerOk) return { error: "Not your Code Space." };
  if (files.length === 0) return { error: "This Code Space has no files to push." };

  try {
    const res = await pushToGitHub({
      token,
      repo: opts.repo.trim(),
      message: opts.message?.trim() || "Update from Possion",
      files,
      private: opts.private ?? true,
    });
    const supabase = await createClient();
    await supabase
      .from("code_repositories")
      .update({
        github_owner: res.owner,
        github_repo: res.repo,
        github_ref: res.branch,
        github_pushed_at: new Date().toISOString(),
      })
      .eq("id", opts.spaceId);
    return {
      ok: true,
      url: res.url,
      commitSha: res.commitSha,
      fileCount: res.fileCount,
      created: res.created,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The push failed." };
  }
}

export async function deploySpaceToVercel(opts: {
  spaceId: string;
  name: string;
}): Promise<{ ok: true; url: string; inspectorUrl: string | null; status: string } | { error: string }> {
  const token = await loadToken("vercel");
  if (!token) return { error: "Connect a Vercel token first." };

  const { files, ownerOk } = await loadSpaceFiles(opts.spaceId);
  if (!ownerOk) return { error: "Not your Code Space." };

  try {
    const res = await deployToVercel({
      token,
      name: toProjectName(opts.name),
      files,
    });
    return { ok: true, url: res.url, inspectorUrl: res.inspectorUrl, status: res.status };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The deployment failed." };
  }
}
