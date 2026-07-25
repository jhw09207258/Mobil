# Code Workspace — 실현 가능성 분석과 구현 계획

작성: 2026-07-25 · 기준 커밋: `83e762f`

요청: (1) Code 안에 GitHub 같은 **Code Repository**(기존 Repository 와 별개),
(2) 코드 파일 통째 업로드, (3) **GitHub repo 통째 복사**, (4) **VS Code 급 에디터**,
(5) **Claude Code / Gemini 연결** 가능성.

각 항목에 **검증한 근거**를 붙였다. 추측은 추측이라고 표시했다.

---

## 요약 — 어디까지 되는가

| 요청 | 판정 | 핵심 제약 |
|---|---|---|
| Code Repository (별도 분류) | ✅ 전부 가능 | 없음 |
| 코드 파일 통째 업로드 | ✅ 가능 | 텍스트 파일만, 바이너리 제외 |
| GitHub repo 통째 복사 | ✅ 가능 (브라우저에서) | 아래 2번 — zip 방식은 CORS 로 막힘 |
| VS Code 급 에디터 | ⚠️ **에디터는 진짜 VS Code, 나머지는 아님** | 확장·터미널·디버거 불가. 3번 참조 |
| Claude Code 연결 | ⚠️ **그대로는 불가, 대안 2가지 있음** | 5번 — Vercel 서버리스의 구조적 한계 |
| Gemini 연결 | ✅ 가능하나 권장 안 함 | 5번 끝 |

---

## 1. Code Repository

기존 `repositories` 테이블은 문서·시트·맵·파일을 함께 묶는 범용 저장소다.
코드용은 성격이 다르다 — **폴더 경로(`src/lib/util.ts`)가 있어야** GitHub 처럼
트리로 보여줄 수 있고, GitHub 출처(owner/repo/branch)를 기억해야 재동기화가
가능하다. 그래서 `repositories` 를 재사용하지 않고 별도 테이블로 만든다.

```
code_repositories(id, owner_id, name, github_owner, github_repo, github_ref, imported_at, deleted_at)
code_files.code_repository_id  → 어느 코드 저장소 소속인지
code_files.path                → 'src/lib/util.ts' (폴더 구조)
```

`code_files` 는 그대로 두고 컬럼 2개만 추가하므로 기존 코드 파일·공유·협업이
전부 그대로 동작한다. 제약 없음.

---

## 2. GitHub repo 통째 복사 — 실측으로 설계가 갈렸다

세 가지 경로를 실제로 헤더를 찍어 확인했다:

| 엔드포인트 | CORS | 레이트 리밋 |
|---|---|---|
| `api.github.com` (파일 목록) | `access-control-allow-origin: *` ✅ | **60/시간** (비인증) |
| `raw.githubusercontent.com` (파일 내용) | `access-control-allow-origin: *` ✅ | **API 리밋에 안 걸림** |
| `codeload.github.com` (zip 통째) | `...: https://render.githubusercontent.com` ❌ | — |

**zip 한 번에 받기는 불가능하다.** codeload 가 우리 오리진에 CORS 를 안 준다.
(서버로 프록시하면 되지만 Vercel 함수는 60초 제한이 있어 큰 repo 에서 죽는다.)

그래서 채택한 구조:

```
1) api.github.com/repos/{owner}/{repo}/git/trees/{ref}?recursive=1   ← API 호출 "1번"
2) raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}             ← 파일 수만큼, 리밋 없음
```

API 호출이 **총 1회**뿐이라 비인증 60/시간 한도로도 충분하다. 파일 내용은
레이트 리밋이 없는 CDN 에서 받으므로 파일이 1000개든 문제없다.

**브라우저에서 직접 받는다** — Vercel 서버리스(60초 제한, 메모리 제한)를
거치지 않으므로 큰 저장소도 타임아웃 없이 처리되고, 진행률도 그대로 보여줄 수
있다(방금 만든 업로드 토스트 재사용).

남는 제약(피할 수 없는 것):
- **비공개 저장소**는 사용자가 GitHub Personal Access Token 을 입력해야 한다.
- Git 트리 API 는 파일 10만 개 / 7MB 를 넘으면 잘린다(초대형 모노레포).
- **바이너리·`node_modules`·빌드 산출물은 걸러야 한다.** 안 그러면 수천 개
  쓰레기 파일이 들어온다. 확장자 화이트리스트 + 경로 블랙리스트 + 크기 상한.
- **git 히스토리는 안 온다.** 특정 시점 스냅샷 복사이지 clone 이 아니다.
  (히스토리·브랜치·커밋이 필요하면 5번의 Managed Agents 쪽이 답이다.)

---

## 3. "VS Code 급 에디터" — 정확히 어디까지인가

**Monaco Editor 는 VS Code 의 에디터 코어 그 자체다**(같은 팀, 같은 코드).
따라서 "VS Code 급 편집 경험"은 진짜로 가능하다. 하지만 **VS Code 앱 전체가
브라우저에서 도는 것은 아니다.** 이 구분이 이 요청의 핵심이다.

| Monaco 로 되는 것 | 브라우저에서 **안 되는** 것 |
|---|---|
| TS/JS/JSON/CSS/HTML **자동완성·타입 검사** (내장) | 확장(익스텐션) 마켓플레이스 |
| 멀티커서, 커맨드 팔레트(F1), 미니맵 | 통합 터미널 |
| 찾기/바꾸기(정규식), 코드 폴딩, 괄호 매칭 | 디버거 (중단점 실행) |
| 90여 개 언어 문법 강조 | **Python·Rust·Go 등의 자동완성** |
| Diff 뷰어, 포매팅 | 파일 시스템 감시, git 통합 |

