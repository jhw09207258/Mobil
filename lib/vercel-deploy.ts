// ============================================================================
// Code Space → Vercel 배포.
//
// 파일을 먼저 업로드하고 sha 로 참조하는 방식도 있지만, 인라인이 요청 한 번으로
// 끝나므로 텍스트 소스만 다루는 우리에게는 그쪽이 맞다.
//
// skipAutoDetectionConfirmation=1 이 없으면 Vercel 이 감지한 프레임워크가
// 프로젝트 설정과 다를 때 400 으로 확인을 요구한다 — 자동화에서는 막힌다.
// ============================================================================

const API = "https://api.vercel.com";

/** 인라인 배포 요청 하나에 담는 총 내용 상한. */
const MAX_DEPLOY_BYTES = 8_000_000;

export type DeployFile = { path: string; content: string };

export type DeployResult = {
  id: string;
  url: string;
  inspectorUrl: string | null;
  status: string;
  fileCount: number;
};

/** 토큰 확인 + 계정명. */
export async function vercelWhoami(token: string): Promise<{ username: string }> {
  const res = await fetch(`${API}/v2/user`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("That Vercel token was rejected.");
  const body = await res.json();
  return { username: body.user?.username ?? body.user?.email ?? "unknown" };
}

/** Vercel 프로젝트명 규칙: 소문자·숫자·하이픈, 100자 이내. */
export function toProjectName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 100);
  return slug || "possion-code-space";
}

export async function deployToVercel(opts: {
  token: string;
  name: string;
  files: DeployFile[];
  teamId?: string | null;
  production?: boolean;
}): Promise<DeployResult> {
  if (opts.files.length === 0) throw new Error("This Code Space has no files to deploy.");
  // 파일을 인라인으로 싣기 때문에 요청 본문이 전체 소스 크기만큼 커진다.
  const totalBytes = opts.files.reduce((n, f) => n + f.content.length, 0);
  if (totalBytes > MAX_DEPLOY_BYTES) {
    throw new Error(
      `This Code Space is too large to deploy inline (${Math.round(
        totalBytes / 1_000_000
      )} MB, limit ${MAX_DEPLOY_BYTES / 1_000_000} MB).`
    );
  }

  const qs = new URLSearchParams({ skipAutoDetectionConfirmation: "1", forceNew: "1" });
  if (opts.teamId) qs.set("teamId", opts.teamId);

  const res = await fetch(`${API}/v13/deployments?${qs}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: opts.name,
      files: opts.files.map((f) => ({
        file: f.path,
        data: f.content,
        encoding: "utf-8",
      })),
      target: opts.production === false ? undefined : "production",
      // null 은 "자동 감지" — Next/Vite 등을 Vercel 이 알아서 고른다.
      projectSettings: { framework: null },
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || `HTTP ${res.status}`;
    throw new Error(`Vercel rejected the deployment: ${msg}`);
  }

  return {
    id: body.id,
    url: body.url ? `https://${body.url}` : "",
    inspectorUrl: body.inspectorUrl ?? null,
    status: body.readyState ?? body.status ?? "QUEUED",
    fileCount: opts.files.length,
  };
}
