# Possion (H-1 Prototype, beta v1.4)

Schema Tool for Users. Orchestrate Intelligence.

Last Update in July 25, v1.4 by Haewon Jeong
Co-development with Yegrina Haute Group Infrastructrue.
more info in www.officialyegrina.com

> Deployment Archive for Infrastructure

## 디자인 방향 (v1.4 —  Apple Liquid Glass)

초기의 Oracle/터미널풍 엔터프라이즈 다크 테마에서, **Apple Liquid Glass**
감성으로 전환했습니다 — 반투명 유리(backdrop-blur) 오버레이, 넉넉한 곡률
(`--radius` 10 / `--radius-lg` 18), 부드럽고 넓게 퍼지는 그림자, 그리고
스프링 커브(`--ease-spring`) 기반의 모션(버튼 눌림·카드 리프트·모달 팝·패널
슬라이드 인/아웃)을 전면 적용했습니다. 색 팔레트는 순수 중립 그레이 다크와
흰색+회색 혼합 라이트 두 모드, 액센트는 블루입니다. 데스크톱 앱(Tauri)에서는
헤더·사이드바 크롬이 macOS vibrancy 위로 반투명 유리로 렌더링됩니다.

> 기술 스택은 그대로 유지됩니다(Next.js 15 SSR · Supabase · Yjs 실시간 협업 ·
> Tiptap/CodeMirror/fortune-sheet/mind-elixir 에디터). 디자인/모션 레이어만
> 교체했습니다.

## Technical Stacks

- **Next.js 15** (App Router) — Vercel Deployment
- **Supabase** — Postgres · Auth(email+password) · Storage
- **@supabase/ssr** — 서버 컴포넌트/미들웨어 세션 처리
- **Tiptap** — 문서 에디터 (콘텐츠는 JSON 으로 저장, HTML 직접 저장 배제로 XSS 방지)
- **@fortune-sheet/react** — 스프레드시트 에디터 (Excel/Google Sheets 호환 UI, 수식·서식·다중 시트)
- 전 테이블 **RLS(행 수준 보안)** 적용, 모든 PK 는 UUID v4


## Possion이 제공하는 보안·최적화 시스템

전 라우트에 보안 헤더(CSP · X-Frame-Options · HSTS · nosniff 등)를
`middleware.ts` 에서 경로별로 적용하고(상세는 `lib/security-headers.ts` 참고 —
`/sheets` 만 스프레드시트 코어 라이브러리가 요구하는 `unsafe-eval` 을 예외적으로
허용), Tiptap·CodeMirror·React Flow·스프레드시트 에디터는 모두 지연 로딩
(`ssr:false` 동적 임포트)으로 초기 번들에서 분리합니다.

### 반응형(태블릿·모바일)

최근 8년 내 실기기의 CSS 뷰포트 폭을 기준으로 세 구간을 둡니다 — 모바일
~360-430px(Galaxy S21-S24, iPhone SE-16 Pro Max), 태블릿 641-1024px(iPad
mini/Air/Pro 11", Galaxy Tab, iPad Pro 12.9" 세로), 데스크톱 1025px~.
가로모드 휴대폰(예: 844px)은 세로 태블릿과 여유 폭이 비슷해 "기기 종류"가
아닌 "가용 폭" 기준으로 나눕니다.

- **태블릿**: 데스크톱과 동일한 아이콘 사이드바·스플릿뷰 구조를 유지합니다.
  대부분의 그리드가 이미 `auto-fit`/`auto-fill` 이라 자연스럽게 재배열되고,
  콘텐츠 폭·여백만 축소됩니다.
- **모바일(≤640px)**: 헤더는 유지하고 아이콘 사이드바는 햄버거 버튼으로
  여닫는 슬라이드인 드로어(아이콘+라벨)로 전환됩니다. 스플릿뷰는 제공하지
  않습니다 — localStorage 에 데스크톱에서 저장된 분할 상태가 남아 있어도
  모바일 폭에서는 항상 단일 패널로 강제 렌더링합니다(`lib/use-media-query.ts`
  의 `useIsMobile()`). 8개 목록/관리자 테이블은 전부 가로 스크롤
  안전장치(`.table-scroll`)를 두고, 사용 빈도가 높은 파일·관리자 사용자
  테이블은 저우선순위 컬럼(`Type`/`Owner`/개별 콘텐츠 개수 등)을 숨겨
  핵심 정보 위주로 보여줍니다. 문서/코드 에디터 툴바, 마인드맵·시트 상단
  바는 모두 줄바꿈되어 좁은 화면에서도 버튼이 잘리지 않습니다.
