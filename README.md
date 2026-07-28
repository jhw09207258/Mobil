# Possion (H-1 Prototype, beta v1.6.1)

Schema Tool for Users. Orchestrate Intelligence.

Last Update in July 27, v1.6.1 by Haewon Jeong
Co-development with Yegrina Haute Group Infrastructrue.
more info in www.officialyegrina.com

> Deployment Archive for Infrastructure

## v1.6 에서 무엇이 바뀌었나 — 알림, 그리고 남아 있던 한계들

v1.5 를 내면서 스스로 적어 둔 한계 목록을 다시 열어 대부분을 없앴습니다.
가장 큰 것은 **알림**입니다.

### 알림: 이메일에서 웹 푸시로

지금까지 "앱을 안 보고 있을 때" 알릴 방법은 가입 이메일 한 가지뿐이었습니다.
메일은 늦게 오고, 스팸함에 들어가고, 읽음 표시가 남고, 무엇보다 한 대화에
15분에 한 통이라 실시간 도구의 알림으로는 맞지 않았습니다.

**표준 웹 푸시(Push API + VAPID)** 로 바꿨습니다.

- 브라우저를 완전히 닫아 두어도 **OS 알림**이 뜹니다. 눌러서 열면 그 대화·일정으로
  바로 갑니다.
- 홈 화면에 설치한 PWA(**iPhone/iPad 는 iOS 16.4+ 에서 설치했을 때**), Android,
  Windows/macOS 브라우저, 데스크톱 앱 모두 같은 경로입니다.
- 알림이 가는 것: **새 채팅 메시지 · 일정 초대 · 일정 알림(시작 n분 전)**.
- **이메일은 없애지 않고 폴백으로 내렸습니다.** 푸시를 켜지 않았거나 푸시가
  실패한 사람에게만 메일이 갑니다 — 같은 메시지로 두 번 알리지 않고, 아무한테도
  안 가는 일도 없습니다.
- 설정 → NOTIFICATIONS 에서 기기별로 켜고 끄고, 등록된 기기 목록을 보고, 테스트
  알림을 보낼 수 있습니다. 권한은 **버튼을 누른 순간에만** 묻습니다(페이지를
  열자마자 묻지 않습니다 — 그렇게 물으면 대부분 거절되고, 되돌리기가 아주 번거롭습니다).

