// ============================================================================
// 논문/코드 통합 검색 — 호스팅 없이 바로 붙일 수 있는 공개 API 만 연동한다:
// OpenAlex·Semantic Scholar(논문, 키 불필요), GitHub Code Search(코드, 개인
// 토큰 필요). Sophia 의 search_papers_and_code 도구(app/(app)/sophia/tools.ts)
// 가 이 함수 하나만 가져다 쓴다 — 원래는 (지금은 지운) /big-brother 의 검색
// 콘솔 탭과 함께 있었는데, 그 탭이 없어지면서 Sophia 쪽만 남아 여기로 옮겼다.
// ============================================================================

export type PaperResult = {
  source: "openalex" | "semanticScholar";
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  url: string | null;
};

export type CodeResult = {
  owner: string;
  repo: string;
  path: string;
  htmlUrl: string;
  fragment: string | null;
};

export type SearchResults = {
  openalex: PaperResult[];
  semanticScholar: PaperResult[];
  github: CodeResult[];
  errors: Partial<Record<"openalex" | "semanticScholar" | "github", string>>;
};

/** OpenAlex 는 abstract 를 "역색인"(단어→위치 배열) 형태로 준다 — 평문으로 복원. */
function reconstructAbstract(invertedIndex: Record<string, number[]> | undefined | null): string | null {
  if (!invertedIndex) return null;
  let maxPos = -1;
  for (const positions of Object.values(invertedIndex)) {
    for (const p of positions) if (p > maxPos) maxPos = p;
  }
  if (maxPos < 0) return null;
  const words = new Array<string>(maxPos + 1).fill("");
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const p of positions) words[p] = word;
  }
  return words.join(" ").trim() || null;
}

// 외부 검색 API 공통 타임아웃 — 한 공급자가 응답을 물고 있어도 나머지 결과와
// (이 검색을 도구로 쓰는) Sophia 응답까지 같이 멈추지 않게 한다.
const SEARCH_TIMEOUT_MS = 8000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchOpenAlex(query: string): Promise<PaperResult[]> {
  // mailto 없이 요청하면 레이트리밋이 더 빡빡한 공용 풀로 처리된다 — 연락처
  // 이메일을 설정해두면(선택) OpenAlex 가 권장하는 "polite pool"을 타서 훨씬
  // 안정적으로 응답한다. 미설정 시 지금과 동일하게 동작(하드 요구사항 아님).
  const mailto = process.env.OPENALEX_CONTACT_EMAIL;
  const url =
    `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=8` +
    (mailto ? `&mailto=${encodeURIComponent(mailto)}` : "");
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OpenAlex returned ${res.status}`);
  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  return results.map(
    (w: {
      display_name?: string;
      authorships?: { author?: { display_name?: string } }[];
      publication_year?: number;
      abstract_inverted_index?: Record<string, number[]>;
      doi?: string;
      id?: string;
    }) => ({
      source: "openalex" as const,
      title: w.display_name || "Untitled",
      authors: (w.authorships ?? []).map((a) => a.author?.display_name).filter((n): n is string => !!n),
      year: w.publication_year ?? null,
      abstract: reconstructAbstract(w.abstract_inverted_index),
      url: w.doi ? `https://doi.org/${w.doi.replace(/^https?:\/\/doi\.org\//, "")}` : w.id ?? null,
    })
  );
}

async function searchSemanticScholar(query: string): Promise<PaperResult[]> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
    query
  )}&limit=8&fields=title,abstract,year,authors,url`;
  // 비인증 공개 API 는 5분당 100요청으로 매우 낮게 제한돼 있어 429 가 흔하다
  // — 있으면 x-api-key 로 더 넉넉한 한도를 쓰고(선택, 없어도 동작), 그래도
  // 429 를 받으면 짧게 기다렸다 한 번만 재시도한다.
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  let res = await fetch(url, { headers, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  if (res.status === 429) {
    await sleep(1200);
    res = await fetch(url, { headers, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  }
  if (!res.ok) {
    if (res.status === 429) throw new Error("Rate limited — try again shortly.");
    throw new Error(`Semantic Scholar returned ${res.status}`);
  }
  const json = await res.json();
  const results = Array.isArray(json?.data) ? json.data : [];
  return results.map(
    (p: { title?: string; abstract?: string; year?: number; authors?: { name?: string }[]; url?: string }) => ({
      source: "semanticScholar" as const,
      title: p.title || "Untitled",
      authors: (p.authors ?? []).map((a) => a.name).filter((n): n is string => !!n),
      year: p.year ?? null,
      abstract: p.abstract ?? null,
      url: p.url ?? null,
    })
  );
}

async function searchGitHubCode(query: string, token: string): Promise<CodeResult[]> {
  const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=8`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.text-match+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub code search returned ${res.status}`);
  const json = await res.json();
  const rawItems = Array.isArray(json?.items) ? json.items : [];
  // GITHUB_TOKEN 이 실제로는 비공개/제한 저장소까지 접근 가능한 경우(설정
  // 실수 등), 그 결과가 검색에 섞여 나오면 토큰 없이 그냥 클릭하는 일반
  // 사용자에게는 GitHub 가 404("Not Found")를 띄운다 — 클릭한 링크가
  // 죽어있는 것처럼 보이는 가장 흔한 원인이라, 비공개 저장소 결과는 애초에
  // 걸러낸다(.env.example 은 public_repo 전용 토큰을 권장하지만, 토큰 스코프
  // 설정 실수에 대한 안전망으로도 필요하다).
  const items = rawItems.filter(
    (it: { repository?: { private?: boolean } }) => it.repository?.private !== true
  );
  return items.map(
    (it: {
      path?: string;
      html_url?: string;
      repository?: { full_name?: string };
      text_matches?: { fragment?: string }[];
    }) => {
      const fullName = it.repository?.full_name ?? "";
      const [owner, repo] = fullName.split("/");
      return {
        owner: owner ?? "",
        repo: repo ?? "",
        path: it.path ?? "",
        htmlUrl: it.html_url ?? "",
        fragment: it.text_matches?.[0]?.fragment ?? null,
      };
    }
  );
}

/** 통합 검색: 세 소스를 병렬로 조회하고, 하나가 실패해도 나머지는 반환한다. */
export async function searchPapersAndCode(query: string): Promise<SearchResults> {
  const q = query.trim();
  const empty: SearchResults = { openalex: [], semanticScholar: [], github: [], errors: {} };
  if (!q) return empty;

  const githubToken = process.env.GITHUB_TOKEN;

  const [openalexRes, semanticRes, githubRes] = await Promise.allSettled([
    searchOpenAlex(q),
    searchSemanticScholar(q),
    githubToken
      ? searchGitHubCode(q, githubToken)
      : Promise.reject(new Error("GitHub search isn't configured (missing GITHUB_TOKEN).")),
  ]);

  const result: SearchResults = { openalex: [], semanticScholar: [], github: [], errors: {} };

  if (openalexRes.status === "fulfilled") result.openalex = openalexRes.value;
  else result.errors.openalex = openalexRes.reason?.message ?? "OpenAlex search failed.";

  if (semanticRes.status === "fulfilled") result.semanticScholar = semanticRes.value;
  else result.errors.semanticScholar = semanticRes.reason?.message ?? "Semantic Scholar search failed.";

  if (githubRes.status === "fulfilled") result.github = githubRes.value;
  else result.errors.github = githubRes.reason?.message ?? "GitHub search failed.";

  return result;
}