- **터치 입력**: 이미지 리사이즈 핸들과 스플릿뷰 구분선 드래그는 Pointer
  Events 로 구현되어 마우스와 터치(휴대폰·태블릿)를 동일하게 처리하며,
  `(pointer: coarse)` 미디어 쿼리로 터치 기기에서만 작은 아이콘 버튼의
  히트 영역을 넓힙니다(Apple HIG/Material 권장 터치 타깃 크기에 근접).

알려진 제한: `@fortune-sheet/react`(스프레드시트) 내부 툴바·그리드는 3rd
party 위젯이라 자체 터치 최적화 여부를 보장할 수 없어 `.sh-paper` 에
`overflow: auto` 안전장치만 두었습니다.

## 기능

| 영역 | 내용 |
| --- | --- |
| 인증 | 회원가입 / 로그인 (Supabase Auth), 가입 시 프로필 자동 생성 |
| 관리자 | 코드 등록(`/admin/redeem`)으로 권한 승격, 관리자 콘솔에서 코드 발급 |
| 파일 | 업로드(드래그앤드롭 포함) · 다운로드(서명 URL) · 이름변경 · 삭제 · 공유(view/edit) · 검색 |
| 문서 | 생성 · 조회 · 편집(자동/수동 저장) · 공유(view/edit) · 공개 토글 · 검색 |
| 코드 | 웹 코드 에디터(CodeMirror 6) — 구문 강조 · 다국어 · 자동/수동 저장 · 다운로드 · 공유 · 공개 토글 · 검색 |
| 시트 | 스프레드시트 에디터(@fortune-sheet) — 수식 · 서식 · 다중 시트 탭 · 자동/수동 저장 · 공유 · 공개 토글 · 검색 |
| 마인드맵 | React Flow 캔버스 — 파일·코드·문서를 노드로 배치하고 상하관계(간선)로 연결 · 공유 · 공개 토글 |
| 작업공간 | 브라우저 탭처럼 문서/코드/시트/마인드맵을 열고 닫는 탭 스트립(헤더 하단), 최대 2분할 스플릿뷰(드래그로 비율 조절) |
| 대시보드 | 스토리지 사용량 그래프(카테고리별 구성) · 전체 공유 스토리지 대비 내 사용 비율 그래프 |
| 관리자 | 전체 사용자 목록·역할·콘텐츠 개수·스토리지 사용량 관리 페이지(`/admin/users`) |
| 설정 | 표시 이름 변경, 이메일·권한·공유 ID 확인 |
| 감사 | 주요 작업을 `audit_logs` 에 기록, 관리자 콘솔에서 조회 |
| 온톨로지 검색 | 헤더 통합 검색 — 문서·코드·시트·마인드맵·파일을 한 번에 검색하고, 결과별로 연결된 다른 항목을 펼쳐서 확인 |
| Big Brother | 대화형 인텔리전스 어시스턴트(구 Sophia 통합, `/big-brother`) — 온톨로지 검색·RAG(시맨틱 검색)·워크스페이스 읽기/쓰기·외부 논문/GitHub 검색을 도구로 쓰는 LLM 챗. Search console 탭에서 LLM 없이 직접 검색도 가능. `/sophia` 는 `/big-brother` 로 리다이렉트, 대화 기록은 그대로 유지 |
| 시맨틱 검색(RAG) | 헤더 검색에 의미 기반 결과 병행 표시(마이그레이션 0041, pgvector + NVIDIA nv-embedqa-e5-v5) — 저장 시 내용 해시가 바뀐 경우에만 임베딩 재계산(`lib/embeddings.ts`), 어휘(tsvector)+의미 하이브리드, RLS(can_view_object) 동일 적용, 임베딩 API 장애 시 어휘 검색만으로 우아하게 강등. Big Brother 어시스턴트에도 `semantic_search` 도구 추가(의미 검색→읽기→종합 = RAG). 연결 항목 펼침은 온톨로지 그래프 2단계 탐색(`get_linked_objects_deep`, 재귀 CTE, "via X" 표시) |
| Comms(팀 채팅) | 사용자 간 DM·그룹 채팅(`/chat`, 마이그레이션 0040) — Supabase Realtime Broadcast(private 채널, 멤버만 수신/발신) 실시간 전달, 안 읽음 배지, 그룹 멤버 추가/나가기. 메시지에 문서/코드/시트/마인드맵을 첨부(⛓)하면 칩으로 표시되고 클릭 시 워크스페이스 탭으로 바로 열린다 — 채팅이 콘텐츠 도구와 한 몸으로 동작. 라이브 기능(0042): 앱 어디서나 쓰는 우하단 플로팅 채팅(버블↔패널, 확대/최소화), 새 메시지 인스타풍 토스트 알림(DB 트리거가 각 멤버의 개인 `user:<id>` topic 으로 fanout), 타이핑 표시("X is typing…"), 읽음 확인(내 마지막 메시지에 Sent/Read/Read by N). 메시지 서식(경량 마크다운, `markdown-parse.ts`): **굵게**·*기울임*·__밑줄__·~~취소선~~·`인라인 코드`·코드 블록·[링크](URL)·URL 자동 링크·번호/글머리표 목록·들여쓰기·@멘션 — Aa 토글 서식 툴바 + 이모지/멘션 메뉴. 플로팅 위젯은 /chat 페이지에서는 숨김. 긴 메시지 접기/펼치기(Show more), 프로필 사진 전면 연동(0043 — 대화 목록·메시지·토스트·멘션/연락처), 스플릿 뷰에 채팅 탭("Open as tab" — 한쪽엔 채팅, 한쪽엔 문서/코드) |
| 테마 | 라이트/다크 두 모드(설정에서 선택, `lib/theme.ts` → `<html data-theme>`) — 팔레트는 globals.css CSS 변수(:root=다크, [data-theme=light])가 담당. 주요 버튼 액센트는 블루(구 그린 교체, `--ok` 상태 초록은 유지). localStorage + 루트 인라인 스크립트로 첫 페인트 전 적용(FOUC 없음). 알려진 한계: 코드미러/시트 에디터 캔버스는 아직 다크 고정, 마인드맵은 열 때의 모드를 따름 |
| 저장소(Repositories) | 문서·코드·시트·마인드맵·파일을 저장소 단위로 묶는다(0044). NULL = "Null Repository". /files 는 **Google Drive 풍 목록 테이블**(타입 아이콘 + 이름 + 액션)로, 랜딩은 저장소 목록·상세는 그 저장소의 Possion 항목·파일 목록. 생성/이름변경은 모달 입력(Tauri 웹뷰에서 prompt 가 동작하지 않는 문제 시정). 각 에디터 상단바 저장소 선택으로도 이동/생성 |
| 문서 편집 활동 로그 | 문서 에디터 우측의 접이식 패널(Activity 버튼) — 누가 언제 얼마나 추가/삭제했는지 타임라인으로 표시(0047). 자동저장마다 공통 접두/접미 제거 diff 로 추가/삭제 글자수를 추정하고, 같은 사용자의 5분 내 편집은 한 세션으로 병합해 기록 |
| Pages 가져오기 | 문서 가져오기에 .pages 지원(`lib/pages-convert.ts`) — Pages '09 index.xml 파싱 + 현행 IWA(Snappy 청크) 해제 후 UTF-8 본문 휴리스틱 추출(베스트 에포트, 실패 시 .docx 내보내기 안내) |
| 대시보드 | one-screen 압축 레이아웃(데스크톱 세로 스크롤 없음, Recent 만 내부 스크롤) + 실시간 데이터 전송 속도 위젯(PerformanceObserver, 현재 속도·피크·30초 스파크라인). 브라우저 확대/축소 차단(NoZoom — Ctrl/Cmd+휠·+/-/0·핀치) |

