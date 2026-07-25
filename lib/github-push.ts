// ============================================================================
// Code Space → GitHub 저장소.
//
// 파일마다 blob 을 만들면 요청이 파일 수만큼 필요해서(600 파일 = 600 요청)
// 서버리스 함수 시간 안에 못 끝낸다. Trees API 는 blob sha 대신 content 를
// 인라인으로 받으므로 트리 생성 한 번이면 된다.
//
// base_tree 를 일부러 안 쓴다 — Code Space 를 그대로 반영해야 하므로,
// 여기서 지운 파일은 GitHub 에서도 사라져야 한다.
// ============================================================================

const API = "https://api.github.com";

/** 트리 생성 요청 하나에 담는 총 내용 상한. */
const MAX_PUSH_BYTES = 8_000_000;

export type PushFile = { path: string; content: string };

export type PushResult = {
  owner: string;
  repo: string;
  branch: string;
  commitSha: string;
  url: string;
  created: boolean;
  fileCount: number;
};

class GitHubError extends Error {}

async function gh(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function fail(res: { status: number; body: any }, what: string): never {
  const msg =
    (res.body && typeof res.body === "object" && (res.body.message as string)) ||
    `HTTP ${res.status}`;
  throw new GitHubError(`${what}: ${msg}`);
}

/** 토큰이 유효한지 + 어떤 계정인지. 연결 저장 전에 확인용. */
export async function whoami(token: string): Promise<{ login: string; scopes: string }> {
  const res = await fetch(`${API}/user`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new GitHubError("That GitHub token was rejected.");
  const body = await res.json();
  return {
    login: body.login as string,
    scopes: res.headers.get("x-oauth-scopes") ?? "",
  };
}

export async function pushToGitHub(opts: {
  token: string;
  /** 비우면 토큰 소유자 계정에 만든다. */
  owner?: string;
  repo: string;
  branch?: string;
  message: string;
  files: PushFile[];
  private?: boolean;
}): Promise<PushResult> {
  const branch = opts.branch || "main";
  const me = await whoami(opts.token);
  const owner = opts.owner || me.login;

  if (opts.files.length === 0) {
    throw new GitHubError("This Code Space has no files to push.");
  }
  // 트리 한 번에 모든 내용을 인라인으로 싣기 때문에 요청 본문이 통째로 커진다.
  // 상한을 넘으면 GitHub 이 애매한 오류를 주므로 여기서 먼저 분명하게 막는다.
  const totalBytes = opts.files.reduce((n, f) => n + f.content.length, 0);
  if (totalBytes > MAX_PUSH_BYTES) {
    throw new GitHubError(
      `This Code Space is too large to push in one request (${Math.round(
        totalBytes / 1_000_000
      )} MB, limit ${MAX_PUSH_BYTES / 1_000_000} MB).`
    );
  }

  // 1. 저장소 확보 — 없으면 만든다.
  let created = false;
  const existing = await gh(opts.token, `/repos/${owner}/${opts.repo}`);
  if (existing.status === 404) {
    const make =
      owner === me.login
        ? await gh(opts.token, `/user/repos`, {
            method: "POST",
            body: { name: opts.repo, private: opts.private ?? true, auto_init: false },
          })
        : await gh(opts.token, `/orgs/${owner}/repos`, {
            method: "POST",
            body: { name: opts.repo, private: opts.private ?? true, auto_init: false },
          });
    if (make.status >= 300) fail(make, "Could not create the repository");
    created = true;
  } else if (existing.status >= 300) {
    fail(existing, "Could not read the repository");
  }

  // 2. 기존 브랜치 끝점(있으면). 빈 저장소면 404 — 부모 없는 첫 커밋이 된다.
  const refPath = `/repos/${owner}/${opts.repo}/git/ref/heads/${branch}`;
  const ref = await gh(opts.token, refPath);
  const parentSha: string | null =
    ref.status === 200 ? (ref.body?.object?.sha as string) ?? null : null;

  // 3. 트리 — content 인라인이라 요청 한 번.
  const tree = await gh(opts.token, `/repos/${owner}/${opts.repo}/git/trees`, {
    method: "POST",
    body: {
      tree: opts.files.map((f) => ({
        path: f.path,
        mode: "100644",
        type: "blob",
        content: f.content,
      })),
    },
  });
  if (tree.status >= 300) fail(tree, "Could not build the file tree");

  // 4. 커밋
  const commit = await gh(opts.token, `/repos/${owner}/${opts.repo}/git/commits`, {
    method: "POST",
    body: {
      message: opts.message,
      tree: tree.body.sha,
      parents: parentSha ? [parentSha] : [],
    },
  });
  if (commit.status >= 300) fail(commit, "Could not create the commit");

  // 5. 브랜치를 새 커밋으로. 기존 이력과 무관하게 Code Space 상태를 반영하므로
  //    force 로 밀어 넣는다(이 저장소는 Code Space 의 거울이라는 전제).
  const update = parentSha
    ? await gh(opts.token, `/repos/${owner}/${opts.repo}/git/refs/heads/${branch}`, {
        method: "PATCH",
        body: { sha: commit.body.sha, force: true },
      })
    : await gh(opts.token, `/repos/${owner}/${opts.repo}/git/refs`, {
        method: "POST",
        body: { ref: `refs/heads/${branch}`, sha: commit.body.sha },
      });
  if (update.status >= 300) fail(update, "Could not update the branch");

  return {
    owner,
    repo: opts.repo,
    branch,
    commitSha: commit.body.sha as string,
    url: `https://github.com/${owner}/${opts.repo}`,
    created,
    fileCount: opts.files.length,
  };
}