> 서버에 VAPID 키가 없으면 이 기능은 조용히 꺼지고 예전처럼 이메일만 나갑니다.
> 설정 방법은 아래 [알림 설정](#알림-설정-웹-푸시) 참고.

### 반복 일정의 "이 일정만"

v1.5 에서는 반복 일정을 고치면 무조건 전체가 바뀌었습니다. iCalendar 와 같은
방식(EXDATE + 분리)으로 다시 만들었습니다.

- 반복 일정의 한 발생을 눌러서 열면 **Save this one / Save all**,
  **Delete this one / Delete all** 이 나옵니다.
- "이 일정만" 은 그 발생을 단발 일정으로 떼어내고 원본에는 예외를 남깁니다 —
  그 뒤로는 평범한 일정이라 시간·참석자·자료를 자유롭게 바꿀 수 있습니다.
- 반복 **주기 자체**를 고쳤다면 "이 일정만" 은 말이 되지 않으므로 그 선택지를
  숨기고 그렇게 말해 줍니다.

### 시간대

반복 일정을 **만든 사람의 시간대**로 전개합니다. 서울에서 만든 "매주 화요일
09:00" 은 뉴욕에서 봐도 서울의 화요일 09:00 이고, 서머타임이 시작돼도 그 지역의
09:00 에 머무릅니다(그때 UTC 시각은 한 시간 밀리는데, 그것이 벽시계를 지킨
증거입니다). 5개 시간대에서 DST 전환을 포함해 테스트했습니다.

### 그 밖에

- **.ics 가져오기 상한 200 → 2,000.** 일정마다 왕복하던 것을 한 문장 삽입으로 바꿨습니다.
- **첨부 카드 권한이 실시간으로 풀립니다.** 소유자가 "Share here" 를 누르면 그
  대화를 보고 있는 사람의 잠긴 카드가 그 자리에서 열립니다(예전엔 대화를 다시
  열어야 했습니다).
- **미리보기 상한**: 텍스트 512KB → 4MB, PDF 25MB → 100MB. 잘린 경계에서 한글이
  깨지던 것도 고쳤습니다(TextDecoder 스트리밍).
- **PWA 매니페스트 보강** — `start_url`/`display: standalone`/테마색/바로가기.
  iOS 에서 푸시를 받으려면 홈 화면 설치가 전제라 반드시 필요합니다.

## v1.5 에서 무엇이 바뀌었나

v1.4 사용 후기(작성자 김민재)에서 나온 두 가지 요구를 그대로 받았습니다.

> "시스템 내부의 문서의 공유가 채팅으로도 원활히 이루어졌으면 하는 바램입니다.
> 타 인원에게 확인 요청 시 파일 진입 경로를 제시하여 이 문서를 확인하라고
> 지시합니다."
>
> "기존의 클라우드 성격의 장점만을 가져왔으면 좋겠다는 의견입니다."

### 1) 보내는 것이 곧 권한을 주는 것이 되었습니다 (자료 공유)

지금까지 채팅 첨부(⛓)는 **링크에 지나지 않았습니다**. 받는 사람에게 권한이
없으면 칩을 눌러도 열리지 않았고, 그래서 결국 사람이 말로 "파일 진입 경로"를
불러 줘야 했습니다. 이제 **첨부와 권한 부여가 하나의 동작**입니다.

- 첨부가 든 메시지를 보내면 그 대화의 **모든 멤버에게 열람 권한이 자동으로**
  나갑니다(내가 소유자일 때). 보낸 뒤 "3명이 바로 열 수 있습니다" 라고 알려 줍니다.
- 메시지에 내부 경로(`/documents/…`)를 그냥 붙여 넣어도 똑같이 동작합니다 —
  기존에 하던 습관 그대로 쓰면 됩니다.
- **파일과 일정**도 채팅에 첨부할 수 있게 되었습니다(전에는 문서·코드·시트·
  링크그래프 4종뿐).
- 첨부 칩이 **카드**로 바뀌었습니다 — 종류·제목·소유자·수정일(파일은 크기/형식)이
  보이고, 열기·다운로드가 바로 됩니다.
- 권한이 없으면 카드가 **"권한 없음 — 요청하기"** 상태가 되고, 누르면 소유자와의
  DM 에 요청 메시지가 자동으로 갑니다. 소유자는 그 카드에서 **"Share here"** 한 번으로
  대화 전체에 권한을 줍니다.
- 지워졌거나 휴지통에 있는 항목은 **"No longer available"** 로 정확히 표시됩니다.
- 파일 목록·문서·시트·링크그래프 목록의 각 행에 **"Chat" 버튼**이 생겼습니다.
  자료를 찾은 자리에서 바로 대화를 골라 메모와 함께 보냅니다(권한 view/edit 선택).

### 2) 클라우드처럼, 열어 보기 전에 알 수 있게 (파일)

- **내려받지 않고 미리보기**: 이미지·동영상·오디오·PDF·텍스트/코드/CSV/JSON 을
  그 자리에서 봅니다. 파일 이름을 누르면 바로 열립니다.
- PDF 는 내용을 받아 `blob:` 로 띄웁니다 — 스토리지 도메인을 프레임에 직접
  허용하지 않기 위해서입니다(CSP `frame-src 'self' blob:`).

### 3) 캘린더 (신규)

Google/Apple Calendar 의 **달력·색·반복·ICS**, Teams/Outlook 의 **참석자·RSVP·
바쁨표시**, Slack 의 **대화로 흐르는 알림**, Evernote/Notion 의 **일정에 자료를
붙여 두기** 를 Possion 이 이미 가진 것들과 이어 붙였습니다.

- **월 / 주 / 일 / 아젠다** 4가지 보기, 지금 시각 선, 겹치는 일정 나란히 배치
- 달력 여러 개(색 구분) · **다른 사람에게 공유(viewer/editor)** · 체크박스로 보기 토글
- **참석자 초대 + RSVP**(Going / Maybe / Can't go), 초대는 실시간 알림으로 도착
- **반복 일정**(매일·매주·매달·매년, N 간격, 요일 지정, 종료일) — 규칙만 저장하고
  화면에서 펼칩니다
- **알림**(시작 0/5/10/30분·1시간·1일 전) — 앱을 보고 있는 동안 토스트로
- **일정에 문서·시트·코드·링크그래프·파일 붙이기** — 회의 전에 읽을 것이 그 자리에
- **일정을 채팅으로 보내기**, 채팅의 일정 카드를 누르면 그 일정이 열립니다
- **ICS 구독 주소** 발급 — Google/Apple 캘린더에 넣으면 Possion 일정이 그대로 보입니다
  (읽기 전용, 유출 시 회전 가능). **.ics 파일 가져오기**도 지원합니다
- 대시보드 하단에 **"UP NEXT"** 줄 — 다음 7일의 가까운 일정 4개

자세한 변경 목록과 마이그레이션은 아래 [v1.5 상세 변경 기록](#v15-상세-변경-기록)에
있습니다. 여기 적혀 있던 한계 대부분은 v1.6 에서 없어졌습니다 —
[v1.6 상세 변경 기록](#v16-상세-변경-기록)의 대조표를 보세요.

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
| 대시보드 | one-screen 압축 레이아웃(데스크톱 세로 스크롤 없음, Recent 만 내부 스크롤) + 실시간 데이터 전송 속도 위젯(PerformanceObserver, 현재 속도·피크·30초 스파크라인). 브라우저 확대/축소 차단(NoZoom — Ctrl/Cmd+휠·+/-/0·핀치). 하단 "UP NEXT" 줄에 다음 7일 일정 4개(일정이 없으면 렌더하지 않아 한 화면 높이를 지킨다) |
| 자료 공유(채팅) | **첨부 = 권한 부여**(0065). 첨부가 든 메시지를 보내면 대화 멤버 전원에게 열람 권한이 자동으로 나간다(소유자일 때). 첨부 가능 종류에 **파일·일정** 추가, 내부 경로(`/documents/{id}`)를 붙여 넣어도 동일 동작. 첨부 칩 → **카드**(종류·제목·소유자·수정일, 파일은 크기/MIME)로 승격, 권한이 없으면 "Request access"(소유자와의 DM 으로 요청 자동 발송), 소유자에게는 "Share here"(대화 전체에 권한 부여). 삭제·휴지통 항목은 "No longer available". 파일/문서/시트/링크그래프 목록의 각 행에 "Chat" 버튼(메모 + view/edit 선택) |
| 파일 미리보기 | 내려받지 않고 그 자리에서 본다 — 이미지·동영상·오디오·PDF·텍스트/코드/CSV/JSON. 파일 이름 클릭으로 열림. PDF 는 내용을 받아 `blob:` URL 로 렌더(스토리지 오리진을 프레임에 허용하지 않기 위해 CSP 는 `frame-src 'self' blob:` 만 연다). 텍스트는 512KB 까지, PDF 는 25MB 까지 미리보기 |
| 알림 | **웹 푸시**(0068) — 새 채팅 메시지 · 일정 초대 · 일정 알림이 앱을 닫아 두어도 OS 알림으로 도착한다(PWA 설치 시 iOS 16.4+ 포함). 설정에서 기기별로 켜고 끄고 테스트 발송. 권한은 사용자가 버튼을 누른 순간에만 요청. **이메일은 폴백** — 푸시를 안 켰거나 실패한 사람에게만 나가 같은 메시지로 두 번 알리지 않는다. 시간 기반 알림은 발송기(`/api/push/dispatch`)가 보내며 Vercel Cron · pg_cron · 열려 있는 앱 창 중 무엇이 두드려도 동작한다(claim 이 원자적이라 중복 발송 없음) |
| 캘린더 | 일정 공유(0066/0067/0069) — 월/주/일/아젠다 4개 보기, 달력 여러 개(색 구분)와 달력 단위 공유(viewer/editor), 참석자 초대 + RSVP(Going/Maybe/Can't go), 반복 일정(FREQ=DAILY\|WEEKLY\|MONTHLY\|YEARLY · INTERVAL · BYDAY · 종료일), 알림(0/5/10/30분·1시간·1일 전, 앱을 보고 있는 동안 토스트), 바쁨/한가함, 회의 링크, 일정에 문서·시트·코드·링크그래프·파일 붙이기, 일정을 채팅으로 보내기, 공유 달력 실시간 반영(`calendar:<id>` 토픽), ICS 구독 주소 발급(Google/Apple 캘린더에서 구독) + .ics 가져오기(한 번에 2,000건). 반복 일정은 **만든 사람의 시간대**로 전개되고, 한 발생만 골라 수정/삭제할 수 있다(EXDATE + 분리) |

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
    calendar/        캘린더 — 월/주/일/아젠다 · 일정 편집 · 달력 공유 · ICS
      calendar-shell.tsx  4개 보기 + 달력 목록 + 실시간 + 알림
      event-dialog.tsx    일정 편집(참석자·반복·알림·붙인 자료·RSVP)
      date-utils.ts       화면용 날짜 계산(순수 함수)
      actions.ts          캘린더 서버 액션
    sharing/         자료 공유 공용 서버 액션(카드 조회·대화 공유·권한 요청)
    push/            웹 푸시 — 구독 등록·기기 목록·발송기 하트비트
    send-to-chat-button.tsx  어느 목록/에디터에나 붙이는 "채팅으로 보내기"
  api/calendar/feed/ ICS 구독 피드(로그인 없이, 토큰으로만 인증)
  api/push/dispatch/ 일정 알림 발송기(cron·pg_net·열린 창 중 무엇이 불러도 됨)
  api/push/resubscribe/ 브라우저가 구독을 갱신했을 때 서비스 워커가 부르는 곳
  api/health/        배포 환경 진단(로그인 없이, 값은 절대 싣지 않음)
  auth/              콜백 · 로그아웃 라우트
components/codemirror/ 코드 에디터 래퍼 · 테마 · 언어 매핑
components/file-preview.tsx 파일을 내려받지 않고 보는 미리보기 모달
components/share-to-chat-dialog.tsx 대화 고르기 + 권한 안내
lib/supabase/        browser · server · middleware 클라이언트
lib/security-headers.ts 경로별 CSP/보안 헤더 구성
lib/ontology-links.ts 마인드맵/문서 콘텐츠에서 온톨로지 링크 추출
lib/use-media-query.ts SSR 안전 반응형 훅(useIsMobile 등)
lib/recurrence.ts    반복 일정 전개(RRULE 부분집합 · IANA 시간대 · EXDATE) — recurrence.test.mjs
lib/ics.ts           iCalendar 읽기/쓰기(접기·이스케이프·종일 경계) — ics.test.mjs
lib/push.ts          웹 푸시 발송(VAPID) — 죽은 구독 판별, web-push 는 지연 로드
lib/fetch-json.ts    API 응답을 방어적으로 읽는다(로그인 리다이렉트/HTML 구분)
public/sw.js         서비스 워커 — 알림 수신만(오프라인 캐싱 없음)
instrumentation.ts   서버 오류를 digest + 원문으로 로그에 남긴다(원인 추적용)
components/          공용 UI (모달 · 공유 다이얼로그 · 복사 필드)
supabase/migrations/ DB 마이그레이션
docs/                구축 지시서
```

### 단위 테스트

순수 함수는 의존성 없이 Node 로 바로 돌립니다(별도 러너를 두지 않습니다).

```bash
for t in $(find lib app -name '*.test.mjs'); do node "$t"; done
```

반복 일정은 시간대에 민감하므로 여러 시간대에서 함께 확인합니다:

```bash
for tz in UTC Asia/Seoul America/New_York Europe/Berlin Australia/Sydney; do
  TZ=$tz node lib/recurrence.test.mjs
done
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

### 5. 알림 설정 (웹 푸시)

없어도 앱은 정상 동작합니다 — 이 절을 건너뛰면 새 메시지 알림이 예전처럼
이메일로만 나갑니다.

**① VAPID 키 한 쌍을 만들어 환경 변수에 넣습니다(한 번만).**

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

```
VAPID_PUBLIC_KEY=B...      # 브라우저로 나가는 값 — 비밀이 아니다
VAPID_PRIVATE_KEY=...      # 절대 노출 금지
VAPID_SUBJECT=mailto:admin@yourdomain.com
```

> 키를 나중에 바꾸면 기존 구독이 전부 무효가 되어 모든 사용자가 설정에서 다시
> 켜야 합니다. 처음에 만들고 그대로 두세요.

여기까지 하면 **채팅 메시지와 일정 초대 알림**이 동작합니다. 각 사용자는
설정 → NOTIFICATIONS 에서 "Turn on for this device" 를 누르면 됩니다.

**② 시간 기반 일정 알림("10분 뒤 회의")을 켜려면 한 단계 더.**

이 알림은 아무도 아무것도 하지 않는 순간에 울려야 하므로, 밖에서 주기적으로
두드려 줄 것이 필요합니다. 관리자 콘솔의 **EVENT REMINDER DISPATCH** 패널에서
토큰을 발급해 환경 변수에 넣고 재배포하세요.

```
NOTIFY_DISPATCH_TOKEN=<관리자 콘솔에서 복사한 값>
```

> Supabase 서비스 롤 키를 쓰지 않는 이유: 그 키는 모든 RLS 를 무시합니다. 알림
> 하나 때문에 그런 키를 배포 환경에 심는 대신, "지금 보낼 알림 목록" 하나만
> 여는 전용 토큰을 씁니다.

두드리는 주체는 셋 중 아무것이나 됩니다(여러 개여도 안전합니다 — 대상 선정이
원자적이라 같은 알림이 두 번 나가지 않습니다).

- **Vercel Cron** — `vercel.json` 에 아래 한 블록을 더하면 됩니다. **기본으로
  넣어 두지 않았습니다** — Hobby 플랜은 하루 1회보다 잦은 cron 을 거부하고,
  그 경우 배포 자체가 실패하기 때문입니다. Pro 이상에서만 추가하세요.

  ```json
  "crons": [{ "path": "/api/push/dispatch", "schedule": "*/5 * * * *" }]
  ```
- **pg_cron + pg_net** — Supabase 만으로 끝내고 싶을 때. SQL Editor 에서 한 번:

  ```sql
  create extension if not exists pg_net;
  select cron.schedule(
    'possion-reminders', '*/5 * * * *',
    $$select net.http_post(
        url := 'https://<배포주소>/api/push/dispatch',
        headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
      )$$);
  ```

- **열려 있는 앱 창** — 아무 스케줄러도 없을 때의 마지막 보루입니다. 로그인한
  탭이 5분마다 한 번씩 두드립니다(화면이 보일 때만). 아무도 앱을 안 보고 있으면
  밀린 알림은 다음에 누군가 열 때 나갑니다.

### 6. 개발 서버

```bash
npm run dev
# http://localhost:3000
```

> 웹 푸시와 서비스 워커는 **HTTPS 또는 localhost** 에서만 동작합니다. 로컬
> 개발은 `localhost` 라 그대로 되고, LAN 의 IP 로 접속해 시험하면 알림이 켜지지
> 않습니다.

## 배포 (Vercel)

1. 저장소를 Vercel 에 연결
2. 환경 변수(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) 등록
3. Supabase Auth 의 Redirect URL 에 배포 도메인의 `/auth/callback` 추가
4. (선택) 알림을 쓰려면 `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT`,
   시간 기반 일정 알림까지 쓰려면 `NOTIFY_DISPATCH_TOKEN` — 위 "알림 설정" 참고.

> **미리보기(preview) 배포에도 환경 변수를 넣어야 합니다.** Vercel 은 변수마다
> Production/Preview/Development 를 따로 켭니다. Preview 에 `NEXT_PUBLIC_SUPABASE_*`
> 가 없으면 그 배포에서는 로그인 자체가 되지 않습니다.

### 배포에서만 나는 오류를 잡는 법

**digest 는 왜 재현이 안 되는가.** 프로덕션 빌드는 브라우저에
`An error occurred in the Server Components render` 와 `digest: <숫자>` 만
보냅니다. digest 는 서버가 오류 내용으로 만든 **해시**라 되돌릴 수 없고,
같은 오류가 나야만 같은 값이 나옵니다. 즉 digest 만으로는 원인을 알 수도,
로컬에서 같은 상황을 만들 수도 없습니다 — 그 오류를 일으킨 **환경**을 알아야
합니다. 그래서 다음 세 가지를 갖춰 두었습니다.

**① `/api/health` — 배포 환경이 지금 무엇을 갖고 있는지 한 번에.**

로그인 없이 열립니다(로그인이 깨졌을 때 봐야 하는 창이므로). **값은 절대
싣지 않고** 설정 여부(true/false)와 그 결과 켜지는 기능만 말합니다.

```bash
curl https://<배포주소>/api/health
```

```jsonc
{
  "ok": false,                       // core 가 false 면 앱이 정상일 수 없다
  "runtime": { "node": "v22.x", "env": "preview" },
  "env": { "NEXT_PUBLIC_SUPABASE_URL": true, "VAPID_PUBLIC_KEY": false, … },
  "webPush": { "loads": true, "error": null },   // 라이브러리 로드 가능 여부
  "db": { "reachable": true, "error": null,
          "migrations": { "0067_calendar_integrations": true } },
  "features": { "core": true, "webPush": false, "eventReminders": false }
}
```

이 한 번의 호출로 네 가지가 갈립니다 — **환경 변수 누락 / 라이브러리 로드 실패
/ DB 도달 불가 / 마이그레이션 미적용**. `db.error` 가 `missing-function` 이면
마이그레이션이 덜 돌았다는 뜻입니다.

**② `instrumentation.ts` — digest 옆에 실제 메시지를 찍는다.**

- Vercel: Deployments → 해당 배포 → **Logs** 에서 `[possion:error]` 로 검색.
  화면에서 본 digest 와 같은 값을 찾으면 그 줄에 원인이 적혀 있습니다.
- 로컬: `npm run build && npm start` 후 같은 문자열이 콘솔에 나옵니다.

**③ 오류 경계** — `app/(auth)/error.tsx` 와 `app/global-error.tsx` 가 digest 를
화면에 함께 보여 줍니다. 그 값을 ①②와 맞추면 됩니다.

## 범위

이번 단계는 인증 · 관리자 승격 · 파일 저장소 · 문서 편집 · 코드 에디터로
구성됩니다. 실시간 협업(Yjs)과 폴더 계층 구조는 포함하지 않습니다. 코드
에디터는 초기 지시서의 제외 항목이었으나 명시적 요청으로 추가되었습니다.
초기 요구사항은 [`docs/SaaS_구축_지시서.md`](docs/SaaS_구축_지시서.md) 참고.

---

## v1.6 상세 변경 기록

### 추가된 마이그레이션

| 번호 | 내용 |
| --- | --- |
| `0068_web_push.sql` | `push_subscriptions`(구독 정보 — RLS 로 본인만) + `profiles.push_notifications`. `claim_chat_push_recipients`(보낸 사람 본인만 호출 가능, 45초 이내 읽은 사람 제외 — 이메일의 15분 쿨다운은 두지 않는다), `claim_chat_email_recipients` 를 **`p_exclude` 인자를 받도록 재정의**(푸시로 알린 사람은 메일에서 뺀다), `claim_event_push_recipients`(일정 편집 권한자만), `prune_push_subscription`/`touch_push_subscription` |
| `0069_calendar_occurrences_and_reminders.sql` | `calendar_event_exceptions`(EXDATE) + `calendar_events.detached_from`·`next_reminder_at`. `delete_event_occurrence`·`detach_event_occurrence`(참석자·붙인 자료까지 복사, RSVP 는 초기화), `list_calendar_events`/`get_calendar_event`/`list_upcoming_events` 가 예외 목록과 시간대를 함께 반환, `set_next_reminder`, `app_secrets` + `get_dispatch_token`(관리자 전용), `claim_due_event_reminders`(토큰 인증 · `for update skip locked` 로 중복 발송 차단)·`set_next_reminder_by_token`·`prune_push_subscription_by_token`, `import_calendar_events`(한 문장 일괄 삽입) |

### 새 파일

| 파일 | 하는 일 |
| --- | --- |
| `lib/push.ts` | `web-push` 로 VAPID 발송. 404/410 은 죽은 구독으로 보고 지우고, 일시 장애는 구독을 남긴 채 넘어간다 |
| `public/sw.js` | 서비스 워커 — `push`·`notificationclick`(열려 있는 창을 재사용)·`pushsubscriptionchange`. **오프라인 캐싱은 하지 않는다** |
| `app/(app)/push/actions.ts` · `push-panel.tsx` | 구독 등록/해지, 기기 목록, 테스트 발송, 계정 단위 on/off |
| `app/(app)/push/reminder-heartbeat.tsx` | 스케줄러가 없는 환경의 마지막 보루 — 보이는 탭이 5분마다 발송기를 두드린다 |
| `app/api/push/dispatch/route.ts` | 일정 알림 발송기. 보낸 뒤 **다음 알림을 다시 예약**한다(반복 전개는 Node 에만 있다) |
| `app/api/push/resubscribe/route.ts` | 브라우저가 구독을 갱신했을 때 서비스 워커가 부른다 |
| `app/(app)/admin/dispatch-token.tsx` | 발송기 토큰 발급·회전(관리자 전용) |

### 변경된 기존 코드

| 파일 | 무엇이 바뀌었나 |
| --- | --- |
| `lib/chat-notify.ts` | `notifyChatByEmail` → **`notifyChatMessage`**. 푸시를 먼저 보내고, 받은 사람을 빼고 메일을 보낸다. 메일 문구도 "푸시가 설정되지 않아 메일로 보낸다"로 바뀌었다 |
| `lib/recurrence.ts` | IANA 시간대 달력(Intl 기반, DST 보정 2회 수렴) · `exceptions`(EXDATE) · `nextReminderAt()` 추가 |
| `app/(app)/calendar/actions.ts` | 저장 시 다음 알림 예약 + 초대 푸시(`after()` 안에서), `deleteOccurrence`/`detachOccurrence`, ICS 가져오기를 일괄 RPC 로 |
| `app/(app)/calendar/event-dialog.tsx` | "이 일정만 / 전체" 선택. 반복 주기를 고쳤으면 그 선택지를 감추고 이유를 말한다 |
| `app/(app)/calendar/calendar-shell.tsx` | 클릭한 발생을 다이얼로그로 넘긴다. **이 브라우저가 푸시를 구독 중이면 화면 안 배너 알림을 끈다**(같은 일정으로 두 번 알리지 않기 위해) |
| `app/(app)/chat/chat-shell.tsx` | 권한을 준 순간 `access` 브로드캐스트 → 받는 쪽 카드가 그 자리에서 열린다 |
| `components/file-preview.tsx` | 상한 상향 + `TextDecoder` 스트리밍으로 잘린 경계의 글자 깨짐 수정 |
| `lib/supabase/middleware.ts` | (v1.5 에서 추가한) 공개 경로 목록 유지 — 푸시 라우트는 인증이 필요하므로 추가하지 않았다 |
| `public/manifest.json` | `start_url`/`scope`/`display: standalone`/테마색/maskable 아이콘/바로가기 |
| `vercel.json` | 5분 간격 cron → `/api/push/dispatch` |
| `.env.example` | `VAPID_*`, `NOTIFY_DISPATCH_TOKEN`, `CRON_SECRET` |

### 검증 결과 (v1.6)

로컬 PostgreSQL 16 에 마이그레이션 0001~0069 를 재생하고, 사용자 3명으로 19개
시나리오 + RLS 전용 6개 검사를 돌렸습니다.

- 남의 메시지를 핑계로 다른 사람의 구독 주소를 긁을 수 없다(0행)
- 푸시로 알린 사람은 메일 대상에서 빠진다(Bob 제외 → Carol 만)
- 반복하지 않는 일정에는 예외를 만들 수 없고, 같은 발생을 두 번 분리할 수 없다
- 분리한 일정은 단발이 되고 참석자가 복사되며 응답은 초기화된다
- 발송기 토큰은 관리자만 읽고, **틀린 토큰으로는 0건**이며 그때 예약은 그대로 남는다
- 한 번 가져간 알림은 예약이 비어 **두 번 나가지 않는다**
- 거절(`declined`)한 참석자는 알림 대상에서 빠진다
- 일괄 가져오기에서 날짜 없는 항목은 버리고, 거꾸로 된 시간은 바로잡고,
  `javascript:` 링크는 제거된다
- RLS(authenticated 롤로 직접 확인): 자기 구독만 보이고, 남의 이름으로 구독을
  만들 수 없고, 남의 구독을 지울 수 없고, `app_secrets` 는 아무도 못 읽고,
  남의 일정에 예외를 만들 수 없다

단위 테스트 7종 전부 통과(반복 일정은 UTC · Asia/Seoul · America/New_York ·
Europe/Berlin · Australia/Sydney · Pacific/Kiritimati 6개 시간대에서, DST 전환
케이스 포함). `npx tsc --noEmit` 과 `npm run build` 경고 없이 통과.

### 배포 후 잡은 결함 (v1.6.1)

배포된 화면에서 `/login` 이 Server Components 오류로 죽는다는 보고를 받고
들여다보다, **미들웨어 matcher 가 정적 공개 파일까지 가로채고 있던 것**을
찾았습니다. 미인증 요청을 `/login` 으로 307 시키는 미들웨어가 `.json`/`.js`
는 걸러 내지 않아서, 이런 일이 벌어지고 있었습니다.

| 요청 | 받던 것 | 결과 |
| --- | --- | --- |
| `/sw.js` | `/login` **HTML** | 브라우저가 MIME 타입을 이유로 서비스워커 등록 거부 → **웹 푸시가 통째로 동작 불가** |
| `/manifest.json` | `/login` **HTML** | PWA 설치 정보 무시 → iOS 는 홈 화면 설치가 푸시의 전제라 **알림이 아예 불가능** |
| `/browserconfig.xml` | `/login` HTML | Windows 타일 설정 무시 |

즉 v1.6 의 알림 기능은 **배포 환경에서 한 번도 켜질 수 없는 상태**였습니다.
matcher 에 파일명을 직접 적어 다시 새지 않게 했고, 보호된 경로(`/dashboard`
`/settings` `/admin` `/api/*` 등 12개)가 여전히 로그인으로 튕기는지 함께
확인했습니다.

함께 손본 것:

- **`vercel.json` 의 5분 cron 을 뺐습니다.** Hobby 플랜은 하루 1회보다 잦은
  cron 을 거부하고 그때 **배포 자체가 실패**합니다 — 플랜을 모르는 채로 배포를
  깨뜨릴 수 있는 파일을 두는 것보다, 필요한 사람이 한 블록 붙이는 편이 낫습니다.
- **`instrumentation.ts` 추가** — digest 와 실제 오류 메시지를 한 줄에 함께
  로그에 남깁니다. 이제 화면의 digest 로 원인을 바로 찾을 수 있습니다.
- **`app/(auth)/error.tsx` 추가** — 로그인 화면에서 오류가 나도 루트 레이아웃째
  날아가지 않고 "다시 시도 / 로그인으로" 가 남습니다.

> 정직하게 적어 둡니다: 보고된 digest `3290735100` 자체는 로컬 프로덕션 빌드
> (`/login`, `/login?redirect=…`, RSC 내비게이션, 환경 변수 있음·없음, 도달
> 불가한 Supabase 주소 — 모두 200)에서 **재현하지 못했습니다.** digest 는 오류
> 내용의 해시라 되돌릴 수 없고, 같은 오류를 일으키는 **환경**을 알아야 재현이
> 되기 때문입니다. 그래서 원인을 추측으로 좁히는 대신 배포 환경이 스스로
> 답하게 만들었습니다 — 위 [배포에서만 나는 오류를 잡는 법](#배포에서만-나는-오류를-잡는-법) 의
> `/api/health` 와 `[possion:error]` 로그입니다.

### JSON 관련 전수 점검 (v1.6.1)

이번 사건이 "JSON 이어야 할 응답이 HTML 로 왔다" 였으므로, 같은 부류를 전부
훑었습니다.

**정적 JSON/XML 파일** — 저장소의 8개 JSON(`package.json` `tsconfig.json`
`vercel.json` `public/manifest.json` `src-tauri/tauri.conf.json`
`src-tauri/capabilities/default.json` `.vscode/settings.json` `package-lock.json`)과
`public/browserconfig.xml` 을 전부 파싱해 확인했습니다 — 모두 정상.

**JSON 을 읽는 코드 23곳** — 전부 확인했고, 보호가 없던 두 곳을 고쳤습니다.
문제의 모양은 사건과 똑같습니다: 세션이 만료되면 미들웨어가 `/api/...` 요청을
`/login` 으로 튕기고, fetch 는 리다이렉트를 따라가 **로그인 페이지 HTML** 을
받습니다. 그걸 그대로 `res.json()` 하면 사용자에게 `Unexpected token '<'` 이
그대로 나옵니다.

| 위치 | 전 | 후 |
| --- | --- | --- |
| `big-brother/agent-store.ts` | `res.json()` 직행 | `fetchJson` — "Your session expired — sign in again." |
| `code/[id]/assist-panel.tsx` | `res.json()` 직행 | 〃 |

공통 경로를 `lib/fetch-json.ts` 로 뽑았습니다. 로그인 리다이렉트·HTML 오류
페이지·깨진 JSON·네트워크 실패를 각각 구분해 사람이 읽을 수 있는 말로 바꾸고,
**HTML 조각이나 파서의 불평이 화면에 새어 나가지 않게** 합니다. 단위 테스트
(`lib/fetch-json.test.mjs`) 10건으로 그 동작을 고정했습니다.

같은 점검에서 함께 고친 것:

- `agent-store.ts` 가 시작 응답의 `interactionId` 를 확인하지 않고 폴링을
  시작하던 것 — 값이 없으면 `undefined` 로 계속 폴링하며 알 수 없는 오류를
  냈습니다. 응답 타입을 `StartedTurn`/`PolledTurn` 실제 타입으로 바꾸고,
  없으면 그 자리에서 이유를 말하도록 했습니다.
- **`lib/push.ts` 의 `web-push` 를 동적 import 로.** 최상위 import 는 이
  모듈을 참조하는 모든 라우트의 서버 번들에 딸려 들어가서, 그 라이브러리가
  어떤 배포 환경에서 로드에 실패하면 **알림과 무관한 페이지의 렌더까지 죽습니다**.
  알림 라이브러리가 로그인 화면을 무너뜨릴 수 있어서는 안 됩니다. 함께
  `next.config.mjs` 에 `serverExternalPackages: ["web-push"]` 를 넣어 번들링
  자체를 피했고, `/api/health` 의 `webPush.loads` 로 밖에서 확인할 수 있습니다.

### 개발 중 잡은 결함 (v1.6)

1. **UTC 자정 종일 일정이 어느 칸에도 안 잡힘** — 길이 0 인 일정의 범위 겹침
   판정을 반개구간으로만 해서 생긴 문제(v1.5 에서 이미 고친 것의 연장선에서,
   종일 반복 테스트로 재확인).
2. **`claim_due_event_reminders` 가 알림 시각을 잃어버림** — `UPDATE … RETURNING`
   은 새 값(비운 뒤의 null)을 돌려준다. 고를 때 옛 값을 CTE 에 먼저 담아 두도록
   바꿨다.
3. **일괄 가져오기가 남의 일정에까지 주최자를 붙임** — "참석자가 없는 내 일정"
   전체를 훑던 것을, 방금 삽입한 행으로만 좁혔다.
4. **푸시 공개키 타입** — `PushManager` 는 `SharedArrayBuffer` 가 아닌 뷰를
   요구한다. `new Uint8Array(new ArrayBuffer(n))` 으로 좁혔다.
5. **`list_upcoming_events` 가 시간대·예외를 안 보내 대시보드만 다른 결과를 냄**
   — 캘린더 화면과 같은 데이터를 주도록 함수를 다시 만들었다.

---

## v1.5 상세 변경 기록

### 추가된 마이그레이션

| 번호 | 내용 |
| --- | --- |
| `0065_share_to_chat.sql` | `live_object_owner`(휴지통 항목을 "없는 것"으로 판정), `grant_object_access`(소유자/관리자만, edit 를 view 로 내려깎지 않음), `share_object_with_conversation`(대화 멤버 전원에게 일괄 부여, `{can_grant, granted, members, already}` 반환), `get_object_cards`(첨부 카드 메타데이터 일괄 조회 — 권한 없는 항목은 소유자 이름만 남기고 내용 은닉), `request_object_access`(소유자만 알려 줌, 제목은 주지 않음), `list_attachable_objects`(파일 포함 + 검색) |
| `0066_calendar.sql` | `calendars` / `calendar_members` / `calendar_events` / `calendar_event_attendees` / `calendar_event_links` 5테이블 + RLS. 판정은 `can_view_calendar` · `can_edit_calendar` · `can_view_event` · `can_edit_event` 4개 SECURITY DEFINER 헬퍼로만(0017/0018 의 상호 재귀 재발 방지). RPC: `ensure_default_calendar` · `list_calendars` · `list_calendar_events` · `get_calendar_event` · `save_calendar_event` · `delete_calendar_event` · `respond_to_event` · `share_calendar` · `list_calendar_members` · `link_event_object` · `unlink_event_object` |
| `0067_calendar_integrations.sql` | `get_object_cards`/`list_attachable_objects` 에 `event` 종류 추가, `realtime_topic_viewable`/`realtime_topic_editable` 에 `calendar:<id>` 추가, 초대 시 개인 토픽(`user:<id>`)으로 알림 fanout 트리거, `calendar_feed_tokens` + `get_calendar_feed_token`(회전 가능) + `get_calendar_feed`(anon 실행 가능, 토큰이 유일한 인증), `list_upcoming_events` |

> 마이그레이션은 **번호 순서대로 전부** 실행해야 합니다. 위 "로컬 실행" 절의
> 목록은 초기 구간만 예시로 적어 둔 것입니다.

### 변경/보완된 기존 코드

| 파일 | 무엇이 바뀌었나 |
| --- | --- |
| `app/(app)/chat/markdown-parse.ts` | 첨부 토큰/경로에 `file`·`event` 종류 추가(`REF_KINDS`/`REF_ROUTES` 한 곳에서 관리). 메시지들에서 참조를 모으는 `extractRefs()` 신설 |
| `app/(app)/chat/chat-shell.tsx` | 칩 → 카드(`RefCard` + Context)로 교체, 전송 시 첨부 권한 자동 부여, 첨부 메뉴에 검색·파일·일정, 파일 첨부는 미리보기 모달로 열림, 일정 첨부는 `/calendar?event=…` 로, 성공 안내(notice) 줄 추가 |
| `app/(app)/chat/chat.css` | `.chat-ref-card` 계열, 안내 줄, 첨부 검색/안내 문구 스타일 |
| `app/(app)/files/files-client.tsx` | 파일 이름 클릭 = 미리보기, 행에 Preview·Chat 버튼, 저장소 항목 행에 Chat 버튼, 다운로드 트리거를 `lib/download-file.ts` 로 공용화 |
| `app/(app)/documents/documents-list.tsx`, `sheets/sheet-list.tsx`, `mindmap/mindmap-list.tsx` | 각 행에 "Chat" 버튼 |
| `app/(app)/sidebar.tsx`, `icons.tsx` | Calendar 메뉴 · `IconCalendar` |
| `app/(app)/dashboard/page.tsx`, `dashboard.css` | "UP NEXT" 줄(`upcoming-strip.tsx`) |
| `lib/security-headers.ts` | CSP 에 `frame-src 'self' blob:` — PDF 미리보기용. 원격 오리진은 프레임에 허용하지 않는다 |
| `lib/supabase/middleware.ts` | `/api/calendar/feed` 를 공개 경로로. 캘린더 앱은 세션 쿠키를 갖고 오지 않으므로 여기서 막으면 구독이 통째로 실패한다 |
| `lib/download-file.ts` | `triggerDownload()` — 앵커 클릭 방식(Tauri 웹뷰에서 `location.href` 가 앱 화면을 날려버리는 문제 회피) |
| `lib/database.types.ts` | 새 RPC 21개 + `calendars`/`calendar_members`/`calendar_feed_tokens` 타입 |

### 삭제된 것

- `chat-shell.tsx` 의 `onOpenRef` prop 전달 사슬(`InlineTokens` → `MessageBody` →
  `CollapsibleBody`). 카드가 Context 로 필요한 것을 직접 받으므로 더 이상
  네 단계로 함수를 흘려보내지 않습니다.
- 채팅의 `listAttachableItems()` 서버 액션(4개 테이블을 각각 25개씩 긁던 것).
  파일·일정까지 포함하고 검색이 되는 `list_attachable_objects` RPC 로 대체했습니다.
- `files-client.tsx` 안에 있던 다운로드 앵커 생성 코드(공용 함수로 이동).

### 검증 결과

로컬 PostgreSQL 16 에 Supabase 환경(`auth`/`storage`/`realtime`/`extensions`)을
스텁으로 세우고 마이그레이션 0001~0067 을 순서대로 재생한 뒤, 사용자 3명
(Alice·Bob·Carol)으로 25개 시나리오를 돌려 확인했습니다. 특히 다음이 의도대로
동작합니다.

- 볼 수 없는 자료는 공유할 수도 없다(예외)
- 소유자가 공유하면 대화 멤버 전원이 권한을 받고(`granted=2`), 다시 공유해도
  중복으로 나가지 않는다(`granted=0, already=2`)
- 소유자가 아닌 멤버가 공유하면 `can_grant=false, granted=0` — 조용히 실패하지 않고
  화면이 "소유자만 권한을 줄 수 있습니다" 라고 말한다
- 이미 `edit` 인 사람에게 `view` 를 다시 줘도 내려깎지 않는다
- 휴지통 항목은 소유자 조회가 `null` 이라 권한이 새로 나가지 않고, 카드는
  `object_exists=false`
- 권한 없는 사람의 카드에는 제목·크기·MIME 이 내려가지 않는다(소유자 이름만)
- 잘못된 UUID·모르는 종류·중복 참조가 섞여도 카드 조회가 깨지지 않는다
- 달력을 못 보는 사람도 **초대받은 일정은** 보이고, 편집은 안 된다
- RSVP 는 초대받은 본인만, 일정을 수정해도 이미 한 응답은 보존되고 명단에서
  빠진 사람은 참석자에서 사라진다
- 달력 공유는 소유자만, 일정 삭제는 편집 권한자만
- ICS 토큰은 재호출 시 같은 값(64자), 회전하면 옛 토큰은 즉시 0건
- 실시간 토픽 인가: 남의 개인 토픽(`user:<타인>`)과 형식이 깨진 토픽은 거부

`lib/recurrence.ts` 와 `lib/ics.ts` 는 단위 테스트로 확인했습니다(UTC ·
Asia/Seoul · America/New_York · Europe/Berlin · Australia/Sydney 5개 시간대에서
동일 통과). `npx tsc --noEmit` 과 `npm run build` 는 경고 없이 통과합니다.

### 개발 중 잡은 결함 (기록)

1. **첨부 카드 무한 요청.** 조회 대상을 "아직 `cards` 에 없는 것" 으로 잡았는데,
   서버가 어떤 참조에 대해 행을 돌려주지 않으면(모르는 종류 등) 그 키가 영영
   채워지지 않아 응답 → 상태 변경 → 재요청이 무한 반복됐습니다. "아직 **물어보지**
   않은 것" 기준(`requestedCards` ref)으로 바꿨습니다.
2. **종일 전환에서 하루 밀림.** 시각이 있던 일정을 "종일" 로 바꿀 때 날짜를 UTC 로
   읽어, 서울 오전 8시 일정이 전날로 넘어갔습니다. 이 전환에서는 로컬 날짜를
   집도록 `toDateInputLocal()` 을 따로 뒀습니다.
3. **길이 0 인 일정이 어느 칸에도 안 잡힘.** 범위 겹침을 반개구간으로만 따져서,
   시작=끝인 일정이 범위 시작과 정확히 같은 순간이면 사라졌습니다. 길이가 0 일
   때는 시점 포함으로 판정합니다.
4. **오래전에 시작한 매일 반복이 화면에서 사라짐.** COUNT 가 없는 반복을 첫
   발생부터 한 걸음씩 걸어오다 상한에 걸렸습니다. COUNT 가 없으면(발생 번호를
   쓸 데가 없으면) 보이는 범위 근처까지 건너뛰도록 했습니다.
5. **"Share here" 를 눌러도 아무 일이 없음.** 카드의 공유 버튼을 `can_edit`
   기준으로 내보냈는데, 권한을 줄 수 있는 사람은 소유자뿐입니다. 소유자에게만
   버튼을 보여 주고, 그래도 못 준 경우에는 이유를 말합니다.
6. **CSS 격자 오류.** 주/일 보기의 열 개수를 `repeat(auto-fit, minmax(0,1fr))` 로
   잡았는데 `1fr` 트랙에서는 의도대로 동작하지 않습니다. 컴포넌트가 `--cal-days`
   커스텀 속성으로 열 개수를 넘기도록 고쳤습니다.
7. **ICS 피드가 로그인 벽에 막힘.** 미들웨어가 모든 경로를 보호해 캘린더 앱이
   로그인 화면 HTML 을 받아 갔습니다. 그 라우트만 공개로 열고 인증은 토큰으로
   합니다.

### v1.5 에서 적었던 한계 — v1.6 에서의 상태

| v1.5 의 한계 | 지금 |
| --- | --- |
| 알림이 앱을 켜 둔 동안에만 울림 | **해결.** 웹 푸시로 앱을 닫아도 도착한다(0068). 이메일은 폴백으로 남았다 |
| 반복 일정의 "이번 것만 수정/삭제" 없음 | **해결.** EXDATE + 분리(0069). Save/Delete 가 this / all 로 갈린다 |
| 반복이 보는 사람의 로컬 시간대로 전개됨 | **해결.** 만든 사람의 IANA 시간대로 전개(서머타임 포함 테스트) |
| .ics 가져오기 200건 | **완화.** 2,000건 — 한 문장 삽입으로 바꿔 왕복이 한 번이다 |
| 첨부 카드 권한이 대화를 다시 열어야 갱신됨 | **해결.** 권한을 준 순간 그 카드만 실시간으로 다시 읽는다 |
| 텍스트 512KB · PDF 25MB 미리보기 | **완화.** 4MB · 100MB. 잘린 경계의 한글 깨짐도 수정 |
| 재공유는 소유자만 | **유지 — 의도된 설계.** 아래 참고 |
| ICS 내보내기는 읽기 전용 | **유지 — 범위 밖.** 아래 참고 |

### 알려진 한계 (v1.6)

고치지 않은 것은 아래가 전부이고, 각각 왜 그런지 함께 적습니다.

- **푸시를 켜지 않은 사람에게는 여전히 이메일이 갑니다.** 이건 결함이 아니라
  설계입니다 — 알림을 아무도 못 받는 상태를 만들지 않기 위한 폴백입니다.
  서버에 VAPID 키가 없으면 예전과 똑같이 이메일만 나갑니다.
- **iPhone/iPad 는 홈 화면에 설치해야 알림이 옵니다.** Safari 가 설치된 웹앱
  에만 푸시를 허용하기 때문이고(iOS 16.4+), 우리가 우회할 수 있는 제약이
  아닙니다. 설정 화면이 이 상황을 알아보고 그렇게 안내합니다.
- **시간 기반 일정 알림은 밖에서 두드려 줄 것이 하나는 있어야 합니다.**
  Vercel Cron·pg_cron·열려 있는 앱 창 중 아무것도 없으면 그 알림만 밀립니다
  (채팅·초대 알림은 그 순간 사람이 있으므로 영향이 없습니다). 브라우저 안에서
  미래 시각에 알림을 예약하는 표준 API 는 사실상 없습니다.
- **반복 규칙 범위**: `FREQ`(DAILY/WEEKLY/MONTHLY/YEARLY) · `INTERVAL` ·
  `BYDAY`(주간에만) · 종료일 · `COUNT`(가져오기 시). "매월 둘째 화요일"
  (`BYDAY=2TU`) 같은 서수 규칙은 요일만 읽습니다.
- **ICS 가져오기**는 제목·시간·장소·메모·반복만 들여옵니다(참석자·첨부·예외일은
  버립니다). `TZID` 는 해석하지 않고 "적힌 시각 그대로" 를 지킵니다.
- **ICS 내보내기는 읽기 전용**입니다. 외부 캘린더에서 고친 내용은 Possion 으로
  돌아오지 않습니다. 양방향은 CalDAV 서버를 구현하는 일이라 이 단계의 범위를
  한참 넘습니다.
- **재공유는 소유자만** 할 수 있습니다. `edit` 공유를 받은 사람이 제3자에게 다시
  뿌리는 경로는 **일부러** 만들지 않았습니다 — 자료를 누가 볼 수 있는지는
  소유자가 끝까지 알 수 있어야 합니다. 대신 권한이 없는 사람이 한 번의 클릭으로
  소유자에게 요청할 수 있게 해 두었습니다.
- **서비스 워커는 오프라인 캐싱을 하지 않습니다.** 알림만 받습니다. 이 앱의
  화면은 대부분 서버가 권한을 확인해 그리는 것이라, 캐시된 화면을 보여 주는 것은
  "권한이 회수된 자료를 계속 보여 주는" 일이 되기 쉽습니다.
- **알림 본문에 메시지 내용을 넣지 않습니다.** 알림 센터와 메일함은 앱보다 통제가
  약한 곳이고, 팀 대화 내용이 그리로 새어 나가면 되돌릴 수 없습니다. 누가 어디에
  보냈는지만 알리고 나머지는 앱에서 보게 합니다.