문서 에디터는 서식(굵게/기울임/밑줄/취소선/코드), **글자 색상 · 형광펜**, 링크,
체크리스트, 인용, 코드블록, **이미지·동영상 업로드**(공개 `media` 버킷)를 지원하고,
Notion 류 **"/" 명령 메뉴**(제목·목록·체크리스트·인용·코드블록·구분선을 입력 중
바로 삽입)와 **이미지 리사이즈 핸들**(선택 후 코너 드래그로 너비 조절, 비율 유지)을
제공합니다. 마인드맵은 MindMup 류의 고정 트리 대신 자유 그래프(React Flow)로
구성되어, 파일과 코드를 구분 없이 노드로 배치하고 방향성 간선으로 상하관계를
표현하며, **자동 배치**(계층형 BFS 레이아웃, 외부 라이브러리 없이 자체 구현) 버튼과
참조 노드 클릭 시 대상의 제목/내용 일부를 바로 보여주는 **사이드 미리보기**를
지원합니다. UI 언어는 영어입니다.

> **코드 에디터**는 초기 지시서에서 제외 항목이었으나 이후 명시적 요청으로 추가되었습니다.
> GitHub 웹 에디터가 사용하는 **CodeMirror 6** 을 자체 호스팅(CDN·웹워커 불필요)하며,
> JavaScript/TypeScript · Python · HTML/CSS · JSON · SQL · Rust · Go 등 15종 언어의
> 구문 강조를 지원합니다.