가장 중요한 한계: **자동완성이 되는 언어는 TS/JS/JSON/CSS/HTML 뿐이다.**
Monaco 에 그 언어들의 언어 서비스가 내장돼 있기 때문이다. Python 이나 Rust
자동완성을 하려면 **서버에서 언어 서버(LSP)를 띄우고 WebSocket 으로 연결**해야
하는데, 그건 Vercel 서버리스로는 불가능하고 상시 실행되는 컨테이너가 필요하다.

번들 크기는 2~5MB 지만 이미 편집기들이 `next/dynamic` 으로 지연 로딩되고 있어
탭을 열 때만 받는다.

협업(Yjs)은 `y-monaco` 로 유지된다 — Yjs 문서와 전송 계층(`lib/yjs-transport.ts`)은
그대로 두고 에디터 바인딩만 교체하므로 실시간 공동 편집은 계속 동작한다.

---

## 4. Claude Code / Gemini 연결 — 세 가지 층위

여기가 가장 오해하기 쉬운 부분이라 정확히 나눈다.

### (a) Claude API (Messages) — ✅ 지금 바로 가능

에디터에서 선택한 코드에 대해 설명·리팩터·버그 수정·생성.
Anthropic SDK(`@anthropic-ai/sdk`)로 API 라우트 하나면 된다. Vercel 에서 정상 동작.

**부수 효과:** 현재 Big Brother 는 NVIDIA 엔드포인트를 쓰는데 Vercel(icn1)에서
100% 실패한다(`docs/ASSESSMENT.md` 5.1). Anthropic 을 직접 붙이면 이 화면만큼은
프로덕션에서 실제로 동작하는 AI 가 생긴다.

### (b) Claude Code 그 자체 (Claude Agent SDK) — ❌ Vercel 에서 불가능

Claude Code 를 라이브러리로 packaging 한 것이 **Claude Agent SDK**
(`@anthropic-ai/claude-agent-sdk`)다. 파일 읽기/쓰기/편집·bash·grep 같은 도구가
내장돼 있고 에이전트 루프까지 들어 있다 — 우리가 원하는 바로 그것이다.

**그런데 이건 "하네스만" 제공하고 실행 환경은 직접 마련해야 한다.** 즉
**영속적인 파일 시스템과 계속 살아있는 프로세스**가 필요하다. Vercel 서버리스
함수는 요청이 끝나면 사라지고(최대 60초), 쓰기 가능한 영속 디스크가 없다.
구조적으로 맞지 않는다. 쓰려면 별도의 VM/컨테이너(Fly.io, Railway, EC2 등)를
운영해야 하고, 그 순간 이 프로젝트의 "서버리스" 전제가 깨진다.

### (c) Managed Agents — ✅ 가능. **Claude Code 에 가장 가까운 현실적 답**

Anthropic 이 **에이전트 루프와 샌드박스 컨테이너를 대신 호스팅**한다. 우리
서버는 세션을 만들고 이벤트 스트림만 읽으면 되므로 **Vercel 에서도 된다.**
컨테이너 안에서 bash·파일 편집·코드 실행이 실제로 돌아간다.

이 요청에 특히 잘 맞는 이유: 세션 리소스로 **GitHub 저장소를 직접 마운트**할 수
있다. 토큰은 Anthropic 쪽 git 프록시가 주입하므로 컨테이너 안 코드가 토큰을
읽을 수 없고, 브랜치 push 와 PR 생성까지 가능하다.

즉 **"내 repo 를 열어서 Claude 가 직접 고치고 PR 올리기"는 실현 가능하다** —
단 우리 서버가 아니라 Anthropic 이 호스팅하는 컨테이너에서 돌아간다.

제약: 베타, 별도 요금, GitHub PAT 필요, 그리고 (b)와 달리 우리가 컨테이너
내부를 커스터마이즈할 수 없다.

### (d) Gemini — ✅ 가능하나 권장하지 않음

Google API 로 코드 설명·생성은 된다. 다만 Claude Code 같은 **에이전트 하네스
+ 호스팅 샌드박스**에 대응하는 것이 없어서, (c)에 해당하는 기능은 만들 수 없다.
두 제공자를 다 붙이면 프롬프트·도구 정의·에러 처리를 이중 유지해야 한다.
**Anthropic 하나로 가는 것을 권한다.**

---

## 5. 구현 순서와 위험도

| # | 항목 | 위험 | 비고 |
|---|---|---|---|
| 1 | `code_repositories` 스키마 | 낮음 | 컬럼 추가만, 기존 동작 불변 |
| 2 | GitHub 임포트 | 낮음 | 브라우저에서, 검증된 경로 |
| 3 | 코드 저장소 UI + 대량 업로드 | 낮음 | |
| 4 | Monaco 교체 | **중간** | 협업 바인딩 교체 — Yjs 문서/전송은 그대로 두고 에디터만 |
| 5 | Claude 코드 어시스트 | 낮음 | API 키 필요 |
| 6 | Managed Agents (선택) | 높음 | 베타 + 별도 비용. 4단계까지 안정화 후 판단 |

**4번이 유일한 실질 위험**이다. 지금 CodeMirror + `y-codemirror.next` 조합은
정상 동작 중이고, 실시간 협업은 깨지면 눈에 잘 안 띄는 종류의 회귀다.
Yjs 문서·전송 계층은 건드리지 않고 바인딩만 바꿔 위험을 좁힌다.

6번은 이번 범위에서 제외한다 — 베타 API + 추가 과금이라 사용자가 비용을 알고
결정할 사안이지, 조용히 넣을 것이 아니다.
