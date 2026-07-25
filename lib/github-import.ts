"use client";

// ============================================================================
// GitHub 저장소 가져오기 — 브라우저에서 직접 수행한다.
//
// 왜 서버(Vercel)가 아니라 브라우저인가: Vercel 서버리스 함수는 최대 60초에
// 메모리 제한이 있어 파일이 수백 개인 저장소에서 죽는다. 브라우저는 시간 제한이
// 없고 진행률도 그대로 보여줄 수 있다.
//
// 왜 zip 한 번에 안 받는가: codeload.github.com(zipball) 은
// `access-control-allow-origin: https://render.githubusercontent.com` 만 주므로
// 우리 오리진에서는 CORS 로 막힌다(실측). 대신 아래 두 엔드포인트를 쓴다.
//
//   1) api.github.com/.../git/trees/{ref}?recursive=1  — CORS `*`, 호출 "1회"
//   2) raw.githubusercontent.com/...                   — CORS `*`, API 레이트
//                                                        리밋에 걸리지 않음
//
// 덕분에 비인증 60회/시간 한도 안에서도(트리 1회만 소모) 파일 수와 무관하게
// 가져올 수 있다.
// ============================================================================

/** 텍스트로 저장할 가치가 있는 확장자만 가져온다(바이너리 방지). */
const TEXT_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "mdx", "txt",
  "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs",
  "php", "sh", "bash", "zsh", "sql", "html", "htm", "css", "scss", "sass", "less",
  "xml", "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "gitignore",
  "dockerfile", "makefile", "lock", "gradle", "properties", "vue", "svelte",
]);

/** 소스와 무관한 경로는 통째로 건너뛴다 — 안 그러면 수천 개가 딸려 온다. */
const SKIP_DIR = [
  "node_modules/", ".git/", "dist/", "build/", "out/", ".next/", "target/",
  "vendor/", "__pycache__/", ".venv/", "venv/", "coverage/", ".cache/",
  "site-packages/", ".turbo/", ".idea/", ".vscode/",
];

/** 한 파일 최대 크기 — 미니파이 번들·거대 lock 파일이 들어오는 것을 막는다. */
const MAX_FILE_BYTES = 200 * 1024;
/** 한 번에 가져올 파일 수 상한 — 초대형 모노레포 방어. */
export const MAX_FILES = 600;

export type GitHubRef = { owner: string; repo: string; ref: string };

/** 다양한 형태의 GitHub URL/식별자에서 owner/repo/ref 를 뽑는다. */
export function parseGitHubUrl(input: string): GitHubRef | null {
  const s = input.trim().replace(/\.git$/, "");
  // https://github.com/owner/repo(/tree/branch)
  const m = s.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)(?:\/tree\/([^\s]+))?/i
  );
  if (m) return { owner: m[1], repo: m[2], ref: m[3] || "" };
  // owner/repo 짧은 형태
  const short = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (short) return { owner: short[1], repo: short[2], ref: "" };
  return null;
}

function shouldSkip(path: string): boolean {
  const lower = path.toLowerCase();
  if (SKIP_DIR.some((d) => lower.includes(d))) return true;
  const base = lower.split("/").pop() ?? "";
  // 확장자 없는 관례적 텍스트 파일(Dockerfile, Makefile ...)은 허용한다.
  if (!base.includes(".")) return !TEXT_EXT.has(base);
  const ext = base.split(".").pop() ?? "";
  return !TEXT_EXT.has(ext);
}

type TreeEntry = { path: string; type: string; size?: number };

/** 저장소의 기본 브랜치를 조회한다(ref 를 지정하지 않은 경우). */
async function defaultBranch(r: GitHubRef, token?: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${r.owner}/${r.repo}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(githubError(res.status, "repository"));
  const json = (await res.json()) as { default_branch?: string };
  return json.default_branch || "main";
}

function githubError(status: number, what: string): string {
  if (status === 404) return `Not found — check the URL, or the ${what} may be private (add a token).`;
  if (status === 401 || status === 403)
    return "GitHub refused the request — the repo may be private, or you hit the unauthenticated rate limit (60/hour). Add a personal access token.";
  return `GitHub returned ${status}.`;
}

export type ImportPlan = {
  ref: GitHubRef;
  files: { path: string; size: number }[];
  truncated: boolean;
  skipped: number;
};

/** 1단계 — 가져올 파일 목록을 만든다(API 호출 1~2회). */
export async function planImport(input: string, token?: string): Promise<ImportPlan> {
  const parsed = parseGitHubUrl(input);
  if (!parsed) throw new Error("That doesn't look like a GitHub repository URL.");
  const ref = parsed.ref || (await defaultBranch(parsed, token));

  const res = await fetch(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers: token ? { authorization: `Bearer ${token}` } : undefined }
  );
  if (!res.ok) throw new Error(githubError(res.status, "branch"));
  const json = (await res.json()) as { tree?: TreeEntry[]; truncated?: boolean };

  const all = (json.tree ?? []).filter((e) => e.type === "blob");
  const kept: { path: string; size: number }[] = [];
  let skipped = 0;
  for (const e of all) {
    if (shouldSkip(e.path) || (e.size ?? 0) > MAX_FILE_BYTES) {
      skipped++;
      continue;
    }
    kept.push({ path: e.path, size: e.size ?? 0 });
  }
  kept.sort((a, b) => a.path.localeCompare(b.path));

  return {
    ref: { ...parsed, ref },
    files: kept.slice(0, MAX_FILES),
    // 트리 API 자체가 잘렸거나, 우리 상한을 넘긴 경우 둘 다 "일부만"이다.
    truncated: !!json.truncated || kept.length > MAX_FILES,
    skipped,
  };
}

/** 2단계 — 파일 내용을 CDN 에서 받는다(레이트 리밋 없음). */
export async function fetchFile(
  ref: GitHubRef,
  path: string,
  token?: string
): Promise<string> {
  const url = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${ref.ref}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const res = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`Failed to fetch ${path} (${res.status})`);
  return res.text();
}