공유는 상대방의 **공유 ID(user UUID)** 로 이루어집니다. 제공된 RLS 정책상 일반
사용자는 타인의 프로필을 이메일로 조회할 수 없으므로, 각 사용자는 대시보드에서
자신의 공유 ID 를 복사해 상대에게 전달합니다.

### 작업공간(탭·스플릿뷰)

문서/코드/시트/마인드맵을 열면 브라우저 창처럼 헤더 바로 아래 탭 스트립에
활성화되고, 목록 페이지로 이동해도(사이드바 탐색) 탭은 유지된 채 숨겨졌다가
다시 클릭하면 즉시 복귀합니다. 탭은 개별적으로 닫을 수 있고, 스플릿뷰 아이콘을
누르면 최대 2개까지 나란히 열어 비교할 수 있으며 가운데 구분선을 드래그해
비율(20~80%)을 조절합니다. 탭 목록·분할 상태·비율은 `localStorage` 에 저장되어
새로고침 후에도 유지됩니다. 상태는 `app/(app)/workspace/workspace-context.tsx`
의 React Context 로 관리하고, 패널이 숨겨지면 캔버스·ResizeObserver 기반
에디터(CodeMirror·스프레드시트·React Flow)가 `display:none` 상태에서 깨지는
것을 피하기 위해 완전히 언마운트합니다(재표시 시 자동저장된 데이터를 다시
조회 — 유실 없음).

### 스토리지 분석

Supabase Storage 는 사용자 구분 없이 프로젝트 전체가 하나의 버킷 풀을
공유합니다(사용자별 할당량 없음). 대시보드는 이를 반영해 두 그래프를
제공합니다 — 내 콘텐츠가 파일/문서/코드/시트/마인드맵/미디어 중 무엇에 얼마나
쓰이는지 보여주는 구성 막대그래프, 그리고 전체 플랫폼 스토리지 대비 내가 차지하는
비율 그래프. 관리자는 `/admin/users` 에서 전체 사용자의 역할·콘텐츠 개수·
스토리지 사용량을 한 번에 확인할 수 있습니다.

### 고아 미디어 정리

문서 에디터에서 이미지·동영상을 업로드했다가 삭제하거나 문서 자체를 지우면
`media` 버킷에 더 이상 참조되지 않는 오브젝트가 남습니다. 관리자 콘솔의
"Media storage cleanup" 패널에서 스캔하면 어떤 문서 콘텐츠에도 경로가 등장하지
않는 오브젝트를 찾아 목록으로 보여주고, 확인 후 Storage API 로 일괄 삭제할 수
있습니다(직접 SQL `DELETE` 는 `storage.objects` 의 보호 트리거로 차단되어 있음).

### 온톨로지 시맨틱 레이어 + 통합 검색

Palantir Foundry Ontology 개념(Semantic/Kinetic/Dynamic 레이어)을 Possion
스케일에 맞게 재해석해 도입했습니다. Objects(문서/코드/시트/마인드맵/파일)와
Properties(각 테이블 컬럼)는 이미 존재했고, 빠져 있던 **Links** 를
`object_links` 테이블로 전역화했습니다 — 마인드맵의 참조 노드, 문서 에디터의
내부 링크(`/documents/{id}` 등)를 저장할 때마다 자동으로 추출·동기화합니다.
헤더의 통합 검색창(`search_ontology`, Postgres 전문검색 `tsvector`/`GIN`)은
RLS 를 그대로 반영해 본인이 접근 가능한 항목만 보여주고, 결과를 펼치면
`get_linked_objects` 로 연결된 다른 항목을 함께 확인할 수 있습니다. 검색
결과를 클릭하면 워크스페이스 탭으로 바로 열립니다(Kinetic Layer는 별도로
만들지 않고 기존 탭 시스템을 그대로 사용 — 검색에서 바로 열어 편집 가능).
AI/임베딩 기반 자동 연결(Dynamic Layer)은 이번 범위에는 포함하지 않았습니다.

> 알려진 범위 제한: 시트(셀 그리드)·마인드맵(노트 라벨)은 구조가 복잡해 1차
> 버전에서 제목만 색인합니다. 코드 검색은 단어 단위 토큰화라 `calculateRevenue`
> 처럼 공백 없이 이어붙인 camelCase 식별자는 부분 일치하지 않습니다(예:
> "revenue" 로는 안 잡힘). 마인드맵 링크는 "이 마인드맵이 어떤 항목들을
> 포함한다"는 허브 모델이며, 참조 노드 간 개별 간선까지 별도 관계로 뽑아내진
> 않습니다.

## 프로젝트 구조

```
app/
  (auth)/            로그인 · 회원가입
  (app)/             인증 필요한 앱 셸 (고정 헤더 + 아이콘 사이드바 레일)
    header.tsx       고정 헤더 (로고 · 계정/설정 메뉴)
    sidebar.tsx       아이콘 전용 사이드바 레일
    shortcuts.tsx     전역 키보드 단축키 + 도움말 모달
    dashboard/       개요 · 내 공유 ID · 최근 문서
    files/           파일 저장소
    documents/[id]/  Tiptap 문서 에디터
    code/[id]/       CodeMirror 코드 에디터
    sheets/[id]/     스프레드시트 에디터 (@fortune-sheet, 다크 테마)
    mindmap/[id]/    React Flow 마인드맵 캔버스
    workspace/       탭 스트립 · 스플릿뷰 셸 (React Context)
    dashboard/       개요 · 스토리지 사용량 그래프 · 최근 문서
    search/          온톨로지 통합 검색 서버 액션
    header-search.tsx 헤더 검색창 + 결과/연결 항목 드롭다운
    mobile-nav-context.tsx 모바일 사이드바 드로어 열림 상태
    settings/        프로필 · 계정 설정
    admin/           코드 등록 · 관리자 콘솔 · 전체 사용자 관리(users/)
  auth/              콜백 · 로그아웃 라우트
components/codemirror/ 코드 에디터 래퍼 · 테마 · 언어 매핑
lib/supabase/        browser · server · middleware 클라이언트
lib/security-headers.ts 경로별 CSP/보안 헤더 구성
lib/ontology-links.ts 마인드맵/문서 콘텐츠에서 온톨로지 링크 추출
lib/use-media-query.ts SSR 안전 반응형 훅(useIsMobile 등)
components/          공용 UI (모달 · 공유 다이얼로그 · 복사 필드)
supabase/migrations/ DB 마이그레이션
docs/                구축 지시서
```

## 로컬 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. Supabase 프로젝트 준비

1. [Supabase](https://app.supabase.com) 에서 새 프로젝트 생성
2. SQL Editor 에서 마이그레이션을 순서대로 실행:
   - `supabase/migrations/0001_init.sql` — 초기 스키마 · RLS · 함수 (지시서 verbatim)
   - `supabase/migrations/0002_storage.sql` — Storage 버킷 · 정책 (지시서 verbatim)
   - `supabase/migrations/0003_profile_trigger.sql` — 프로필 자동 생성 트리거
   - `supabase/migrations/0004_code_files.sql` — 코드 에디터 테이블 · RLS
   - `supabase/migrations/0005_harden_function_grants.sql` — SECURITY DEFINER 함수 권한 하드닝
   - `supabase/migrations/0006_fix_pgcrypto_search_path.sql` — pgcrypto(extensions 스키마) 해석 수정
   - `supabase/migrations/0007_fix_role_change_guard.sql` — role 자기승격 취약점 시정
   - `supabase/migrations/0008_media_bucket.sql` — 에디터 이미지/동영상용 공개 media 버킷
   - `supabase/migrations/0009_mind_maps.sql` — 마인드맵 테이블 · RLS
   - `supabase/migrations/0010_sheets.sql` — 스프레드시트 테이블 · RLS
   - `supabase/migrations/0011_storage_and_admin_stats.sql` — 스토리지/관리자 통계 함수
   - `supabase/migrations/0012_fix_storage_stats_bigint_cast.sql` — `sum()` numeric→bigint 캐스트 수정
   - `supabase/migrations/0013_content_breakdown.sql` — 카테고리별 콘텐츠 사용량 분해 함수(대시보드 그래프용)
   - `supabase/migrations/0014_media_gc.sql` — media 버킷 SELECT 정책 + 고아 미디어 탐지 함수(관리자 전용)
   - `supabase/migrations/0015_ontology_search_links.sql` — 전문검색 인덱스, `object_links` 링크 그래프, 권한 판별/링크 동기화/통합 검색 함수
   - `supabase/migrations/0016_fix_search_ontology_union_order_by.sql` — UNION ALL 뒤 ORDER BY 표현식 오류 수정
   - `supabase/migrations/0017_fix_search_ontology_rls_recursion.sql` — documents/document_permissions 상호 RLS 순환 참조 회피(SECURITY DEFINER + can_view_object 재검증으로 전환)

> `0003` 은 가입 시 `profiles` 행을 자동 생성하는 트리거입니다. `0001` 은 profiles
> INSERT 정책을 두지 않으므로, `auth.users` INSERT 시점의 SECURITY DEFINER 트리거로
> 프로필을 생성하는 것이 RLS 를 우회하지 않는 근본 해법입니다.

### 3. 환경 변수

`.env.example` 을 복사해 `.env.local` 을 만들고 값을 채웁니다
(Supabase 대시보드 → Settings → API):

```bash
cp .env.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>
```

### 4. 최초 관리자 부트스트랩

`admin_codes` 는 클라이언트에서 삽입할 수 없고, 코드 발급 함수는 관리자만 호출할 수
있습니다. 따라서 **최초 1회에 한해** Supabase SQL Editor 에서 코드를 직접 삽입합니다:

```sql
-- pgcrypto(digest)는 Supabase 에서 extensions 스키마에 있으므로 스키마 명시
insert into public.admin_codes (code_hash, expires_at)
values (encode(extensions.digest('여기에_임의의_평문코드', 'sha256'), 'hex'), null);
```

사용한 평문 코드를 기록해 두고, 앱에서 회원가입 후 `/admin/redeem` 에 입력하면
관리자로 승격됩니다. 이후 관리자 콘솔에서 추가 코드를 발급할 수 있습니다.

## 보안 하드닝 (연결 검증 중 발견·시정)

Supabase 연결 후 DB 레벨 기능 검증에서 두 건의 실제 결함을 발견해 근본
시정(마이그레이션 0006/0007)했습니다.

1. **pgcrypto 해석 오류 (0006).** `redeem_admin_code`/`generate_admin_code` 가
   `search_path = public` 으로 고정되어, `extensions` 스키마에 설치된 pgcrypto
   함수(`digest`, `gen_random_bytes`)를 찾지 못해 런타임에 실패했습니다. 두 함수의
   `search_path` 에 `extensions` 를 추가해 해결했습니다.
2. **role 자기 승격 취약점 (0007).** 0001 의 `prevent_role_change` 가
   `current_user = session_user` 일 때만 차단하는데, PostgREST 는 항상
   `authenticated ≠ authenticator` 이므로 이 가드가 발동하지 않았습니다. 그 결과
   인증 사용자가 `profiles.role` 을 직접 `admin` 으로 변경할 수 있었습니다. role
   변경을 `redeem_admin_code` 가 세우는 트랜잭션 로컬 플래그가 있을 때만 허용하도록
   재설계했습니다(클라이언트는 PostgREST 로 GUC 를 위조할 수 없음).

`get_advisors` 보안 점검의 나머지 경고(SECURITY DEFINER 함수 실행 권한)는
`is_admin`(RLS 정책이 호출) 및 관리자 코드 함수(authenticated 전용, 내부
`is_admin` 체크로 보호)로, 모두 의도된 설계입니다.

### 5. 개발 서버

```bash
npm run dev
# http://localhost:3000
```

## 배포 (Vercel)

1. 저장소를 Vercel 에 연결
2. 환경 변수(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) 등록
3. Supabase Auth 의 Redirect URL 에 배포 도메인의 `/auth/callback` 추가

## 범위

이번 단계는 인증 · 관리자 승격 · 파일 저장소 · 문서 편집 · 코드 에디터로
구성됩니다. 실시간 협업(Yjs)과 폴더 계층 구조는 포함하지 않습니다. 코드
에디터는 초기 지시서의 제외 항목이었으나 명시적 요청으로 추가되었습니다.
초기 요구사항은 [`docs/SaaS_구축_지시서.md`](docs/SaaS_구축_지시서.md) 참고.
