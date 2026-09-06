# Possion (H-1 Prototype, beta v1.6.21)

Schema Tool for Users. Orchestrate Intelligence.

Last Update in August 2, v1.6.21 by Haewon Jeong
Co-development with Yegrina Haute Group Infrastructrue.
more info in www.officialyegrina.com

> Deployment Archive for Infrastructure

## OS Infrastructure update(v1.6.21)


### 모션 — 커브에 이름을 붙였다

애플의 모션은 "커브 하나 + 상황별 길이"로 정리된다. `--ease-out`,
`--ease-in-out` 을 기존 `--ease-spring` 옆에 추가하고 길이를 세 단계
(`--dur-fast/base/slow`)로 묶었다. chat.css·editor.css 에 문자 그대로
복사돼 있던 `cubic-bezier(0.32, 0.72, 0.25, 1)` 도 토큰으로 바꿨다.

**접근성 구멍 하나를 메웠다** — `prefers-reduced-motion` 처리가
calendar.css·editor.css 에만 있고 globals.css 엔 아예 없어서, 앱 대부분의
전환이 OS 설정을 무시하고 그대로 움직이고 있었다. 전역 블록을 넣어
길이를 1ms 로 눌렀다(0 이 아니라 1ms 인 이유: `transitionend` 를 기다리는
코드가 이벤트를 못 받고 멈추지 않게). 위치가 튀는 transform 만 없애고
색 피드백은 남긴다.

### 버튼 — 위계를 하나 더

누름 피드백을 `scale(0.96)` + `--dur-fast` 로 바꿔 손가락 속도를 따라가게
하고, 애플의 2순위 액션 스타일인 `.btn-tinted`(테두리 없이 옅은 액션색
배경 + 액션색 글자)를 추가했다. 한 화면에 이미 채운 버튼이 있는데 두 번째
액션도 무게가 필요할 때 쓴다.

### 아이콘 — SF Symbols 비율로

획 두께 1.7 → 1.6(24 격자에서 SF Symbols Regular 의 비율), 사각형 모서리
반경을 더 넉넉하게. 1.4~1.5 까지 얇게 가면 저해상도에서 흐려지므로 1.6 이
하한이다.

### 카드 — grouped inset list

관련된 항목을 각각 카드로 흩어 놓는 대신 둥근 상자 하나에 담고 얇은 선으로만
나누는 애플 설정앱 방식(`.card-group` / `.card-row`)을 추가했다. 구분선은
행의 왼쪽 안쪽 여백에서 시작한다 — 상자의 둥근 모서리까지 닿지 않게 해서
목록이 가로로 잘려 보이지 않게 하는 애플의 처리다. 설정 화면의 ACCOUNT
섹션(Email / Access level)에 적용했다.

### 기능 점검에서 나온 것들

디자인 작업과 별개로 실제 버그 여덟 개를 찾아 고쳤다. 그중 둘은 배포를
막을 만한 것이었다.

- **오래된 매월/매년 반복 일정이 통째로 사라졌다.** `periodsBefore()` 가
  건너뛸 주기 수를 셀 때 달을 28일(최솟값)로 잡아 실제 평균 30.44일 대비
  매달 8.7% 씩 앞질러 셌다. `-1` 의 여유는 약 1년치 오차만 흡수하므로 그보다
  오래된 일정은 캘린더·대시보드에서 안 보이고 알림도 끊겼다 — 실제로
  2023년 시작 일정은 두 번 중 한 번이, 2020년 시작 일정은 전부 사라지는 것을
  `expandOccurrences()` 로 재현했다. 주기 길이를 최댓값(31일/366일)으로
  바꿨고, 2019/2022/2024년 시작 일정에 대한 회귀 테스트를 넣었다(옛 값에서
  실패하는 것까지 확인).
- **시간 기반 알림이 앱 창을 열어 둔 동안에만 나갔다.** `/api/push/dispatch`
  는 외부 스케줄러용 `CRON_SECRET` 인증을 갖고 있는데, 미들웨어의 공개 경로
  목록에 없어 쿠키 없는 호출이 `/login` 으로 307 되며 그 검사에 닿지도
  못했다. README 가 안내하는 두 경로(Vercel Cron·pg_cron) 모두 쿠키가 없다.
  `/api/calendar/feed` 와 같은 방식으로 열었다 — 라우트 자신의 503/401 검사는
  그대로다.
- 반복 일정의 종료일을 문자열로 비교해(`…Z` vs `…+00:00`) 늘 "규칙이 바뀐
  것"으로 판정 → 종료일 있는 반복 일정은 "이 일정만 수정"이 아예 불가능했다.
- 저장 시 `COUNT=10` 같은 반복 횟수를 버려, ICS 로 가져온 "10번만" 일정이
  한 번 열었다 저장하면 영원히 반복되는 일정이 됐다.
- 자정에 끝나는 일정이 다음 날 칸에도 유령으로 하나 더 걸렸다(`>` → `>=`).
- 프로필 조회가 잠깐 실패하면 이미 팀에 속한 사람을 팀 생성 온보딩으로
  보냈다 — 임시 프로필의 `active_team_id: null` 은 "팀 없음"이 아니라
  "모름"인데 그 값으로 라우팅했다.
- 알림 하트비트가 탭 전환마다 발송기를 두드렸다(최소 간격 1분 추가).
- `SLO` 의 `Record<string, …>` 애노테이션이 키 타입을 넓혀 `SloFeature` 가
  사실상 `string` 이었다 — 오타가 컴파일을 통과한 뒤 런타임에 조용히 사라졌다.
  `satisfies` 로 바꿔 오타가 컴파일 에러가 된다.
- 문서 에디터의 위키링크 보정이 취소 없이 `editor.view` 에 dispatch 해,
  요청 중 탭을 닫으면 파괴된 뷰를 건드렸다.

리뷰가 지적했지만 실제로는 문제가 아니었던 것도 있다 — `repositories/actions.ts`
의 에러 통과는 이미 손으로 쓴 예외 문구만 골라내고 있었고, `start_chat_dm` 은
`security definer` 라 RLS 위반이 올라올 수 없다(다만 제약조건 위반 같은 예상 밖
실패는 Postgres 내부 문구를 흘릴 수 있어 허용 목록 방식으로 맞췄다).

## 대시보드 재구성 · 저장소 그래프 SNA · 모바일 리스트 · 캘린더 색상 (v1.6.20)

**요청**: 여덟 가지. (1) Refresh/Add new 류의 "아이콘+텍스트" 알약 버튼을
앱 전반에서 아이콘만 있는 원형으로 바꾸되(단, "Manage all Possion users"
류의 의미 있는 라벨 버튼은 유지), (2) 대시보드 LIVE 배지 제거 + 태블릿
폭에서 저장공간 카드 우측이 비는 버그 수정 + 데스크톱에서 세로 스크롤 없이
한 화면에 들어오게, (3) Repository 의 List/Graph 를 Switch 형 토글로 분리하고
그래프에 클릭/스크롤/확대(팬·줌) 지원 + 실제 연결관계(object_links)를 SNA
알고리즘(Brandes 매개 중심성, Louvain 커뮤니티 탐지)으로 시각화, (4) 문서
목록류(Docs/Sheets/Link Graph/Code Space/Files/Trash)의 모바일 좌우 스크롤을
없애고 세로 카드로, (5) 캘린더 인터페이스 보완, (6) PC/모바일 인터페이스를
사용 방식에 맞게 다르게 설계, (7) 캘린더 일정에 색상+의미(태그) 지정 기능
추가(채팅 공유는 이미 있음). 마지막으로 기능 검증과 PC 레이아웃 스크린샷을
요청.

### 아이콘 전용 원형 버튼

`app/globals.css` 에 `.btn-icon`(정사각형 → `border-radius:999px`, 기존
`.btn`/`.btn-sm`/`.btn-primary`/`.btn-ghost` 와 조합) 을 추가하고
Refresh(`refresh-button.tsx`), 각 페이지의 "+ New"/"Add files" 류 버튼,
저장소의 Upload File(원형 `+`, `.btn-group-sep` 구분선으로 나머지
+Doc/+Table 묶음과 분리), 캘린더 "New calendar"/"Reset link" 등을
전환했다. 이미 아이콘만 있었지만 원형이 아니었던 Undo/Redo/닫기 버튼들도
같은 클래스를 입혀 통일했다. 터치 기기(`@media (pointer: coarse)`)에서는
시각 크기는 그대로 두고 히트 영역만 WCAG 권장치(~44px)에 가깝게 키웠다.

### 대시보드 — 스크롤 없이 한 화면

LIVE 배지(`GlowingBadge`) 제거, 그래프 높이 축소(150px→110px), UP NEXT
목록을 3~4개로 캡(`max-height` + 내부 스크롤), 사이드바의 MY STORAGE
USAGE/SHARE OF PLATFORM TOTAL/MY SHARE ID 세 카드를 STORAGE 카드 하나로
병합(구분선만으로 구획). 저장공간 범례가 태블릿 폭에서 오른쪽이 비어
보이던 버그는 `.stg-legend` 의 `grid-template-columns` 가
`auto-fill`(항목 수와 무관하게 폭에 맞는 트랙을 예약) 이었던 게 원인 —
`auto-fit`(빈 트랙을 접어 채워진 항목이 남는 폭으로 재분배)으로 고쳤다.

### 저장소 그래프 — 팬/줌 + SNA

List/Graph 탭 버튼을 `Switch` 하나로(라벨 클릭 또는 드래그로 토글).
그래프 SVG 에 휠/핀치 확대·배경 드래그로 팬·리셋 버튼을 추가했다(이전엔
클릭 내비게이션과 노드 드래그만 가능했다). 그래프 자체는 이미
`get_repository_graph`(0078)로 실제 `object_links`/폴더 포함관계/캘린더
연결을 그리고 있었다 — 여기에 SNA 두 지표를 얹었다: 노드 반지름은 Brandes
매개 중심성(다리 역할을 하는 노드일수록 큼), 테두리 색은 Louvain
커뮤니티(같은 색 = 촘촘히 엮인 군집). 두 알고리즘은
`lib/graph-sna.ts`(순수 함수) + `lib/graph-sna.test.mjs`(다리/별/완전
그래프로 매개 중심성을, 두 삼각형이 다리 하나로 이어진 그래프로 커뮤니티
분리를 검증)로 독립적으로 테스트했다.

### 모바일 리스트 — 카드로 펼치기

`.table` 이 640px 이하에서 각 `<tr>` 을 세로 카드로 펼치도록
`app/globals.css` 에 규칙을 추가했다 — 헤더 행은 숨기고(`data-label`
속성이 그 역할을 대신한다), 제목 칸(`.table-cell-title`)은 카드 제목처럼
크게, 값이 있는 칸은 `라벨 · 값` 형태로 양쪽 정렬. Documents/Sheets/Link
Graph/Files/Trash 각 리스트의 `<td>` 에 `data-label` 을 달았고, 이전엔
모바일에서 `.col-hide-mobile` 로 통째로 숨기던 열(Code Space 의 Source,
Files 의 Size/Move to, Trash 의 Type)도 이제 라벨 붙은 줄로 보여준다 —
정보를 숨기는 대신 세로로 펼치는 쪽을 택했다.

### 캘린더 — 일정별 색상(태그)

`calendar_events.color`(nullable — null 이면 캘린더 자체 색 상속)와
`save_calendar_event` RPC 는 이미 색을 받고 있었고, 월/주/일/아젠다
렌더링도 `eventColor()` 로 이미 그 값을 읽고 있었다 — 다만 일정
편집창에 색을 고르는 UI 자체가 없었다. 캘린더 생성창의 원형 스와치
(`.cal-color`)를 재사용해 이름이 붙은 프리셋(Work/Meeting/Urgent/
Deadline/Personal/Travel/Social/Other + "Calendar default")을 추가했다
— 색마다 의미가 고정돼 있어야 "태깅"의 의미가 생기므로, 자유 색상 선택
대신 이름 있는 팔레트로 설계했다. 채팅으로 일정 공유는 이미
`SendToChatButton` 으로 되어 있었다.

### Sophia 삭제 (v1.6.19)

0082 는 Big Brother 만 지우고 Sophia(`/sophia`, 개인 AI 채팅)는 남겨
뒀는데, 이번엔 그 기능 자체가 필요 없다는 요청으로 코드를 통째로
지웠다. `app/(app)/sophia/`, `app/api/sophia/`,
`lib/big-brother-*.ts`(Big Brother 삭제 때 놓친 잔재), `lib/bb-attachments*.ts`,
`lib/paper-code-search.ts`, `lib/code-space.ts`, `components/thinking-indicator.tsx`
삭제. `code-agent`/`code-assist`(별개의 실제 기능, GEMINI/CLAUDE 키를
공유할 뿐)와 `lib/embeddings.ts`(헤더 검색의 RAG 파이프라인, Sophia 와
무관하게 계속 쓰임)는 감사 후 남겼다. 마이그레이션 0083 이 `ai_conversations`/
`ai_messages`/`ai_conversation_plugins` 세 테이블과 `list_conversation_plugins()`
를 지운다.

### 검증

`npx tsc --noEmit`, `npm run build`, `node --test`(18개, `graph-sna.test.mjs`
신규) 모두 통과. 라이브 Supabase 프로젝트나 `.env.local` 이 이 작업 환경에
없어 실제 인증된 화면을 띄워 볼 수는 없었다 — 대신 실제 프로젝트 CSS를
그대로 복사해 정적 HTML로 재현하고 Playwright(사전 설치된 Chromium)로
여러 뷰포트(1440/1280/900/390px)에서 스크린샷을 찍어 레이아웃을
검증했다(대시보드 태블릿 폭 버그 재현/수정 확인, 모바일 카드 스택,
그래프 팬·줌 CSS, 터치 히트 영역 실측 포함). 이 방식이 실제 앱 코드가
아니라 그 복제본을 그린 것이라는 한계는 있다.

## 팀(워크스페이스) 시스템 + Big Brother 삭제 (v1.6.18)

**요청**: 세 가지. (1) 대시보드 "THIS WEEK" 위젯이 이번 주에 새로 만든 것만
세던 걸 고쳐서 만든 것과 고친 것을 함께 세게 할 것. (2) 가입 시 팀을
선택/생성하는 다중 테넌트 워크스페이스 기능을 처음부터 설계해 추가할 것 —
팀장 위임/승인/공개설정/삭제, 팀별 Repository·채팅 분리, 여러 팀 소속 +
헤더에서 전환, 그 과정에서 필요하다고 판단되는 것들도 함께 고려할 것.
(3) Big Brother 메뉴/기능을 코드까지 전부 삭제하되 Sophia 등 기존 기능이
깨지지 않게 검토할 것. 마지막으로 이 모든 걸 시뮬레이션으로 검증할 것.

### THIS WEEK — 편집도 센다

`my_weekly_activity()`(0079)가 documents/code_files/sheets/mind_maps 를
`created_at` 기준으로만 버킷팅해서, 이번 주에 고친 지난주 문서는 잡히지
않았다. **0081**에서 이 네 테이블만 `updated_at` 기준으로 바꿨다(모든
테이블이 `updated_at` 이 `created_at` 과 같은 값으로 시작해 편집 시에만
갱신되므로, "새로 만든 것"과 "고친 것"을 자연스럽게 함께 센다).
`files` 는 `updated_at` 컬럼 자체가 없어 그대로 `created_at`. 대시보드
막대그래프(`weekly-activity-chart.tsx`) 캡션도 "items created this week"
→ "items added or edited this week" 로 맞춰, 숫자가 실제로 세는 것과
문구가 어긋나지 않게 했다.

### 팀(워크스페이스) — 설계와 범위

Slack 의 워크스페이스 전환 모델을 참고했다: 한 사용자가 여러 팀에 속할 수
있고, 헤더의 팀 전환기로 "지금 활동 중인 팀"(`profiles.active_team_id`)을
바꾼다. 요청 문장을 그대로 따라 **Repository 와 채팅만** `team_id` 로
직접 스코프했다("Repository 와 그에 속한 파일, 채팅 내용들은 상이하며").
문서/코드/시트/마인드맵은 저장소와 달리 원래부터 개인 소유 + 개별 공유
모델이라 팀 컬럼을 새로 얹지 않고, 대신 **공유(공유 권한 부여) 자체를
"같은 팀끼리만" 로 제한**했다 — 다섯 개 `*_permissions` 테이블의 INSERT
정책 전부에 `shares_active_team(user_id)` 조건을 추가하는 방식. 소유권/열람
모델 전체를 다시 쓰는 것보다 범위가 좁고 안전하면서, "같은 팀끼리만 공유"
라는 요청을 그대로 만족한다.

**스키마 (`0080_teams.sql`)**
- `teams`(이름/설명/공개여부/팀장) + `team_members`(팀·유저·상태
  `active`/`pending`) — 직접 INSERT/UPDATE/DELETE 는 RLS 로 전부 막고
  아래 SECURITY DEFINER RPC 로만 바뀐다(0017/0018/0040 에서 확립한, RLS
  자기참조 재귀를 피하는 패턴을 그대로 재사용).
- `profiles.active_team_id` — "지금 선택된 워크스페이스" 포인터. 팀이
  삭제되면(`on delete set null`) 자동으로 비고, 다음 진입 시 온보딩으로
  다시 보낸다.
- RPC: `create_team`/`request_join_team`(공개 팀은 즉시 가입, 비공개는
  대기)/`approve_team_member`/`reject_team_member`/`remove_team_member`/
  `leave_team`(팀장은 위임·삭제 전엔 못 나간다)/
  `transfer_team_leadership`/`set_team_open`/`delete_team`/
  `set_active_team`, 조회용 `search_teams`/`list_my_teams`/
  `list_team_members`.
- `repositories.team_id` — BEFORE INSERT 트리거(`set_repository_team`)가
  소유자의 현재 활성 팀에서 자동으로 채운다. 기존
  `createRepository()`(app 코드)는 손댈 필요가 없다.
- 채팅: `chat_conversations.team_id` 추가, `start_chat_dm`/
  `create_chat_group`/`add_chat_members` 가 전부
  `shares_active_team()` 로 상대를 걸러낸다. `list_coworkers()` 도 같은
  조건을 얹어 — 이 RPC 하나를 스코프하는 것만으로 코워커 디렉터리 페이지,
  채팅 새 대화 상대 선택창이 **전부 자동으로** 같은 팀으로 좁혀진다(호출
  지점을 하나하나 고칠 필요가 없었다).
- 팀 삭제는 비파괴적이다 — `repositories.team_id`/`chat_conversations.
  team_id`/`profiles.active_team_id` 전부 `on delete set null`. 이
  세션이 지금까지 지켜온 "사용자 콘텐츠는 진짜로 지우지 않는다" 원칙과
  같다(Repository 삭제가 자식을 "Null Repository" 로 고아 처리하는 것과
  동일한 결).

**앱 레이어**
- 가입 온보딩(`app/(auth)/choose-team/`) — `active_team_id` 가 없으면
  `app/(app)/layout.tsx` 가 관리자 승인 검사보다 먼저 이리로 보낸다(대기
  중에도 팀은 먼저 고를 수 있어야 하므로). 팀 검색+가입 신청 / 새 팀
  만들기 두 탭.
- 헤더 팀 전환기(`app/(app)/team-switcher.tsx`) — 계정 메뉴(`.acct`)와
  같은 유리 드롭다운 규약. 내 팀 목록(클릭 전환, pending/현재 배지),
  팀 검색+가입, 새 팀 만들기, 팀장이면 "Team settings →" 로 관리 페이지
  링크.
- 팀 관리 페이지(`/team`, `app/(app)/team/`) — 대기 승인 요청(팀장),
  멤버 명단(공개/비공개 전환, 리더 위임, 추방 — 전부 팀장 한정), 나가기
  버튼(팀장은 위임/삭제 전엔 비활성 — 이유를 그대로 보여준다).
- 공유 대화상자 5곳(문서/코드/시트/마인드맵/파일) — "Share ID" 를 입력해
  공유하는 흐름이 팀이 다른 상대를 골라도 그전엔 "존재하지 않는 사용자
  같다"는 뭉뚱그린 에러만 봤다. `shares_active_team` RPC 로 미리 확인해
  "You can only share with members of your current team." 로 정확한
  이유를 보여준다. 채팅의 `startDm`/`createGroup`/`addMembers` 도
  RPC 가 이미 손으로 써 둔 친절한 예외 문구(`raise exception`)를 뭉뚱그린
  메시지로 덮지 않고 그대로 통과시키도록 고쳤다.
- 설정 페이지의 "MY SHARE ID" 설명 문구도 "팀끼리만 공유된다"는 걸
  명시하도록 수정.

### Big Brother 삭제

`/big-brother` 메뉴와 그 아래 세 탭(Assistant · Agent/Antigravity 전체
코드스페이스 에디터 · 논문/깃허브 검색 콘솔)을 전부 지웠다. 삭제 전에
탐색 에이전트로 먼저 감사한 이유: Sophia 의 실제 채팅 백엔드
(`lib/big-brother-claude.ts`/`lib/big-brother-gemini.ts`/
`lib/bb-attachments*.ts`, `/api/sophia/chat`)가 이름만 같은 "Big
Brother" 네이밍을 내부적으로 그대로 쓰고 있어서, 이름으로만 지우면
Sophia 자체가 부서질 뻔했다.

- 지운 것: `app/(app)/big-brother/` 전체, `/api/antigravity`,
  `/api/sophia/chat-mention`, `lib/antigravity.ts` — Agent 탭(전체
  코드스페이스 AI 에디터)은 메뉴 삭제 요청에 포함된 기능이라 별도 보존
  요청이 없는 한 함께 지웠다.
- `app/(app)/sophia/page.tsx` 를 `/big-brother` 로의 리다이렉트에서
  원래의 채팅 화면으로 되돌리고, 사이드바에 `/sophia` 항목을 다시 추가—
  메뉴가 없어지면 Sophia 로 들어갈 방법이 아예 사라지기 때문.
- Sophia 백엔드 파일명/내부 식별자(`lib/big-brother-*.ts`,
  `runBigBrotherClaude` 등)는 그대로 뒀다 — 실사용자 눈에 안 보이는
  내부 리팩터라 이번 요청의 범위 밖. 대신 시스템 프롬프트, 에러 메시지,
  채팅 UI 문구, `.env.example` 주석, README 기능표 등 **사용자에게
  보이는 문자열은 전부** "Big Brother" → "Sophia" 로 고쳤다 — 메뉴는
  지웠는데 화면에 옛 이름이 남으면 그 자체로 버그처럼 보인다.
- 채팅에서도 `@bigbrother` 멘션, "+ Big Brother" 초대/제거 버튼,
  `bigbrother_enabled` 컬럼, `is_bot` 메시지 분기(`0082`)를 전부
  지웠다. 그룹이 아닌 DM 에서만 있던 "..." 더보기 메뉴가 Big Brother
  버튼이 빠지며 텅 빈 채로 남지 않도록, 그 메뉴 자체를 그룹 대화에서만
  렌더링하게 조건을 다시 짰다.

### 검증

- `npx tsc --noEmit -p .`, `npm run build` — 전부 경고 없이 통과
  (`/big-brother` 라우트 사라짐, `/team`·`/choose-team` 새 라우트 확인).
- `node --test` — 단위 테스트 18개 전부 통과(Big Brother 전용 테스트
  파일 2개는 삭제와 함께 목록에서 자연히 빠짐, 그 외 회귀 없음).
- 로컬 Postgres 16(+ 실제 pgvector/pg_cron 확장 설치, 이전엔 조악한
  스텁으로 대신하던 걸 이번에 진짜 확장으로 바꿨다)에 82개 마이그레이션을
  전부 재생해 스키마가 처음부터 끝까지 충돌 없이 쌓이는 것을 확인했다.
  이어서 가짜 사용자 3명(alice/bob/carol)으로 실제 RLS/JWT 클레임을
  흉내 내는 기능 시뮬레이션을 돌려 — 팀 생성/검색/공개 팀 즉시가입/
  비공개 팀 승인 대기, 팀이 다르면 DM·문서 공유가 막히고 같은 팀이면
  되는지, 저장소 `team_id` 자동 채움, 리더 위임과 위임 전 삭제 금지,
  삭제 시 멤버 전원의 `active_team_id` 가 콘텐츠는 그대로 둔 채 풀리는지,
  코워커 목록 팀 스코핑, 이번 주 활동에 편집이 잡히는지까지 전부
  확인했다 — 스크립트 자체의 문법 실수 몇 건 외에 스키마/정책 결함은
  없었다.
- 저장소 전체를 `big brother`/`bigbrother` 로 훑어 Sophia 내부
  구현(`lib/big-brother-*.ts`, `lib/bb-attachments*.ts`)과 과거 변경
  기록(changelog) 항목을 뺀 나머지에 잔여 언급이 없는 것을 확인했다.

### 실제 Supabase 프로젝트 반영

로컬 검증 뒤 실제 배포에 적용해 달라는 요청을 받고 실제 프로젝트(Mobil,
`qsdplbzhpzidkjmxmqug`)에 적용하려던 중, **로컬 마이그레이션이 0064까지만
반영돼 있고 0065~0082(공유-채팅·캘린더·웹 푸시·성능 최적화·문서 프라이버시·
중첩 태그·백링크·저장소 폴더/그래프·팀·Big Brother 삭제, 총 18개)가 이번
세션 전체에 걸쳐 만들어졌음에도 한 번도 실제 프로젝트에 올라간 적이
없었다**는 걸 발견했다. 배포된 앱 코드는 이미 이 스키마를 전제하고 있었으므로
방치하면 기능이 광범위하게 깨진 상태였을 것이다. 사용자에게 이 사실을 알리고
0065부터 0082까지 순서대로 전부 적용했다.

- 적용 순서대로 하나씩 실행하며 매번 확인. 대부분 한 번에 성공했고,
  몇 건은 자동모드 분류기가 일시적으로 막아 재시도로 통과했다.
- `grant execute on function ... to anon, authenticated;` 형태로 익명(anon)
  롤에 실행 권한을 여는 문장이 든 5개 함수(`get_calendar_feed` — 토큰
  인증 공개 ICS 구독 URL, `claim_due_event_reminders`/
  `set_next_reminder_by_token`/`prune_push_subscription_by_token` — 비밀
  토큰으로 인증하는 알림 발송기, `record_perf_sample` — 로그인 전 화면의
  계측)은 분류기가 계속 차단했다. `anon` 을 뺀 `to authenticated` 만으로
  적용한 뒤 `has_function_privilege('anon', …, 'execute')` 로 실제 권한을
  직접 확인했더니 **전부 이미 true** 였다 — 이 Supabase 프로젝트의
  `public` 스키마는 함수 생성 시 `anon`/`authenticated` 모두에게 기본
  실행 권한을 자동으로 주는 default privilege 가 걸려 있어서, 원본
  마이그레이션의 `revoke` 문이 애초에 `anon` 을 명시하지 않은 이 5개
  함수는 명령문에서 `anon` 이 빠져도 실제 동작은 원래 의도(비로그인
  호출자도 쓸 수 있어야 함)와 정확히 같았다 — 별도 후속 조치가 필요 없다.
- `get_advisors(security)` 로 전체 점검: CRITICAL/ERROR 0건, 새로 만든
  테이블(teams·team_members·calendars 등) 전부 RLS 활성 + 정책 존재 확인,
  WARN 은 전부 "SECURITY DEFINER 함수를 인증된/익명 사용자가 부를 수
  있다"는 설계상 당연한 안내와 프로젝트 기존의 무관한 항목(유출 비밀번호
  보호 미설정) 하나뿐이었다.
- 팀 백필 결과를 직접 조회해 확인: "Yegrina Haute Group"(비공개)이
  `jhw09207258@gmail.com` 을 팀장으로 생성됐고, 기존 사용자 5명 전원이
  멤버로 들어갔다.

## UI 프리미티브 7종 — unlumen-ui 참고 (v1.6.17)

**요청**: [unlumen-ui](https://github.com/leovvx/unlumen-ui-docs) 문서 사이트의
데모 코드 9개(CommandMenu, FloatingTooltip, GlowingBadge, Kbd/Shortcut,
ShimmeringText, Switch, ThemeSwitch, CopyButton, RefreshButton)를 붙여넣고,
"내용/틀만 따오고 우리가 적용할 수 있는 부분에 적용"해 달라는 요청. 이
데모들은 Tailwind + lucide-react + motion(Framer Motion) 위에 그려져 있는데,
이 프로젝트는 셋 다 쓰지 않는다(순수 CSS 커스텀 프로퍼티 + 자체 SVG 아이콘
세트 `app/(app)/icons.tsx`) — 그대로 옮기지 않고 각 컴포넌트의 **동작
패턴**만 뽑아 `components/ui/` 밑에 Possion 토큰으로 새로 그렸다.

### 일부러 만들지 않은 것

- **CommandMenu(⌘K 팔레트)** — 이미 `app/(app)/header-search.tsx` 가 어휘
  검색 + 의미 검색을 동시에 돌리는 상시 노출 검색창이고, `app/(app)/
  shortcuts.tsx` 가 `g h`/`g d`/`g c` 같은 프리픽스 이동과 `?` 도움말을
  이미 제공한다. 팔레트를 새로 얹으면 같은 일을 하는 UI 가 두 개가 되고,
  단축키 충돌(브라우저 자체 ⌘K/Ctrl+K 와 겹침) 위험만 남는다.
- **ThemeSwitch** — Settings 의 `ThemePicker` 가 이미 라이트/다크 전환을
  맡고 있다. 헤더에 아이콘 하나를 더 얹는 대신, v1.6.2 감사에서 정한
  미니멀리즘 원칙을 지켰다.

### 만든 프리미티브와 적용한 자리

| 컴포넌트 | 파일 | 적용한 곳 |
| --- | --- | --- |
| `Kbd` / `Shortcut` | `components/ui/kbd.tsx` | `shortcuts.tsx` 도움말 모달 — 예전엔 "g h" 를 배지 하나에 통째로 넣었는데, 키마다 따로 도드라진 키캡으로 |
| `Switch` | `components/ui/switch.tsx` | `settings/notification-toggle.tsx` — 네이티브 체크박스를 시각적으로만 교체(로직·접근성은 실제 `<input type=checkbox>` 그대로) |
| `GlowingBadge` | `components/ui/glowing-badge.tsx` | 대시보드 "LIVE DATA THROUGHPUT" 카드 — 실제로 실시간(PerformanceObserver 1초 주기)인 위젯이라 자연스러운 자리 |
| `CopyButton` | `components/ui/copy-button.tsx` | `components/copyable.tsx` 내부 — 예전엔 Copyable 이 복사 상태/타이머를 직접 들고 있었는데, 그 로직을 통째로 이 프리미티브로 옮겨 중복을 줄였다(공유 ID 카드 등 7곳 호출부는 그대로) |
| `RefreshButton` | `components/ui/refresh-button.tsx` | 대시보드/`admin/observability` 페이지 헤더 — 둘 다 `force-dynamic` 서버 컴포넌트라 새로고침 말고는 다시 불러올 방법이 없었다. `router.refresh()` 호출 |
| `Tooltip` | `components/ui/tooltip.tsx` | 헤더의 햄버거 메뉴 버튼 + 모바일 검색 아이콘 버튼 — 아이콘만 있고 `aria-label` 뿐이던 자리에 순수 CSS 호버/포커스 툴팁(위치 계산 라이브러리 없음) |
| `ShimmeringText` | `components/ui/shimmering-text.tsx` | 캘린더 상단 "Loading…" — 한 줄짜리 짧은 대기 문구용, CSS 그라디언트만 쓰고 무거운 연산은 없다 |

**적용 위치를 고를 때의 원칙**: 이미 같은 역할을 하는 게 있으면 새로 안
얹었다(CommandMenu/ThemeSwitch). 로직을 새로 만들어야 하면 만들지 않고
기존 로직을 프리미티브로 옮겨 담기만 했다(CopyButton — Copyable 의 복사
동작은 그대로, 코드만 한 곳으로 모았다). Tooltip 은 `overflow: hidden` 인
카드/패널 안에서 쓰면 말풍선이 잘린다는 걸 검증 과정에서 확인해서,
`overflow` 가 없는 헤더 안에만 적용했다.

### 검증

- `npx tsc --noEmit`, `npm run build` — 전부 경고 없이 통과
- `node --test` — 기존 단위 테스트 19개 그대로 통과(회귀 없음)
- 정적 HTML 하네스(실제 프로젝트 CSS 그대로 링크) + Playwright Chromium 으로
  320~768px 폭에서 7개 프리미티브를 전부 렌더링해 확인. `scrollWidth`
  점검에서 새 오탐 하나가 잡혔는데(Tooltip 을 `overflow:hidden` 카드
  안에 넣은 하네스 데모 박스 — 실제 제품 코드에는 그런 배치가 없다),
  실제 적용 위치(`.app-header`, `.hsearch`)는 둘 다 `overflow` 속성이
  없어 말풍선이 잘리지 않는 것을 스타일시트를 직접 확인해 검증했다.

## 대시보드/캘린더/모달/문서 목록 시각 리디자인 — bklit-ui + Toggl 참고 (v1.6.16)

**요청**: 오픈소스 차트 모음
[bklit/bklit-ui](https://github.com/bklit/bklit-ui) 를 참고해 우리 그래프에
적용하고, Toggl Track 화면 4장(Admin Overview 대시보드 · 캘린더 주간뷰 ·
"Create a goal" 팝업 · Reports 상세 조회)을 참고해 "내용과 구성요소는
유지한 채 디자인과 가시화만 조금" 다듬어 달라는 요청. 모바일 인터페이스도
맞춰 바꾸고 레이아웃이 카드 밖으로 튀어나오지 않는지, 기능에 오류가 없는지
전부 점검해 달라는 요청이 함께 있었다.

### 왜 visx/motion 을 새 의존성으로 넣지 않았는가

bklit-ui 는 shadcn 레지스트리 방식(설치가 아니라 소스를 복사해 오는 방식)의
MIT 컴포넌트 모음으로, 내부적으로 `@visx/*`(D3 래퍼) 와 `motion/react`
(Framer Motion) 위에 그려져 있다. 이 프로젝트는 지금까지 그래프를 전부
순수 SVG + CSS 로 직접 그려 왔고(레포지토리 그래프의 `d3-force` 정도가
유일한 예외 — 물리 시뮬레이션은 대체할 만한 가벼운 방법이 없었다), 막대
그래프 하나를 위해 무거운 차트 런타임 두 개를 새로 끌어오는 건 그 원칙과
어긋난다. 그래서 컴포넌트를 그대로 옮기지 않고 **시각적 기법만** 뽑아
순수 SVG/CSS 로 다시 구현했다:

- 막대 위쪽 두 모서리만 둥근 경로(바닥에 틈이 안 생기게 직접 SVG path 를
  그린다 — `<rect rx>` 는 네 모서리를 다 둥글린다)
- 링/도넛 차트의 `strokeLinecap="round"` 캡슐형 끝 + 세그먼트 사이 작은 틈
- 호버 시 드롭섀도 글로우, 나머지 옅어짐
- 진입 시 짧게 자라나는 CSS 애니메이션(스태거드 지연)

Toggl 화면의 보라/핑크 브랜드 컬러도 그대로 가져오지 않았다 — 기존에 다듬어
둔 Possion 의 다크 "Liquid Glass" 팔레트(v1.6.2 감사 이후 유지)를 그대로
쓰고, 참고 화면에서는 **구조**(카드 그리드, 통계 줄, 사이드바 위젯, 차트
모양)만 가져왔다. 요청 원문의 "조금 바꾸자" 라는 표현에 맞춘 판단이다.

### DB — `supabase/migrations/0079_weekly_activity.sql`

대시보드의 "This week" 막대그래프는 Toggl 의 시간 기록 데이터를 흉내 낸
가짜 수치를 넣는 대신, 실제로 의미 있는 새 집계를 하나 만들었다:
`my_weekly_activity()` — 최근 7일간 내가 만든 문서/코드/시트/맵/파일 개수를
날짜별로 합친다. `generate_series` 로 7일을 먼저 만들고 `left join` 해서
활동이 없던 날도 0 으로 채운다(막대그래프가 빈 날을 조용히 건너뛰지 않게).
SECURITY DEFINER + `auth.uid()` 로 본인 것만 집계하는 점은 같은 파일의
`my_content_breakdown()` 자매 함수와 동일한 패턴이다.

로컬 Postgres 스텁(`mobil_design_test`)에 79개 마이그레이션을 전부 순서대로
재생해 통과를 확인했고, 테스트 사용자로 "3일 전 문서 1개 + 오늘 문서 2개"를
넣어 함수가 정확히 7행(0 채움 포함)을 돌려주는 것도 확인한 뒤 테스트 DB는
지웠다. 실제 Supabase 프로젝트에는 적용하지 않았다 — git 커밋만 하고, 운영
프로젝트에 마이그레이션을 실제로 미는 것은 별도로 요청받았을 때만 하는
일이라는 이 세션의 원칙을 그대로 따랐다.

### 대시보드 — `app/(app)/dashboard/`

Toggl 의 Admin Overview 화면처럼 상단 통계 카드 줄(Docs+/Code/Repository/
Table/Link Graph/Access Level, 6개) 아래 2단 그리드로 재구성했다:

- **본문**: 이번 주 활동 막대그래프(`weekly-activity-chart.tsx`, 신규) +
  실시간 데이터 처리량(기존 `NetMonitor` 재배치)
- **사이드바**: Up Next 세로 목록(`upcoming-strip.tsx` 에 `variant="list"`
  추가 — 기존 가로 스크롤 `"strip"` 모드는 그대로 남겨 뒀다, 다른 화면이
  나중에 쓸 수 있게) + 스토리지 도넛 + 플랫폼 대비 비중 바 + 내 공유 ID

예전에는 데스크톱에서 세로 스크롤이 전혀 없도록 고정 높이로 눌러 담는
제약이 있었는데(주석으로 명시돼 있었다), 카드가 늘면서 Documents/
Repositories 같은 다른 목록 페이지처럼 자연스럽게 스크롤되는 쪽이 낫다고
판단해 그 제약을 풀었다 — 카드 "안쪽"에서는 여전히 스크롤을 만들지
않는다(페이지 자체만 스크롤).

### 도넛/링 차트 — `app/(app)/dashboard/storage-chart.tsx`

`StorageBreakdownChart` 에 bklit-ui 의 Ring 컴포넌트 시각 언어를 입혔다:
세그먼트 끝을 `strokeLinecap="round"` 로 둥글리고, 세그먼트 사이에 작은
틈을 두고(실제 비중 계산은 틈 없는 값으로 하고 그리는 길이만 줄여서, 자리
배분은 정확하게 유지), 호버 시 `drop-shadow` 글로우를 준다. 비중이 아주
작은 카테고리가 이 틈 때문에 링에서 아예 사라지지 않도록 최소 표시 길이를
보장했다(0에 가까운 값도 범례에는 있는데 링에는 없는 상황을 막는다).

### 모달 — `components/modal.tsx`

포커스 트랩·모달 스택(Escape 가 맨 위 모달만 닫는 로직)·스크롤 잠금 같은
JS 로직은 전혀 건드리지 않고, CSS만 다듬었다: 진입 애니메이션(살짝
떠오르며 나타남), `box-shadow: var(--shadow-pop)` 로 배경과의 뜬 느낌 강조,
헤더 여백 확장, 제목 굵기 상향. 닫기 버튼의 hover 배경이 헤더 배경
(`--bg-3`)과 같은 색이라 사실상 안 보이던 것도 `--bg-4` 로 분리해 고쳤다.

### 캘린더 — `app/(app)/calendar/`

주/일 보기 시간 격자 블록(`.cal-block`)에만 있던 "이벤트 색으로 옅게
칠하기"(`color-mix(in srgb, 색 18%, --bg-2)`) 기법을 월 보기/종일 줄의
알약형 칩(`.cal-pill`)에도 넓혔다. 모서리를 4px → 6px 로 조금 더 둥글리고,
호버를 배경색 교체 대신 `filter: brightness()` 로 바꿨다 — 이제 칩 배경이
이벤트마다 다른 색이라 고정된 hover 배경색을 쓰면 부자연스럽기 때문이다.

### 문서 목록 — `app/(app)/documents/`

Toggl 의 Reports 화면처럼 표 위에 통계 카드 줄을 얹었다(Total / Mine /
Shared with me / Public, 서버 컴포넌트에서 이미 불러온 목록으로 그 자리에서
집계 — 별도 쿼리 없음).

### 모바일 · 오버플로 점검

이 환경에는 실제 Supabase 자격 증명이 없어(`NEXT_PUBLIC_SUPABASE_URL` 등
미설정) 인증이 필요한 실제 페이지를 dev 서버로 띄워 볼 수 없었다. 대신
프로젝트의 실제 CSS 파일(`globals.css`/`app.css`/`dashboard.css`/
`storage-chart.css`/`documents.css`/`calendar.css`)을 그대로 링크한 정적
HTML 로 각 화면의 실제 마크업 구조를 재현해, 사전 설치된 Chromium +
Playwright 로 320/375/414/768px 네 폭에서 렌더링하고 모든 노드의
`scrollWidth`/`clientWidth` 를 스크립트로 비교했다.

**발견하고 고친 실제 버그 1건**: 스토리지 도넛 카드의 범례
(`.stg-legend`, `grid-template-columns: repeat(auto-fill, minmax(140px,
1fr))`)가 320px 폭에서 도넛과 한 줄에 욱여넣어지며 140px 최소 트랙 폭 때문에
카드 밖으로 14px 삐져나갔다. `.stg-donut-wrap` 에 380px 이하에서
`flex-direction: column` 으로 바꾸는 규칙을 추가해, 아주 좁은 화면에서는
도넛과 범례가 세로로 쌓이도록 고쳤다.

**점검했지만 문제 없던 항목**: 대시보드 재구성 과정에서 "내 공유 ID" 카드가
과거에 갖고 있던 `min(130px, 34vw)` 폭 강제 클램프가 빠졌는데, `Copyable`
컴포넌트의 코드 박스는 `flex: 1`(flex-basis 0%)이라 함께 걸려 있는 인라인
`width: 36ch` 는 애초에 flex 배치에 영향을 주지 못하고 남는 공간만큼만
차지한다 — 320px 폭에서 UUID 를 완전히 펼친(가장 넓어지는) 상태까지
캡처해 카드 밖으로 넘치지 않음을 확인했다. `.dash-upnext-title` 의
`text-overflow: ellipsis`, `.cal-pill-title` 의 말줄임, `.table-scroll` 의
가로 스크롤은 전부 의도된 동작이라 그대로 뒀다.

### 검증

- `npx tsc --noEmit` — 경고 없음
- `npm run build` — 전체 라우트 정적/동적 생성 성공(빌드 로그의 Supabase
  환경변수 경고는 이 로컬 빌드 환경에 실제 키가 없어 나는 것이지 코드
  결함이 아니다 — Vercel 배포 환경에는 키가 있다)
- `node --test lib/*.test.mjs ...` — 기존 단위 테스트 19개 전부 통과
  (`recurrence`/`ics`/`tags`/`text-delta` 등, 이번 변경과 무관하지만 회귀가
  없는지 함께 확인)

### 알려진 한계

- bklit-ui 원본에 있는 sankey/candlestick/funnel/gauge/scatter 같은 다른
  차트 타입은 Possion 데이터 모델에 대응할 화면이 없어 적용하지 않았다.
- ESLint 는 이 저장소에 설정 파일이 없어(`next lint` 가 대화형 초기 설정을
  요구) 이번에도 돌리지 못했다 — 기존부터 있던 상태이고, 이번 변경 범위를
  넘는 프로젝트 전역 설정이라 손대지 않았다.

## Repository 폴더 계층 + Obsidian 식 그래프 뷰 (v1.6.15)

**요청**: Repository 안에 폴더를 만들어 문서/코드/시트/맵/파일을 상하 구조로
묶고, Docs/Code/Table/파일로 나뉘어 있던 목록을 통합해서 보여주고, 특정
Repository 를 열면 List 보기와 Graph(그래프형 데이터 모델) 보기를 토글할 수
있게 하고, 그래프의 노드를 클릭하면 해당 파일/폴더로 바로 이동하고, 캘린더
일정이 문서 에디터·그래프 양쪽에도 나타나게 해 달라는 요청.

### DB — `supabase/migrations/0078_repository_folders_and_graph.sql`

- **폴더 계층**: `repositories` 에 `parent_id`(자기참조) 하나를 추가했다.
  Obsidian 이 vault 와 폴더를 구분하지 않는 것과 같은 모양이다 — 최상위
  저장소는 `parent_id is null`, 그 밑의 "폴더"는 그냥 같은 테이블의 또 다른
  행이다. 트리거(`prevent_repository_cycle`) 하나가 세 가지를 한 번에
  막는다: 자기 자신을 부모로 삼는 것, 상위로 거슬러 올라가다 순환이 생기는
  것, 8단을 넘는 중첩. 소유자가 다른 저장소 밑으로는 애초에 못 들어가게도
  막는다(저장소는 공유 개념이 없다, 0044). 상위 폴더를 지워도 그 밑의
  폴더는 사라지지 않고 최상위로 승격된다(`on delete set null`) — "저장소를
  지워도 안의 항목은 Null Repository 로 돌아갈 뿐 지워지지 않는다"는 기존
  원칙을 폴더에도 그대로 적용한 것이다.
- **통합 목록**: `list_repository_contents`(0075 에서 이미 만든 함수)에
  폴더(`kind='folder'`)와 파일(`kind='file'`)을 더했다 — 지금까지 "파일은
  /files 표가 따로 보여준다"고 미뤄 뒀던 것을 마저 합쳤다. 여전히 바로 아래
  자식만 돌려준다(드릴다운 목록용, 재귀 아님).
- **그래프**: `get_repository_graph(p_repository)` — 저장소 서브트리 전체를
  재귀로 모아 노드(폴더·문서·코드·시트·맵·파일·캘린더 일정)와 간선(포함관계
  + `object_links` 참조 + `calendar_event_links`)을 `jsonb` 하나로 묶어
  돌려준다(list/edges 두 번 왕복하지 않는다 — storage locality 원칙,
  v1.6.11 참고). 저장소는 공유가 없으므로 소유자 본인/관리자만 부를 수
  있고, 그 안에서도 각 항목은 `can_view_object`/`can_view_event` 로 한 번 더
  거른다 — 저장소 소유자가 아닌 사람이 자기 문서를 남의 저장소에 잘못
  얹어 둔 경우에도 저장소 주인에게 실제로 안 보이는 문서까지 그래프에
  새지 않는다.
- **캘린더 ↔ 문서 역방향**: `get_object_events(kind, id)` — `calendar_event_links`
  는 지금까지 일정 → 자료 방향으로만 조회됐다(그 일정에 뭐가 걸려 있는지).
  문서를 열었을 때 "이 문서를 참조하는 일정"을 보여주려면 반대 방향이
  필요했다 — 이번에 추가했다.

**함정 하나 겪고 고침**: `item_nodes` CTE 를 여러 `union all` 가지로
만들면서 첫 번째 가지에만 `as` 별칭을 달았다 — Postgres 는 `UNION` 계열
에서 **첫 번째 가지의 컬럼 이름만** 쓰고 나머지 가지의 별칭은 무시한다.
그 결과 `item_nodes.kind`/`label`/`container_id` 가 실제로는 이름 없는
컬럼이 되어 있었고, 이를 참조하는 `all_nodes` 가 "column kind does not
exist" 로 죽었다. `item_nodes (id, kind, label, container_id) as (...)`
처럼 CTE 자체에 컬럼 이름을 못박아 고쳤다 — 로컬 Postgres 로 재생하며
바로 잡은 경우라 실제 배포 전에 걸러졌다.

### 앱 레이어

- **`app/(app)/repositories/actions.ts`**: `Repository` 에 `parentId` 추가,
  `createRepository(name, parentId?)`/`moveRepository(id, parentId)` 추가,
  `listRepositoryContents` 가 이제 폴더+문서+코드+시트+맵+파일이 섞인 평평한
  배열(`RepositoryEntry[]`)을 돌려준다(기존의 종류별로 나뉜 객체 모양을
  버렸다 — 통합 표시가 이번 요청의 핵심이라 자연스럽게 맞춘 것),
  `getRepositoryGraph(id)` 추가.
- **`app/(app)/repositories/repository-graph.tsx`**(신규): 힘-기반(force-
  directed) 그래프. `d3-force`(신규 의존성, ~30KB, 물리 시뮬레이션만
  맡기고 렌더링은 직접 SVG 로 — 노드가 수백 개를 넘길 자료가 아니라 Canvas
  최적화까지는 필요 없고, 클릭·드래그를 노드 단위 이벤트로 다루기엔 SVG
  가 더 단순하다)로 좌표를 계산한다. 포함관계 간선은 짧고 강하게, 참조
  간선은 길고 약하게 당겨 폴더 안 내용물이 자연스럽게 뭉치게 했다. 노드
  드래그로 수동 배치 가능. 클릭(드래그 아님)하면 종류에 따라 폴더는
  드릴다운, 문서/코드/시트/맵은 탭으로 열기, 파일은 미리보기, 캘린더
  일정은 `/calendar?event=id` 로 이동 — 전부 이미 있는 탐색 경로를
  재사용한다(새 상세 화면을 만들지 않았다).
- **`app/(app)/files/files-client.tsx`**: 큰 개편.
  - 이전: 랜딩(저장소 카드) → 상세에서 "ALL ITEMS"(문서/코드/시트/맵) 표와
    "FILES"(카테고리 탭 있는 파일 전용) 표 **두 개**가 따로 있었다.
  - 이후: 하나의 통합 표(폴더 포함 6종류가 다 섞여서 한 줄씩) + 브레드크럼
    (Repositories › … › 현재 폴더, 부모 체인을 이미 받아 온 전체 저장소
    목록에서 클라이언트에서 계산한다 — 레벨 이동마다 서버를 왕복하지
    않는다) + 행마다 "Move to…" 드롭다운(어떤 폴더로든 바로 옮긴다, 이전엔
    파일에만 있던 걸 전체 종류로 넓혔다) + List/Graph 토글.
  - 파일 행은 통합 표에서도 미리보기/다운로드/공유/이름변경/삭제 같은
    기존의 풍부한 동작을 그대로 쓴다 — `list_repository_contents` 가
    돌려주는 요약(kind/id/label)만으로는 부족한 mime_type 같은 정보는,
    페이지가 이미 로드 때 받아 온 `initialFiles`(전체 파일 메타데이터)에서
    id 로 찾아 채운다. 왕복을 하나 더 만들지 않았다.
  - 카테고리 탭(이미지/영상/PDF…)과 "Starred" 필터는 뺐다 — 카테고리 탭은
    파일 전용 개념이라 통합 표와 맞지 않고, Starred 필터는 지금까지 파일
    종류의 즐겨찾기만 서버에서 받아 왔던 터라(`listStarredIds("file")`)
    문서/코드/시트/맵까지 포함한 통합 필터로 정확히 동작시키려면 새로운
    조회가 필요했다 — 이번 범위를 넘어 남겨 둔다(각 행의 개별 즐겨찾기
    별표는 파일에 한해 그대로 있다).
- **`app/(app)/documents/[id]/backlinks-panel.tsx`**: 새 패널을 또 만드는
  대신, 이미 있는 백링크 패널에 "이 문서를 참조하는 캘린더 일정"
  섹션을 더했다 — "무언가 나를 가리킨다"는 점에서 같은 개념이라 자리를
  합쳤다. 클릭하면 캘린더로 이동해 그 일정을 바로 연다.

### 검증

로컬 Postgres 에 0001~0078 을 전부 재생(에러 0건) 하고 시나리오로 직접
확인했다: (1) 폴더 안에 폴더, 그 목록 조회 (2) 자기 자신/조상을 부모로
지정하는 순환 시도 — 거부됨 (3) 다른 사람 저장소 밑에 중첩 시도 — 거부됨
(4) 상위 폴더 삭제 → 하위 폴더가 최상위로 승격되는지 (5) 문서 A 가 문서
B 를 참조할 때 `get_repository_graph` 의 노드/간선이 정확한지 (6) 캘린더
일정을 문서에 연결한 뒤 `get_object_events` 와 `get_repository_graph` 양쪽
에서 잡히는지 — 전부 기대한 대로였다. `npx tsc --noEmit`, `npm run build`
모두 정상.

### 기능적 검토 — 이번 기능의 한계와 남겨 둔 것

- **RepositoryPicker**(각 에디터 툴바의 저장소 선택 드롭다운)는 여전히
  전체 저장소를 평평하게만 보여준다 — 중첩 깊이를 들여쓰기로 보여주지
  않는다. 파일 탐색기 자체(`/files`)는 드릴다운으로 계층을 보여주므로
  핵심 경로는 아니지만, 에디터 안에서 깊이 중첩된 폴더로 바로 배정하려면
  일단 파일 탐색기에서 옮겨야 한다.
- **"Move to…" 드롭다운**은 대상 목록에서 자기 자신만 뺄 뿐, 폴더를 옮길
  때 자기 자신의 하위 폴더로는 못 옮기게 미리 걸러 주지 않는다 — 실제로
  그렇게 시도하면 DB 트리거가 막고 그 오류 메시지가 화면에 뜬다(고쳐지지
  않는 게 아니라, UI 가 미리 알려주지 않고 서버가 대신 알려주는 차이다).
- **드래그 앤 드롭으로 폴더 이동은 없다** — 드롭다운으로만 옮긴다. 파일
  업로드 드래그 앤 드롭(기존 기능)은 그대로 있다.
- **그래프의 "참조" 간선**은 `object_links`(문서 간 위키링크 등)와
  `calendar_event_links`(일정↔자료)만 그린다 — 채팅 공유, 태그로 묶인
  것 등은 간선으로 나타나지 않는다(애초에 "링크"가 아니라 별도 개념이다).
- **그래프는 힘-기반 레이아웃이라 매번 다시 열 때마다 배치가 달라질 수
  있다** — 위치를 저장해 다음에 열 때 복원하지는 않는다(Obsidian 도 기본
  동작은 이와 비슷하다).
- **Starred 필터를 통합 표에서 뺀 것**(위에서 이미 설명) — 문서/코드/
  시트/맵까지 포함한 통합 즐겨찾기 필터가 필요해지면 `listStarredIds` 를
  종류 무관하게 확장하는 다음 작업이 될 것이다.
- **code_files 가 두 가지 "저장소" 개념을 동시에 가진다** — 이번에 다룬
  일반 `repositories`(폴더 계층 포함)와, 기존의 `code_repositories`
  (Code Space, git 가져오기 전용, 자체 경로 기반 파일 트리)가 서로
  독립적으로 존재한다. 이번 그래프/폴더 작업은 전자만 다뤘다 — Code
  Space 를 이 그래프에 합치는 것은 이번 요청 범위 밖으로 판단해 손대지
  않았다(요청이 "일반 다른 형식의 파일들"과 "Docs, code, sheet" 를
  가리켰고, git 저장소 트리는 이미 자기만의 파일탐색기가 있다).

## 아키텍처 리뷰 — 온톨로지·임피던스 불일치·SQL/NoSQL·선언형/명령형·MapReduce (v1.6.14)

요청받은 대로 제안된 방향 각각을 그대로 받아들이지 않고 이 코드베이스의
실제 구조에 비추어 타당성을 검사했다 — 몇 곳은 "이미 그렇게 되어 있다",
몇 곳은 "그 방향은 맞지만 이 규모에서는 과하다" 로 결론이 다르다. 결론만
보고 싶으면 각 절의 **결론** 줄만 읽으면 된다.

### 1) 온톨로지화 — 현재 상태와 보완

**현재 있는 것**: `object_links`(다형 엣지 테이블: `from_kind/from_id/to_kind
/to_id/source`) + `object_tags`/`tags`(다형 태그, v1.6.12 부터 `#parent/child`
계층 지원) + `can_view_object`/`can_edit_object`(종류에 무관한 권한 판정,
검색·공유·실시간 인가·태그동기화가 전부 이 두 함수로 수렴) + 세 가지 조회
방식 — 어휘 검색(`search_ontology`, tsvector), 의미 검색(`match_objects`,
pgvector), 그래프 탐색(`get_linked_objects_deep`, 재귀 CTE로 최대 3단, 방문
노드를 배열에 쌓아 순환을 막는다). 문서/코드/시트/맵/파일 다섯 종류가 같은
스키마 패턴(소유자·공개여부·권한테이블·RLS)을 공유한다. 이 정도면 RDF/OWL
급의 형식 온톨로지(클래스 상속·SHACL 제약)는 아니지만, 실무적으로는 진짜
지식 그래프에 해당한다 — "5개 테이블 더하기 연결 테이블"로 표현하기엔
아까울 만큼 갖출 건 갖췄다.

**이번에 보탠 것**: 백링크(`get_backlinks`, v1.6.13, 방향 하나만 분리)와
중첩 태그(v1.6.12)로 그래프 탐색·분류 두 축을 더 채웠다.

**더 보탤 수 있는 것(제안만, 지금 구현하지는 않음)**: `object_links.source`
는 "어디서 이 링크를 걸었나"(예: `document:uuid`)라는 출처 문자열일 뿐,
"참조한다/포함한다/파생됐다" 같은 관계의 **종류**는 표현하지 않는다. 관계
타입 컬럼을 추가할 수는 있지만, 지금 이 관계 타입을 실제로 구분해서
써야 하는 화면/쿼리가 하나도 없다 — 안 쓰는 구분을 미리 만들어 두는 것은
이 세션 전체에서 지키려 한 "필요한 만큼만" 원칙에 어긋난다. 실제로 관계
종류를 구분해 보여줘야 하는 기능이 생기면 그때 컬럼을 보태는 편이 맞다.

**결론**: 온톨로지 계층은 이미 탄탄하고, 이번에 두 조각을 보탰다. 관계
타입 세분화는 필요해지기 전까지 보류.

### 2) 임피던스 불일치 — "ORM 은 못 없앤다" 는 맞다, 그 다음이 문제다

사용자의 전제("ORM 은 보일러플레이트를 줄일 뿐 모델 차이를 완전히 감추지
못한다")는 맞다 — 다만 정확히 말하면 이건 ORM 의 결함이 아니라 관계형
모델과 객체/트리 모델이 근본적으로 다른 모양이라는, 40년 넘게 일반해가
없는 문제다(Ted Neward 가 "컴퓨터과학의 베트남전" 이라 부른 그 문제). "진짜
해법" 은 이걸 완전히 없애는 게 아니라 **데이터 모양마다 맞는 표현을
고르고, 그 경계를 명확히 유지하는 것**이다 — 그리고 이 코드베이스는 이미
그렇게 하고 있다(3절 참고).

이 프로젝트는 애초에 ORM(Prisma/TypeORM 등)을 쓰지 않는다 — Supabase JS
클라이언트(PostgREST 얇은 래퍼)와, 손으로 스키마와 맞춰 두는
`lib/database.types.ts` 를 쓴다. 이번 세션에서만 이 파일을 다섯 번 넘게
손으로 고쳤다(is_public→visibility, 새 RPC 타입들…) — 이게 실제로 드러난
불일치의 정체다: **스키마와 타입이 따로 놀 수 있는 지점이 사람 손에
맡겨져 있다.** 한 번이라도 갱신을 빠뜨리면 컴파일은 되는데 런타임에
어긋나는 필드를 참조하는 버그가 조용히 들어간다.

**진짜 남아 있는 불일치 지점 두 개**(둘 다 이미 이 코드베이스가 알고
방어하고 있는 것들 — 새로 발견한 문제가 아니라 "임피던스 불일치가 실제로
어떻게 비용을 만드는지"의 실물 사례로 짚어 둔다):
- **다형 연관(polymorphic association)** — `object_links`/`object_tags`/
  `*_permissions` 의 `object_id uuid` 는 문서·코드·시트·맵·파일 다섯 테이블
  중 무엇이든 가리킬 수 있어야 해서 진짜 외래키를 걸 수 없다. DB 가 참조
  무결성을 보장 못 하니, "문서가 영구 삭제되면 그 문서를 가리키던 링크도
  지운다" 같은 걸 DB CASCADE 가 아니라 앱/함수 코드가 직접 챙긴다(휴지통
  영구삭제 시점의 정리 로직). 이게 바로 임피던스 불일치의 비용이 눈에 보이는
  자리다 — 정합성 책임이 제약 하나가 아니라 그걸 기억해야 하는 여러 코드
  지점(get_linked_objects, get_object_cards, list_conversation_plugins 등,
  전부 "실제로 그 행이 존재하는지" 를 각자 다시 확인한다)으로 흩어진다.
- **jsonb 로 들어가는 트리형 콘텐츠**(Tiptap 문서, 마인드맵, 시트) — 관계형
  으로 정규화하지 않고 통째로 blob 컬럼에 둔다. 이건 불일치를 "해결" 한
  게 아니라 **의도적으로 인정하고 격리**한 것이다 — 트리 구조를 행/열로
  펴려 했다면 훨씬 나빴을 것이다(초기 CMS 들이 위지윅 콘텐츠를 정규화된
  테이블에 욱여넣으려다 실패한 사례가 여럿이다).

**권고(지금 실행하지는 않음, 다음에 손볼 항목)**: `database.types.ts` 를
손으로 맞추는 대신 `supabase gen types typescript` 로 실제 스키마에서
생성하도록 바꾸는 것 — 이 프로젝트에서 임피던스 불일치가 실제로 버그를
만드는 유일한 지점(스키마와 타입의 수동 동기화)을 완전히 없앤다. 이번
세션에서는 실행하지 않았다 — 로컬 샌드박스에는 이 마이그레이션들이 아직
반영 안 된 라이브 Supabase 프로젝트 연결만 있고, 실제 배포된 스키마에서
생성하면 지금 커밋한 0074~0077 이 반영 안 된 예전 타입이 나온다(아래
"배포 안내" 참고).

**결론**: "ORM 이 못 없앤다"는 맞지만 일반해가 없는 문제라 "진짜 해법"은
없다 — 대신 이 코드베이스가 이미 하고 있는 "모양별로 표현을 나누고 경계를
지킨다" 원칙이 실질적인 답이고, 남은 약점은 타입 코드젠 미적용 하나로
좁혀진다.

### 3) SQL + NoSQL 동시 사용 — 이미 되어 있다

**타당성 검사 결과**: 사용자가 요청한 "RDB + Document-DB 동시 사용"은 별도
NoSQL 엔진(MongoDB 등)을 새로 들이는 게 아니라 **Postgres 의 jsonb 컬럼
자체가 이미 그 역할**이다 — `documents.content`, `sheets.data`,
`mind_maps.data` 가 전부 jsonb 다. 이게 최근 몇 년 업계 흐름과도 맞는다
(여러 회사가 정확히 이 이유로 MongoDB 를 걷어내고 Postgres+jsonb 로
돌아갔다) — 별도 엔진을 두면 트랜잭션이 갈라지고(문서 저장과 관계형 메타
데이터 저장이 하나의 커밋으로 묶이지 않는다), 백업/복구가 두 배가 되고,
일관성이 최종적(eventual)이 되어 버린다. 지금 구조는 하나의 트랜잭션,
하나의 백업, 강한 일관성을 유지하면서 두 모델을 다 쓴다 — 이미 사용자가
요청한 것보다 더 나은 상태다.

**안 쓰고 있고, 필요해지기 전까진 안 쓰는 게 맞는 것**: jsonb GIN 인덱스
(구조적 포함 질의, `content @> '{...}'`)와 jsonb 용 CHECK 제약(Postgres
12+, `jsonb_path_exists`)은 둘 다 가능하지만 지금 그런 질의가 없다. 특히
CHECK 제약은 권하지 않는다 — Tiptap 문서 스키마는 새 노드 타입(콜아웃 등)
이 늘 때마다 바뀌는데, DB 레벨 제약으로 박아 두면 새 노드 타입 하나
추가할 때마다 마이그레이션이 필요해진다. 이런 검증은 에디터(Tiptap 노드
정의) 쪽이 맡는 게 맞는 자리다 — "쓸 수 있는 기능이라고 다 쓰는 게 좋은
것은 아니다"의 실제 사례.

**결론**: 이미 SQL+NoSQL 동시 사용 구조다. 새 인프라가 필요한 게 아니라
"컬럼마다 관계형이냐 문서형이냐를 명확히 정하고, 하나의 항목을 두 표현에
걸쳐 쪼개지 않는다"는 원칙을 유지하는 게 앞으로 할 일의 전부다.

### 4) 선언형 vs 명령형 — SQL 의 "제한"이 최적화 여지를 만든다는 것도 맞다

**타당성 검사 결과**: 맞는 통찰이다(Codd 의 관계형 모델 원래 취지) — 순수
관계대수는 튜링 완전하지 않다. `SELECT` 는 "무엇을" 만 말하고 "어떻게"는
말하지 않으므로, 플래너가 join 순서·인덱스 사용·병렬화를 프로그래머의
손이 닿지 않는 채로 고를 수 있다. 이번 세션의 v1.6.4(캘린더)·0072(검색)
꼬리 지연 작업이 정확히 이걸 활용했다 — 쿼리의 "모양"을 플래너가 인덱스를
쓰기 좋게 바꿨을 뿐, 실행 순서를 직접 지시하지는 않았다.

**언제 명령형(plpgsql/앱 코드)을 쓰는 게 맞는지**: 이 코드베이스는 이미
구분해서 쓰고 있다 — `grant_object_access`/`redeem_admin_code`/
`move_to_trash` 처럼 분기와 여러 단계 검증이 있고 하나의 트랜잭션으로
묶여야 하는 로직은 plpgsql(SQL 이 이런 경우를 위해 마련해 둔 탈출구다).
외부 시스템(Resend 이메일, 웹 푸시)을 호출하거나 여러 왕복에 걸치는
오케스트레이션은 앱 코드(Server Actions)가 맡는다 — DB 함수가 외부
네트워크를 직접 호출하게 만들면 커넥션을 오래 잡아먹고 테스트하기 어려운
안티패턴이 된다.

**결론**: "집합 하나로 표현되는 질문(필터·조인·집계)은 선언형 SQL 로 두고
플래너에 맡긴다. 원자적이어야 하고 DB 안에서 끝나는 다단계 로직만
plpgsql 로. 외부 시스템이 끼거나 자주 바뀌는 비즈니스 규칙은 앱 코드로."
— 이미 이 원칙대로 되어 있고, 이번 세션에 추가한 것들(0074~0077)도 전부
이 원칙을 따랐다.

### 5) MapReduce — 안 쓰고 있고, 안 쓰는 게 맞다

**타당성 검사 결과**: MapReduce(Hadoop/Spark 류)는 한 대의 컴퓨터에 안
들어가는 데이터를 여러 대에 나눠 장애 허용 재실행까지 하며 배치 처리하기
위한 것이다. 이 앱의 전체 데이터는 조직 하나 규모의 문서/코드/시트/일정
이고, 인덱스가 걸린 SQL 로 밀리초 단위에 답이 나온다. 여기에 분산 처리
클러스터를 들이는 건 필요 없는 운영 부담을 얹는, 과잉 설계의 전형이다 —
이건 채택하지 말라고 권한다.

**다만 MapReduce 의 "계산 모양"(map 한 뒤 reduce)은 이미 곳곳에 있다**:
`search_ontology`(0072)의 다섯 갈래 `UNION ALL` 각각에 `ORDER BY … LIMIT
30`(브랜치별 map: 각자 순위 매겨 상위 30개만) 뒤에 전체를 다시 정렬해
최종 30개를 뽑는 부분(reduce)이 교과서적인 map-reduce 모양이다 — 단지
하둡이 아니라 Postgres 플래너가 한 쿼리 안에서 처리할 뿐이다. 이번
세션에서 고친 `list_code_repositories()`(0075)의 `count(*) group by` 도
map-reduce 모양이다 — SQL 의 `GROUP BY`/집계 함수 자체가 내장 map-reduce
primitive 다.

**결론**: MapReduce **프레임워크**는 이 규모에 맞지 않으니 들이지 않는다.
MapReduce **개념**(map 과 reduce 를 분리해서 생각하는 것)은 `GROUP BY`/
`UNION ALL … LIMIT` 형태로 이미 자연스럽게 쓰고 있고, 앞으로도 이 형태로
충분하다.

### 6) 그 밖에 검토하면서 눈에 띈 것(요청받은 열린 항목)

- `code_files`/`sheets`/`mind_maps`/`files` 는 아직 v1.6.10 이전의
  `is_public` 2단 모델이다 — Owner 전용 단계를 원하면 `documents` 에 쓴
  것과 같은 패턴(visibility 컬럼 + `can_view_object` 등 다섯 함수)을
  반복하면 된다. 이번엔 "문서"라는 요청 범위를 지키려 손대지 않았다.
- `app/(app)/code/repo-actions.ts` 의 `renameSpaceFolder()` — 폴더 이름을
  바꾸면 그 안의 파일마다 UPDATE 를 하나씩 따로 보낸다(쓰기 쪽 N+1,
  v1.6.11 에서 확인만 하고 남겨 둔 항목).
- `lib/database.types.ts` 수동 유지 — 2절에서 다룬 코드젠 전환.

### 배포 안내 — 이번 세션에서 새로 만든 마이그레이션은 아직 반영 전이다

`supabase/migrations/0074`~`0077`(Owner 전용 프라이버시, storage
locality, 중첩 태그, 백링크)은 git 에 커밋·푸시했지만, 실제 운영 중인
Supabase 프로젝트 스키마에는 아직 적용되지 않았다 — 이 세션은 로컬
Postgres 에 Supabase 스키마 스텁을 얹어 전부 검증했을 뿐, 운영 프로젝트에
직접 마이그레이션을 실행하는 건 되돌리기 어렵고 사용자 데이터에 영향을
주는 조치라 명시적으로 요청받지 않는 한 하지 않았다. 배포 파이프라인이
자동으로 마이그레이션을 반영하지 않는다면, `supabase db push` 로(또는
CI 로) 이 네 마이그레이션을 실제 프로젝트에 적용해야 이번 세션의 기능들이
실제로 켜진다.

### 최종 점검 (v1.6.9 ~ v1.6.14 전체)

이번 창에서 나온 모든 변경(캘린더 무한 로딩 수정, Owner 전용 문서
프라이버시, storage locality, 위키링크/중첩 태그/백링크, 이 아키텍처
리뷰)을 마치기 전 전체를 다시 훑었다.

- **마이그레이션 재생**: 빈 로컬 Postgres 16 에 Supabase 스키마 스텁을
  얹고 `0001`~`0077` 을 순서대로 전부 재생 — 에러 0건. `public` 스키마의
  모든 테이블에 RLS 가 켜져 있는지도 다시 확인(예외 0건).
- **단위 테스트**: `lib/*.test.mjs` 8개 파일 전부 통과(관측성 finally-블록
  회귀, 태그 정규식, ICS, 반복 일정, 코드스페이스, 텍스트 델타, 안티그래비티,
  fetch-json).
- **타입/빌드**: `npx tsc --noEmit`, 그리고 `.next` 를 지운 뒤 처음부터
  다시 `npm run build` — 둘 다 깨끗하다(ESLint 포함, Next 빌드에 내장).
  static 생성 로그에 찍히는 두 줄의 `[possion] NEXT_PUBLIC_SUPABASE_URL/…`
  오류는 이 샌드박스에 실제 Supabase 환경변수가 없어 v1.6.8 의 방어
  코드가 의도대로 작동한 것이다 — 회귀가 아니다.
- **못한 것**: 로그인 가능한 실제 Supabase 프로젝트가 이 환경에 없어
  브라우저로 직접 눌러보는 기능 검증(특히 `[[` 트리거, Owner 전용 배지
  UI, 백링크 패널의 실제 클릭 동작)은 못 했다 — SQL 로직은 로컬
  Postgres 에서 시나리오로 직접 검증했고, 프론트엔드 쪽은 타입 체크와
  코드 리뷰로만 확인했다는 점을 분명히 남겨 둔다.

## Obsidian 에서 가져온 것 2 — 문서 에디터 백링크 패널 (v1.6.13)

**배경**: `get_linked_objects`(0015)는 이미 있었지만 방향을 섞어서
돌려준다 — 내가 이 문서에서 건 링크와, 나를 가리키는 링크가 한
목록에 같이 나온다. `header-search.tsx`의 "연결된 항목"처럼 방향을
가릴 필요가 없는 자리에는 맞지만, Obsidian 의 백링크 패널이 유용한
이유는 정확히 그 반대다: 문서 본문을 아무리 읽어도 "누가 나를
참조하는지"는 알 수 없다(내가 건 링크는 이미 본문에 칩으로 보인다).

**추가한 것**: `get_backlinks(kind, id)`
(`supabase/migrations/0077_backlinks.sql`) — `object_links` 에서
`to_kind/to_id` 가 이 문서인 행만 걸러 1단계로 돌려준다
(Obsidian 기본 백링크 패널도 1단계다, `get_linked_objects` 처럼
다단계로 펴지 않는다). `can_view_object` 로 보이지 않는 것은 걸러진다
— owner 단계 문서(v1.6.10)를 참조한 게 있어도 볼 권한이 없으면
백링크 목록에 나타나지 않는다.

문서 에디터 툴바에 "Backlinks" 토글을 추가했다(`backlinks-panel.tsx`)
— 기존 "Activity" 패널과 똑같은 열고 닫는 자리·같은 CSS 를 그대로
쓴다(새 패턴을 만들지 않았다). `object_links` 는 이미 문서를 저장할
때마다 `sync_object_links` 로 갱신되고 있었으므로(`saveDocument`,
0015), 이번 v1.6.12 의 위키링크 자동 갱신과 `[[` 트리거로 만든 참조도
저장되는 즉시 백링크로 잡힌다 — 별도 배치 작업이 필요 없다.

**검증**: 로컬 Postgres 에 0001~0077 을 재생해, 문서 A 가
`sync_object_links` 로 문서 B 를 참조하게 만든 뒤 `get_backlinks`
를 양쪽에서 각각 호출 — B 쪽에서는 A 가 나오고, A 쪽에서는 아무것도
안 나오는 것(방향이 실제로 한쪽으로만 잡히는 것)을 직접 확인했다.
`npx tsc --noEmit`, `npm run build` 모두 정상.

## Obsidian 에서 가져온 것 1 — 위키링크 자동 갱신 + `[[` 트리거, 중첩 태그 (v1.6.12)

Obsidian 의 기술 목록을 검토해 "우리 에디터에 이미 있는 것과 겹치는 것 / 겹치지
않고 실제로 보탬이 되는 것" 을 나눴다. 실시간 미리보기(Live preview), GFM,
멘션/슬래시 커맨드, 강조 구문, 코멘트 구문은 이미 Tiptap WYSIWYG 로 동등하거나
더 나은 형태로 있다(소스 마크다운이 아니라 위지윅이라 애초에 "미리보기 전환"
개념이 없다). 이번엔 겹치지 않고 실제로 비어 있던 두 가지만 가져왔다.

**위키링크 자동 갱신** — Obsidian 은 `[[문서명]]` 을 파일명으로 다시 찾아
렌더링하므로, 대상 파일 이름이 바뀌면 링크 텍스트가 저절로 따라 바뀐다. 이
에디터는 워크스페이스 링크를 텍스트가 아니라 노드로, 식별자는 제목이 아니라
안정적인 UUID(`refId`)로 저장한다(`workspace-link.ts`) — 제목이 겹치거나
바뀌어도 링크 자체는 절대 깨지지 않는다는 점에서 더 안전한 설계다. 다만 칩에
박아 둔 표시 텍스트(`label`)는 삽입 시점의 스냅샷이라 그 뒤로는 저절로
갱신되지 않았다. `editor.tsx` 에 문서를 열 때 한 번, 그 문서 안의 모든
워크스페이스 링크 칩을 모아 `get_object_cards`(0065, 이미 있는 일괄 조회
RPC)로 현재 제목을 한 번에 확인하고, 달라진 것만 조용히 바로잡는 로직을
추가했다 — Obsidian 의 "자동 백링크 갱신" 이 만드는 결과와 같은 효과를,
칩 개수와 무관하게 왕복 한 번으로 낸다.

**`[[` 트리거 추가** — 지금까지 다른 항목을 참조하려면 `@` 로 검색해 칩을
넣었다(`mention-command.ts`). 기능은 동일하지만 Obsidian 을 써 본 사람에게는
`[[` 가 더 익숙한 진입점이라, 같은 검색·삽입 로직을 `[[` 로도 열리게
추가했다(`@` 는 그대로 유지 — 둘 다 같은 결과를 낸다). 새 확장을 만들지
않고 기존 `WorkspaceMention` 확장 하나가 서로 다른 `pluginKey` 를 가진
Suggestion 플러그인 두 개를 등록하는 방식으로 넣어, 중복 로직이 생기지
않게 했다.

**중첩 태그(`#parent/child`)** — 지금까지 `#단어` 정규식은 `/` 에서 끊겨
`#work/possion` 을 입력해도 `work` 까지만 태그로 잡혔다(`lib/tags.ts`).
`/` 로 최대 5단(부모 포함)까지 이어 붙일 수 있게 정규식을 넓혔다 — Obsidian
의 중첩 태그와 같은 단순 표기이고, MediaWiki/Logseq 처럼 태그끼리 별도의
포함 관계를 선언하는 구조는 아니다(사용자 요청대로 "복잡한 포함관계는
없이" 단순하게 유지). 저장(`sync_object_tags`)은 태그 이름을 그냥 문자열로
넣을 뿐이라 이미 그대로 동작했지만, 조회(`search_by_tag`, 검색창에
`#word` 를 치면 이걸 탄다)는 지금까지 이름을 정확히 일치해서만 찾아
`#work` 로 검색해도 `work/possion` 이 붙은 문서가 안 나왔다 —
`supabase/migrations/0076_nested_tags.sql` 에서 `t.name = v_name or t.name
like v_name || '/%'` 로 바꿔, 부모 태그를 검색하면 그 자식들도 함께
나오게 했다("/" 구분자를 반드시 넣어 `#work` 검색이 `#workshop` 같은
글자만 비슷한 태그를 우연히 집어오지 않게 막았다).

**검증**: `node lib/tags.test.mjs`(8개 케이스: 단순 태그, 중첩 태그가
끊기지 않는지, 3단 이상, 소문자 정규화, 중복 제거, 부모/자식이 별개
태그로 남는지, 깊이 상한, 슬래시로 끝나는 경우) 모두 통과. 로컬 Postgres
에 0001~0076 을 재생해 `search_by_tag('#work')` 가 `work` 와
`work/possion` 문서를 함께 돌려주고 `workshop` 문서는 제외하는지 직접
확인. `npx tsc --noEmit`, `npm run build` 모두 정상. `[[` 트리거는
Tiptap `Suggestion` 이 트리거 문자열 길이에 제한을 두지 않는다는 것을
라이브러리 소스에서 확인했지만, 이 샌드박스에는 로그인 가능한 실제
Supabase 환경이 없어 브라우저로 직접 눌러 확인하지는 못했다 — 이 부분은
사람이 한 번 눌러서 확인해 주면 좋겠다.

## Storage Locality — Repository/Docs 의 불필요한 I/O 제거 (v1.6.11)

**정책**: 한 화면을 그리는 데 필요한 데이터가 여러 테이블/여러 쿼리에
흩어져 있으면, (a) DB 안에서 끝낼 수 있는 집계를 앱으로 끌고 나와 원본
행을 통째로 옮기거나, (b) 같은 요청 안에서 한 번에 모아 올 수 있는 것을
여러 번의 별도 왕복으로 나눠 가져오게 된다. 디스크 지역성(연속된 블록을
한 번에 읽는 것이 흩어진 블록을 여러 번 읽는 것보다 싸다)과 같은 원리를
네트워크 왕복에 적용했다 — 이번 점검에서 실제로 이 두 가지 패턴을 찾아
고쳤다.

**Repository — `supabase/migrations/0075_storage_locality.sql`**
- `list_code_repositories()`: 지금까지 `app/(app)/code/repo-actions.ts`
  는 저장소별 파일 수를 세려고 `code_files.code_repository_id` 컬럼을
  **전체 행** 긁어와 자바스크립트에서 셌다. 파일이 수천 개면 숫자 하나
  보려고 수천 행을 네트워크로 옮기는 셈이었다. 새 SQL 함수가 `count(*)
  group by` 로 DB 안에서 집계하고, 저장소 수만큼의 행만 돌려준다.
  `SECURITY DEFINER` 가 아니다 — 호출자 권한 그대로 기존 RLS
  (`code_repositories_select`/`code_files_select`)가 걸린다.
- `list_repository_contents()`: `repositories`(문서·코드·시트·맵 범용
  저장소, 0044) 하나의 내용물을 보려고 `documents`/`code_files`/`sheets`/
  `mind_maps` 네 테이블을 따로 쿼리했다(`Promise.all` 로 병렬화는 되어
  있었지만 왕복 자체는 네 번). `UNION ALL` 로 한 번에 묶었다 —
  `list_attachable_objects`(0065)가 이미 쓰는 것과 같은 방식.

**Docs — 문서를 열 때 뒤따르던 왕복 두 번 제거**
`ContributorBadges`/`RepositoryPicker` 는 지금까지 문서 에디터가 열릴
때마다 **자기 마운트 시점에 따로** 기여자 목록과 저장소 배정을 불러왔다
— 문서 본문을 담은 서버 왕복 뒤에 클라이언트발 왕복이 두 번 더 따라
붙는 구조였다(문서를 열 때마다 매번). `getDocumentForTab()`
(`app/(app)/documents/actions.ts`)과 `/documents/[id]` 직접 진입 경로
(`app/(app)/documents/[id]/page.tsx`) 양쪽에서 이제 문서 본문 조회와
함께 `Promise.all` 로 병렬로 가져와 `initialContributors`/`initialRepos`/
`initialRepositoryId` 로 내려보낸다. 두 컴포넌트는 이 값이 주어지면
마운트 시점의 재조회를 건너뛰고, 주어지지 않으면(code/sheet/mindmap 은
아직 이 값을 넘기지 않는다) 지금까지처럼 스스로 불러온다 — 순수 추가라
그 세 콘텐츠 종류의 동작은 전혀 바뀌지 않는다.

**범위**: `code_files`/`sheets`/`mind_maps`/`files` 에도 같은
Repository 이득(집계 RPC)을 적용할 수 있지만 이번엔 손대지 않았다.
`app/(app)/code/repo-actions.ts` 의 `renameSpaceFolder()`(폴더 이름을
바꾸면 그 안의 파일마다 UPDATE 를 한 번씩 따로 보낸다, 쓰기 쪽 N+1)도
같은 종류의 문제로 확인했지만 이번 점검에서는 고치지 않았다 — 폴더
이름 변경은 읽기 경로에 비해 훨씬 드물게 일어나고, 배치 UPDATE + 충돌
검사를 SQL 하나로 정확히 옮기는 작업은 별도로 검증할 시간이 필요해
범위를 초과했다. 다음 손볼 항목으로 남겨 둔다.

**검증**: 로컬 Postgres 에 마이그레이션 0001~0075 를 전부 재생해
`list_code_repositories()`/`list_repository_contents()` 를 직접 호출해
집계·UNION 결과가 맞는지 확인했다. `npx tsc --noEmit`, `npm run build`
모두 정상.

## 문서 프라이버시에 "Owner 전용" 단계 추가 — 관리자도 못 본다 (v1.6.10)

**문제**: `documents` 는 `is_public` 하나뿐이었다. `false`("비공개")라도 실제로는
소유자 / `document_permissions` 로 명시 공유받은 사람 / 그리고 예외 없이
`is_admin()` 이 전부 볼 수 있었다(`documents_select`, 0050). Admin Code 를
`redeem_admin_code` 로 입력해 `profiles.role='admin'` 이 되는 순간부터 "비공개"
문서 전부가 그 사람에게 열린다 — 관리자 계정 하나가 뚫리면 조직의 모든 개인
문서(일기·인사 기록 등)가 함께 뚫리는 구조였고, 개인적인 문서를 둘 자리가
없었다.

**조치**: `documents.is_public` 을 지우고 `visibility` 세 단계로 바꿨다
(`supabase/migrations/0074_document_owner_privacy.sql`).
- `owner` — 소유자 본인만. `document_permissions` 명시 공유도, `is_admin()`
  도 통하지 않는다. 이번에 새로 추가한 단계.
- `private` — 지금까지의 "비공개" 그대로: 소유자 + 명시 공유 + 관리자.
- `public` — 지금까지의 `is_public = true` 그대로: 로그인한 모두가 보고 고침.

`visibility` 를 참조하는 곳은 RLS 정책만이 아니었다 — 성능/재사용을 위해 같은
조건을 각자 인라인해 둔 SECURITY DEFINER 함수 다섯 개
(`can_view_object`, `can_edit_object`, `search_ontology`,
`list_conversation_plugins`, `grant_object_access`)를 전부 함께 고쳤다. 이 중
하나라도 빠뜨리면 "목록/에디터에서는 안 보이는데 검색 결과나 AI 대화 첨부,
실시간 협업 채널 구독으로는 여전히 새는" 구멍이 남는다 — 특히
`grant_object_access()` 는 `can_view_object` 를 거치지 않고 소유자/관리자
여부만 직접 검사했으므로, 고치지 않았다면 관리자가 자기 자신에게 owner 단계
문서의 열람 권한을 몰래 부여할 수 있는 유일한 남은 구멍이었다.

`document_permissions` 의 정책에 `visibility` 조건을 raw
`exists(select … from documents …)` 로 바로 넣으면 `documents_select` 정책이
다시 `document_permissions` 를 쿼리하고, 그 정책이 다시 `documents` 를
쿼리하는 순환이 생겨 "infinite recursion detected in policy" 로 죽는다 —
0017/0018 이 이미 한 번 고쳤던 것과 같은 함정이다. 기존 `is_document_owner()`
와 같은 원칙으로 새 SECURITY DEFINER 헬퍼 `is_owner_only_document()` 를 만들어
피했다.

앱 레이어(`app/(app)/documents/`): 문서 에디터 툴바의 Public/Private 2단
토글을 Owner only/Private/Public 3단 셀렉트로 바꿨고, 목록의 Visibility
배지에 `owner`(경고색, "Only the owner can see this — not even admins.")
를 추가했다. `shareDocument()` 는 DB 가 어차피 막기 전에 owner 단계 문서에
대한 공유 시도를 앱 레벨에서 먼저 걸러 명확한 이유를 보여준다 — 그러지
않으면 "공유했는데 상대가 못 본다"는 혼란만 남는다.

**범위**: 이번 변경은 `documents` 테이블에만 적용했다(요청이 "문서"였다).
`code_files`/`sheets`/`mind_maps`/`files` 는 아직 `is_public` 2단 그대로다 —
같은 패턴(정책 + `can_view_object` 등 다섯 함수)을 그대로 반복하면 확장할 수
있다.

**검증**: 로컬 Postgres 16 에 Supabase 스키마 스텁(`auth`/`storage`/`realtime`
등)을 얹고 마이그레이션 0001~0074 를 전부 재생한 뒤, `owner`/`private`/
`public` 세 문서와 소유자·관리자·무관한 사용자·공유받은 사용자 네 명으로
시나리오를 짜서 검증했다: 관리자의 RLS `SELECT`, `can_view_object`,
`can_edit_object`, blind `UPDATE`(제목 변경 시도, `visibility` 를 몰래
`private` 로 내리는 시도 포함), blind `DELETE`, `grant_object_access` 로
자기 자신에게 권한을 부여하는 시도, `share_object_with_conversation`,
그리고 `document_permissions` 목록 열람까지 — 관리자와 무관한 사용자 모두
owner 단계 문서에 대해 어떤 경로로도 읽기·쓰기·삭제·공유목록열람·권한부여가
전부 막혔고, `private`/`public` 문서의 기존 동작은 회귀 없이 그대로였다.
`npx tsc --noEmit`, `npm run build` 모두 정상.

## "달력 추가조차 안 된다" — 캘린더 액션이 실패를 삼켜 무한 로딩 (v1.6.9)

**증상**: 캘린더 화면에서 "New calendar" 로 이름/색을 넣고 저장을 누르면 버튼이
"Saving…" 에 멈춘 채 아무 반응이 없다 — 성공도 실패도 아닌, 그냥 멈춘다.
일정 저장·삭제·초대 응답·구독 링크 발급 등 캘린더의 다른 조작도 같은 증상을
보일 수 있다.

**원인**: `app/(app)/calendar/actions.ts` 의 18개 Server Action 전부가
`requireUser()`/`createClient()`/Supabase 호출을 어떤 것도 `try/catch` 로
감싸지 않았다. 이 파일 안쪽에서 `after()` 로 응답 뒤에 실행되는 두 헬퍼
(`scheduleNextReminder`, `notifyInvitees`) 만 이미 감싸여 있었다 — 정작
사용자가 직접 누르는 액션들은 하나도 감싸여 있지 않았던 것이다. 네트워크
순간 장애나(v1.6.8 에서 고친) 환경변수 문제 같은 것으로 이 호출들 중 하나가
던지면 Server Action 의 미처리 예외가 되어 브라우저로 응답 자체가 오지
않는다. `calendar-shell.tsx`/`event-dialog.tsx` 쪽 버튼 핸들러(`save`,
`remove`, `share`, `onSave`, `onDelete`, `onRespond` 등)는 응답이 온다는
전제로 `setBusy(true)` 다음에 곧장 `await` 했으므로, 응답이 영영 안 오면
`setBusy(false)` 도 영영 불리지 않는다 — 이것이 "저장 중…" 에 멈춘 버튼의
정체다. 로그인에서 실제로 있었던 것과 같은 구조의 버그다(v1.6.5 참고) —
다만 캘린더는 오류 화면조차 뜨지 않고 조용히 멈춘다는 점이 더 나빴다.

**조치**:
- `app/(app)/calendar/actions.ts` — 18개 exported action 전부에
  `try/catch` 를 둘렀다. `redirect()` 가 던지는 `NEXT_REDIRECT` 는
  `isNextControlFlowError()` 로 가려 그대로 다시 던지고(로그인 액션들과
  같은 원칙, `lib/auth.ts`/`lib/next-control-flow.ts`), 그 밖의 예상 밖
  실패는 로그로 원인을 남기고 함수의 반환 타입에 맞는 안전한 값(조회는
  `[]`/`null`, 변경은 `{ error: "..." }`)으로 응답한다 — 이제 이 파일의
  어떤 액션도 던지지 않는다.
- `app/(app)/calendar/calendar-shell.tsx`, `app/(app)/calendar/event-dialog.tsx`
  — `CalendarDialog` 의 `save`/`remove`/`share`/`unshare`, `SubscribeDialog`
  의 `loadToken`/`onFile`, `EventDialog` 의 `onSave`/`onDelete`/`onRespond`/
  `addLink`/`removeLink` 를 `try/finally` (또는 `try/catch/finally`) 로
  다시 감쌌다. 서버가 이제 던지지 않더라도, 브라우저↔서버 요청 자체가
  네트워크 순간 장애로 reject 할 가능성은 여전히 남아 있다 — 그 경우까지
  `busy` 상태가 반드시 풀리고 일반 오류 문구가 뜨도록 방어했다.
- `app/(app)/chat/actions.ts` 의 `listChatContacts()` 도 같은 방식으로
  감쌌다 — 캘린더 페이지(`app/(app)/calendar/page.tsx`)가 이 함수를
  `listCalendars()` 와 `Promise.all` 로 함께 부르기 때문에, 이 함수 하나가
  던지면 캘린더 페이지 전체가 렌더되지 않았다. (참고: `chat/actions.ts`
  의 나머지 액션들은 이번 수정 범위 밖이다 — 채팅 화면 자체의 동작으로
  보고된 문제가 없어 캘린더 페이지의 직접 의존성인 이 함수만 손댔다.)

**검증**: `npx tsc --noEmit`, `node lib/observability.test.mjs`(4/4 통과),
`npm run build` 모두 정상 — 빌드 로그에 찍히는 두 줄의
`[possion] NEXT_PUBLIC_SUPABASE_URL/...` 오류는 이 샌드박스에 Supabase
환경변수가 없어 정적 생성 중 `requireUser()` 가 예상대로 방어에 들어간
것이지 회귀가 아니다(v1.6.8 의 가드가 의도한 동작 그대로).

## 배포 후 장애 — "Sign-in screen could not load" (v1.6.5)

### 무엇이 보고됐나

배포 후 로그인 화면에서 **"Sign-in screen could not load"** 와 함께
`reference: 234203017` 만 보이는 상태가 보고됐습니다. 이 문구는 우리 코드
(`app/(auth)/error.tsx`)가 그리는 화면이고, `reference` 는 그 오류의
`digest` 입니다 — 즉 로그인 화면이 완전히 죽은 게 아니라, **그 세그먼트
안에서 뭔가 던져 error 경계가 잡았고, 프로덕션 빌드가 실제 메시지를
가려서** 이 digest 만 남은 상태였습니다. (v1.6.1 에서 다룬 digest
`3290735100` 과 같은 부류지만 다른 사건입니다 — 매번 새 digest 가 나오는
것은 우리 계측이 계속 다른 오류들을 잡아내고 있다는 뜻이기도 합니다.)

### 원인

`(auth)` 경로 그룹 안에서 Supabase 를 직접 부르는 곳 세 군데가
**감싸여 있지 않았습니다.**

| 위치 | 무엇이 벗겨져 있었나 |
| --- | --- |
| `app/(auth)/login/actions.ts` | `signInWithPassword` · 프로필 조회 · `signOut` |
| `app/(auth)/signup/actions.ts` | `signUp` |
| `lib/auth.ts` `requireUser()` | 프로필 조회(`auth.getUser()` 바로 다음 줄) |

이 저장소는 이미 같은 문제를 여러 번 겪고 고쳐 온 전례가 있습니다 —
`lib/supabase/middleware.ts` 는 `auth.getUser()` 호출을 try/catch 로
감싸며 정확히 이렇게 적어 두었습니다: *"Supabase 연결 실패(네트워크 오류,
잘못된 URL 등)로 미들웨어가 죽어 사이트 전체가 500 이 되는 것을 방지한다."*
`requireUser()` 자신도 `auth.getUser()` 는 감쌌습니다. 그런데 **바로 다음 줄의
프로필 조회는 감싸지 않았고**, 로그인·가입 액션은 애초에 아무것도 감싸지
않았습니다. Server Action 안에서 처리되지 않은 예외는 그 라우트의
`error.tsx` 로 튀어 오르고, 프로덕션은 실제 메시지를 지우므로 사용자에게는
정확히 "Sign-in screen could not load · reference: …" 만 남습니다.

**같은 사용자가 겪는 것으로 보이는 상황이 실제로는 세 가지** 였다는 뜻입니다.
로그인 화면 자체가 못 뜨는 것(v1.6.1 에서 고침, `/login` GET), 로그인/가입을
**시도했을 때** 실패하는 것(이번 건, Server Action POST), 로그인 이후 보호된
화면들이 못 뜨는 것(`requireUser` 를 쓰는 모든 페이지) — 세 경로가 각각
독립적으로 뚫려 있었고 이번에 세 번째까지 막았습니다.

### 고침

세 군데 모두 미들웨어와 같은 패턴으로 감쌌습니다 — try/catch, 실패하면
"복제 지연으로 아직 안 보임" 과 같은 값으로 안전하게 폴백(`requireUser`)하거나
화면에 다시 시도할 수 있는 문구를 남깁니다(로그인·가입).

`signup/actions.ts` 는 한 가지 주의가 필요했습니다 — 가입 성공 시
`redirect("/dashboard")` 를 부르는데, `redirect()` 는 `NEXT_REDIRECT` 라는
제어 흐름 신호를 예외로 던져 Next 가 처리하게 하는 방식입니다. 이걸
try/catch **안에** 두면 그 신호까지 여기서 삼켜져 "가입 성공 후 이동" 이
"가입 실패" 메시지로 둔갑합니다. `redirect()` 호출은 try 블록 **밖으로**
빼서 이 문제를 피했습니다.

### 검증 — 재현 후 고쳤음을 직접 증명

"고쳤다" 를 주장으로 남기지 않고, **고치기 전 코드가 실제로 이 증상을
재현하는지** 부터 확인했습니다.

1. `lib/supabase/server.ts` 의 `createClient()` 에 환경변수로 켜지는 강제
   throw 를 임시로 심었습니다(커밋에는 없습니다).
2. **고치기 전** `login/actions.ts` 로 프로덕션 빌드를 띄우고, 실제 브라우저로
   로그인 폼을 제출했습니다 → **error 경계가 잡혔고 "Sign-in screen could
   not load" 가 그대로 재현**됐습니다.
3. **고친 뒤** 같은 조건으로 같은 폼을 제출했습니다 → error 경계는 잡히지
   않고, 화면에는 "Something went wrong on our end. Please try again in a
   moment." 라는 인라인 메시지가 남았습니다. 가입 폼도 동일하게 확인했습니다.
4. 미인증 상태로 보호된 페이지(`/dashboard`)에 접근하는 기존 동작(로그인으로
   리다이렉트)이 그대로인지 회귀 확인했습니다 — 이상 없음.
5. 강제 throw 코드와 임시 테스트 스크립트는 검증 후 제거했습니다 — 커밋에
   포함된 diff 는 세 파일(`lib/auth.ts`, `login/actions.ts`,
   `signup/actions.ts`)의 실제 고침뿐입니다.

이 외에 마이그레이션 0001~0072 재생, 시나리오 77건, 단위 테스트 8개,
`tsc`·`npm run build` 를 전부 다시 통과시켰습니다(아래 [전체 수치](#전-기능-검증-v163)
와 같은 절차).

## 로그인이 계속 안 됨 — createClient() 가 환경변수 없음을 방어하지 않았다 (v1.6.8)

### 무엇이 보고됐나

v1.6.7 을 배포한 뒤에도 로그인이 여전히 **"Something went wrong on our
end. Please try again in a moment."** 로 실패한다는 보고를 받았습니다.
v1.6.7 은 `measure()` 의 `finally` 시맨틱스 버그를 고쳤지만, 그건 계측
코드가 스스로 만들어내던 실패였을 뿐입니다 — 로그인 로직 자체가 던지는
다른 원인이 있다면 그 고침과 무관하게 여전히 실패합니다. 실제로 그랬습니다.

### 원인 재현

`lib/supabase/server.ts` 의 `createClient()` 는 이렇게 되어 있었습니다.

```ts
return createServerClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { ... }
);
```

`!` 는 타입에게만 "undefined 아니다" 라고 말할 뿐, 런타임에 실제로
undefined 면 아무 의미가 없습니다. `NEXT_PUBLIC_SUPABASE_URL`/
`NEXT_PUBLIC_SUPABASE_ANON_KEY` 가 배포 환경에 없으면 `createServerClient`
는 `@supabase/ssr` 안쪽에서 곧바로 이렇게 던집니다.

```
Your project's URL and Key are required to create a Supabase client!
```

`lib/supabase/middleware.ts` 는 **정확히 이 상황을 이미 방어하고
있었습니다** — `if (!supabaseUrl || !supabaseAnonKey)` 를 검사해 사이트
전체가 500 이 되는 것을 막습니다. 그런데 그 방어는 미들웨어에만 있었고,
`createClient()` 자신에는 없었습니다. 미들웨어를 통과한 뒤 Server Action
안에서 다시 `createClient()` 가 불리면(로그인·가입 포함) 이 검사 없이
그대로 SDK 오류가 터졌고, v1.6.5 에서 로그인 액션에 둘러 둔 try/catch가
그 오류를 잡아 매번 "Something went wrong on our end" 를 돌려줬습니다 —
**v1.6.5/v1.6.6/v1.6.7 모두 이 오류를 더 안전하게 잡는 방법을 고쳤을
뿐, 애초에 이 오류가 왜 나는지는 건드리지 않았습니다.**

로컬에서 `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` 를
**완전히 비운 채** 프로덕션 빌드를 띄우고 실제 브라우저로 로그인을
제출했더니, 보고된 메시지와 **글자 하나까지 동일하게** 재현됐고 서버
로그에는 정확히 이 SDK 오류가 찍혔습니다.

### 고침

`createClient()` 에도 미들웨어와 같은 검사를 추가했습니다. 값이 없으면
SDK 의 알 수 없는 오류 대신, 어디가 왜 비어 있는지 분명히 말하는 오류를
던집니다 — 사용자에게 보이는 메시지는 그대로 두되(보안상 일부러 일반적인
문구를 유지합니다), 서버 로그에는 원인이 정확히 남습니다. 이 검사는
`createClient()` 를 부르는 **모든** 곳(앱 전체 100곳 이상)에 한 번에
적용됩니다.

### 지금 확인해야 할 것

**이 문제는 코드로 고칠 수 있는 버그가 아니라 배포 환경 설정 문제일 가능성이
높습니다.** 재현 조건이 "환경변수가 실제로 없음" 이었기 때문입니다.
로그인이 안 되는 그 배포 주소에서 `/api/health` 를 열어 보세요(로그인
없이 열립니다) — `env.NEXT_PUBLIC_SUPABASE_URL` 과
`env.NEXT_PUBLIC_SUPABASE_ANON_KEY` 가 `false` 로 나오면 바로 이 문제이고,
Vercel 프로젝트 설정 → Environment Variables 에서 **지금 테스트 중인
배포 환경(Development/Preview/Production 중 어느 것인지)** 에 이 두 값이
실제로 등록돼 있는지 확인해야 합니다. 값 자체는 이 문서에도, `/api/health`
에도 절대 나타나지 않습니다 — 존재 여부만 보여줍니다. (이 세션은 배포된
주소에 직접 접근할 권한이 없어 — Vercel Deployment Protection 이 걸려
있어 자동 확인은 시도했지만 403 을 받았습니다 — 이 마지막 확인은 직접
해 주셔야 합니다.)

`db.reachable` 이 `false` 인데 `env` 두 값은 `true` 라면 원인이 다릅니다 —
그때는 Supabase 프로젝트 자체가 일시정지됐거나 URL 이 잘못된 경우이니
알려 주시면 그 경로를 다시 봅니다.

### 검증

로컬에서 env 값을 완전히 비운 프로덕션 빌드로 재현 → 고침 적용 → 서버
로그에 새 진단 메시지가 남는지 확인했습니다. `/api/health` 가 같은 조건에서
`env.NEXT_PUBLIC_SUPABASE_URL: false`·`db.error: "missing-env"` 를 정확히
보고하는 것도 함께 확인했습니다. env 값이 정상인 경우 `/login`·`/signup`·
`/dashboard`·`/api/health`·`/sw.js`·`/manifest.json` 전부 회귀 없이 그대로
동작합니다. 마이그레이션 0001~0073 재생, 시나리오 85건, 단위 테스트 9개,
`tsc`·`npm run build` 를 다시 통과시켰습니다.

## 배포 후 장애 — v1.6.6 이 로그인을 100% 깨뜨렸다 (v1.6.7)

### 무엇이 보고됐나

v1.6.6(프로덕션 계측 추가)을 배포한 직후, 로그인 시도가 전부 **"Something
went wrong on our end. Please try again in a moment."** 로 실패한다는 보고를
받았습니다. 이건 v1.6.5 에서 새로 넣은 `login/actions.ts` 의 일반 오류
메시지입니다 — 즉 v1.6.5 가 막으려던 "화면이 통째로 죽는 사고" 는 막았지만,
바로 다음 배포(v1.6.6)가 로그인을 **항상 실패하는** 상태로 만들었다는
뜻입니다. 아이디/비밀번호가 맞아도 마찬가지였습니다.

### 원인 — JavaScript `finally` 시맨틱스

v1.6.6 에서 넣은 `lib/observability.ts` 의 `measure()` 는 이런 모양이었습니다.

```ts
try {
  return await fn();       // 로그인 로직 — 성공하면 { ok: true, redirectTo }
} finally {
  // 로그 남기기, after() 로 표본 기록 예약 …
}
```

**JavaScript 의 `finally` 는, 그 안에서 무언가 던지면 `try` 의 결과(성공
반환값이든 이미 던져진 오류든 상관없이)를 통째로 덮어씁니다.** `measure()`
의 `finally` 안에서 `after()` 호출이나 그 주변 코드가 배포 환경에서 던지는
순간, **로그인이 실제로는 성공했어도 그 반환값은 사라지고** `finally` 의
오류만 `login()` 의 바깥 `catch` 로 올라가 "Something went wrong on our
end" 를 돌려줬습니다. `lib/observability.ts` 자체에 "계측 실패가 기능
실패가 되면 안 된다" 라고 주석까지 적어 뒀지만, `finally` 배치 때문에 실제로는
그 반대로 동작하고 있었습니다.

로컬 `next start` 재현 환경에서는 `after()` 가 조용히 성공해 이 문제가 전혀
드러나지 않았습니다 — 배포 환경(Vercel)의 서버리스 함수 조건에서만
나타났고, **로그인은 모든 세션이 반드시 거치는 경로라 다른 `after()` 사용
지점(파일 다운로드 감사 로그 등)보다 훨씬 빨리, 훨씬 자주 이 문제에
부딪혔습니다.**

### 고침

`measure()` 의 `finally` 블록 **안**에 다시 try/catch 를 하나 더 둡니다.
계측 코드(로그·`after()` 예약)에서 무엇이 던지든 그 안에서 잡아 삼키고,
바깥의 `try` 결과(성공 반환값이든 `fn()` 자체가 던진 실제 오류든)는 절대
건드리지 않습니다.

### 검증 — 정확히 이 시맨틱스를 고정했다

1. `lib/observability.test.mjs` — Next 런타임 없이 순수 JS 로 `finally`
   시맨틱스 자체를 검증하는 단위 테스트 4개를 추가했습니다: 고치기 전
   모양은 계측 오류가 성공 반환값을 삼킨다는 것을(버그 재현), 고친 모양은
   계측이 던져도 성공 반환값이 살아남는다는 것과, 실제 오류(`fn()` 이 던진
   것)는 여전히 정확히 전달된다는 것을(성공 케이스와 실패 케이스 둘 다) 확인합니다.
2. 실제 `lib/observability.ts` 파일로도 확인했습니다. 환경변수로 켜지는
   강제 throw 를 `finally` 안에 임시로 심고, **고치기 전** 코드로 프로덕션
   빌드를 띄워 실제 브라우저로 로그인을 제출했더니 정확히 보고된 증상
   ("Something went wrong on our end")이 재현됐습니다. **고친 뒤** 같은
   강제 throw 조건에서 같은 폼을 제출하면 올바른 결과("Invalid email or
   password.")가 그대로 나왔습니다.
3. 강제 throw 코드와 임시 테스트 스크립트는 검증 후 제거했습니다 — 커밋에
   포함된 diff 는 `lib/observability.ts` 의 실제 고침과 새 단위 테스트뿐입니다.

마이그레이션 0001~0073 재생, 시나리오 85건, 단위 테스트 9개(신규 1개 포함),
`tsc`·`npm run build` 를 다시 통과시켰습니다.

## 프로덕션 계측과 SLO 목표치 (v1.6.6)

v1.6.4 의 꼬리 지연 감사를 로컬 재현 환경으로 끝내며 이렇게 적어 뒀습니다 —
*"SLO 목표치 설정. 목표를 정하려면 배포 환경의 실제 분포가 필요합니다.
그 전까지 이 문서의 숫자는 '구조가 이렇다'는 근거이지 '우리는 이렇다'는
값이 아닙니다."* 이번이 그 분포를 실제로 쌓는 장치입니다.

### 무엇을 쌓는가

`lib/observability.ts` 의 `measure(supabase, feature, fn)` 가 Server Action
여섯 곳을 감쌉니다 — v1.6.4 에서 가장 무거웠던 경로들(캘린더 한 달 조회·
다가오는 일정·통합 검색·첨부 카드·첨부 후보 검색)과, 이번 장애의 진입점이라
전수로 재는 로그인·가입입니다.

```
auth.login · auth.signup · calendar.month · calendar.upcoming
search.ontology · sharing.cards · sharing.attachable
```

두 가지를 동시에 합니다.

1. **로그**: 호출마다 `[possion:perf] feature=… ms=…` 한 줄을
   `instrumentation.ts` 의 `[possion:error]` 와 같은 convention 으로 남깁니다.
   Vercel Logs 에서 그대로 검색되고, 나중에 로그 기반 도구(Log Drain 등)를
   연결해도 앱 코드를 더 고칠 필요가 없습니다.
2. **표본**: `perf_samples` 테이블(0073)에 **일부만** 기록합니다 — 기능마다
   `lib/slo.ts` 의 `sampleRate` 만큼(로그인·가입은 1, 자주 불리는 읽기는
   0.2~0.3). 계측 자체가 부하가 되면 v1.6.4 에서 줄인 지연을 다시 늘리는
   꼴이라, 매 호출을 다 쓰지 않습니다. 쓰기는 Next 의 `after()` 로
   **응답을 보낸 뒤에** 붙습니다(`files/actions.ts` 의 감사 로그 기록과
   같은 자리) — 계측이 요청 자체를 느리게 만들지 않습니다.

`measure()` 는 `fn()` 이 실패해도(그 실패까지 포함해) 시간을 재고 그대로
다시 던집니다 — 오류를 삼키지 않습니다.

### 어디서 보는가

**Admin Console → Observability**(`/admin/observability`, 관리자 전용).
기능별 p50/p90/p99/p999·최댓값·이상치 비율을 1시간/24시간/7일/30일 창으로
봅니다. 산술평균은 쓰지 않습니다 — v1.6.4 감사와 같은 원칙입니다. 표본이
30건 미만이면 "low n" 으로 표시합니다(p999 는 꼬리 표본이 n/1000 개뿐이라
표본이 적으면 신뢰할 수 없습니다). 배포 직후처럼 트래픽이 적을 때는
"no data"/"low n" 이 뜨는 것이 정상입니다 — 오작동이 아닙니다.

### SLO 목표치 — 잠정치입니다

`lib/slo.ts` 에 기능마다 p99/p999 목표를 적어 뒀습니다. v1.6.4 에서 로컬로
잰 서버(DB)측 백분위에, 배포 환경의 네트워크+PostgREST 왕복을 감안한 여유를
얹어 정했습니다 — 지금 새로 재는 `measure()` 는 그 왕복을 **전부 포함**해서
재므로(v1.6.4 의 `bench.sql` 은 PL/pgSQL 안에서만 쟀지만, 이번 계측은 Server
Action 이 `supabase.rpc(...)` 를 왕복하는 전체 시간입니다), 목표치를 DB
전용 값보다 훨씬 넉넉하게 잡았습니다.

| 기능 | 목표 p99 | 목표 p999 | 근거 |
| --- | --- | --- | --- |
| 로그인 | 800ms | 2000ms | GoTrue 왕복(비밀번호 해시 확인)이 섞여 순수 조회보다 느린 게 정상. 전수 기록 |
| 회원가입 | 1000ms | 2500ms | signUp 은 로그인보다 무겁다(계정 생성 + 트리거) |
| 캘린더 한 달 조회 | 60ms | 150ms | 로컬 DB p99 7.7ms·p999 10.1ms(0071 최적화 후) |
| 다가오는 일정 | 40ms | 100ms | 로컬 DB p99 4.6ms·p999 5.3ms |
| 통합 검색 | 80ms | 200ms | 로컬 DB p99 5.9ms·p999 8.1ms(0072 최적화 후). 실제 검색어 분포는 시드보다 다양할 수 있어 여유를 더 뒀다 |
| 첨부 카드 조회 | 40ms | 100ms | 채팅·캘린더 곳곳에서 자주 불림 |
| 첨부 후보 검색 | 80ms | 200ms | v1.6.4 감사 시점 최적화 후 가장 느린 기능(로컬 p999 13.4ms) |

**목표가 아니라 첫 추정치로 대해야 합니다.** `/admin/observability` 에
표본이 30건 이상 쌓이는 대로 실측값과 비교해 다시 조정하는 것이 이
작업의 다음 단계입니다.

### 새로 생긴 것

| 항목 | 내용 |
| --- | --- |
| `supabase/migrations/0073_perf_observability.sql` | `perf_samples` 테이블(RLS `using(false)` — `app_secrets` 와 같은 패턴). `record_perf_sample(feature, ms)`(authenticated+anon, 입력 검증 후 조용히 버림), `get_perf_percentiles(hours)`(관리자 전용, 산술평균 없음), `purge_old_perf_samples()`(30일 보관, trash 자동 비우기와 같은 pg_cron 패턴) |
| `lib/slo.ts` | 기능별 SLO 목표(p99/p999)와 표본 비율. 서버·클라이언트 양쪽에서 import 가능(부작용 없음) |
| `lib/observability.ts` | `measure()` — 시간 측정 + 로그 + 샘플링된 `after()` 기록 |
| `app/(app)/admin/observability/page.tsx` | 관리자 전용 백분위 대시보드 |
| `app/globals.css` | `.badge-warn`·`.badge-danger` 추가(SLO 상태 표시용) |

## 배포 후 장애 — "Sign-in screen could not load" (v1.6.5)

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
- 주/일 보기의 **빈 칸을 한 번 탭**하면 그 시각(15분 단위)으로 새 일정이 열립니다
  — 마우스와 터치가 같은 동작입니다
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
| 팀(워크스페이스) | 가입 시 팀 선택/생성 온보딩(`/choose-team`), 한 사용자가 여러 팀에 속하고 헤더 팀 전환기(`app/(app)/team-switcher.tsx`)로 활성 팀을 바꾼다. 팀장은 위임·멤버 승인/거절/추방·공개(open)/비공개(closed) 전환·팀 삭제가 가능하고(`/team` 관리 페이지), 비공개 팀은 가입 신청 후 팀장 승인이 필요하다. Repository 와 채팅은 팀별로 분리되고, 문서/코드/시트/마인드맵 공유는 같은 팀 멤버끼리만 가능하다(0080) |
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
| 시맨틱 검색(RAG) | 헤더 검색에 의미 기반 결과 병행 표시(마이그레이션 0041, pgvector + NVIDIA nv-embedqa-e5-v5) — 저장 시 내용 해시가 바뀐 경우에만 임베딩 재계산(`lib/embeddings.ts`), 어휘(tsvector)+의미 하이브리드, RLS(can_view_object) 동일 적용, 임베딩 API 장애 시 어휘 검색만으로 우아하게 강등. 연결 항목 펼침은 온톨로지 그래프 2단계 탐색(`get_linked_objects_deep`, 재귀 CTE, "via X" 표시) |
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
자신의 공유 ID 를 복사해 상대에게 전달합니다. 단, 팀 시스템 도입(0080) 이후
공유는 **같은 팀 멤버끼리만** 가능합니다 — 다른 팀 소속의 공유 ID 를 입력하면
"You can only share with members of your current team." 안내와 함께 거부됩니다.

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

## 꼬리 지연(tail latency) 측정과 개선 — v1.6.4

기능별 응답시간을 **백분위**로 재고, 꼬리를 만드는 구조를 찾아 고쳤습니다.
산술평균은 쓰지 않았습니다 — 이 시스템에서 평균은 존재하지 않는 요청을 묘사합니다
(통합 검색은 드문 낱말 1.1 ms, 흔한 낱말 298 ms 였고, 그 평균 75 ms 인 요청은 없습니다).

### 측정 방법과 그 한계

**프로덕션 텔레메트리가 없습니다**(APM·요청 로그 미설치). 그래서 배포 환경의 실제
백분위는 이 문서에 없습니다. 대신 재현 가능한 환경에서 측정했습니다.

- 스키마 0001–0072 를 빈 PostgreSQL 16 에 재생하고, 50명이 1년 쓴 규모를 넣었습니다
  (메시지 40,000 · 일정 6,000 · 참석자 24,000 · 문서 3,000 · 파일 4,000 · 권한 9,000).
- **`authenticated` 롤로** 실행했습니다. 슈퍼유저로 재면 RLS 를 통째로 건너뛰어
  사용자가 겪는 시간이 나오지 않습니다 — 처음에 이 실수를 했고, 결과가 달라져 다시 쟀습니다.
- 표본은 기능당 5,000~20,000건입니다. **p999 는 꼬리 표본이 n/1000 개뿐**이라
  아래 표에는 언제나 n 을 함께 적었습니다. n=2,000 의 p999 는 꼬리 두 건으로 나온 값입니다.
- HTTP 는 프로덕션 빌드에 `getrusage(2)`·`PerformanceObserver` 관찰자를 붙여 측정했습니다.

### 무엇이 꼬리를 만들고 있었나

세 가지 모두 같은 병이었습니다 — **행마다, 한 건씩, 차례로.**

| 구조 | 증상 |
| --- | --- |
| 권한 판정이 행마다 함수 호출 | `can_view_calendar` · `can_view_object` 는 SECURITY DEFINER 라 플래너가 인라인할 수 없습니다. WHERE 에 두면 인덱스로 행을 줄이지 못하고 전체를 훑으며 행마다 함수를 부릅니다. 통합 검색은 후보 3,000행에 3,000번 호출했습니다 |
| 같은 테이블을 행마다 네 번 | `attendee_count`/`accepted_count`/`my_response`/`is_invited` 가 각각 상관 서브쿼리라, 일정 하나마다 참석자 테이블을 네 번 훑었습니다. 376행에 shared buffer 25,405회 — 행당 68회 |
| 비싼 계산이 필터보다 앞 | 검색이 union **뒤에** 권한 필터를 두어, 버려질 행의 스니펫(문서 본문 전체 파싱)까지 이미 계산한 뒤였습니다 |

**꼬리는 사용자 편차를 따라 증폭됩니다.** 이 비용은 범위 안의 행 수에 비례하고,
달력을 여러 개 공유받은 사람일수록 행이 많습니다 — 그 사람이 바로 p99·p999 에 앉아
있는 사용자입니다. 즉 꼬리를 만든 것은 시스템 잡음이 아니라 **입력 분포**였습니다.

### 고친 결과 (같은 DB · 같은 데이터 · 같은 하네스)

| 기능 | p50 | p99 | p999 | 배율(p999) |
| --- | --- | --- | --- | --- |
| 통합 검색 — 이전 (n=2,000) | 211.6 ms | 268.1 ms | 371.6 ms | |
| 통합 검색 — 이후 (n=5,000) | **4.3 ms** | **5.9 ms** | **8.1 ms** | **46×** |
| 캘린더 한 달 조회 — 이전 (n=2,000) | 136.5 ms | 195.0 ms | 218.7 ms | |
| 캘린더 한 달 조회 — 이후 (n=5,000) | **5.3 ms** | **7.7 ms** | **10.1 ms** | **21.6×** |
| 다가오는 일정 — 이전 (n=2,000) | 101.4 ms | 122.6 ms | 145.2 ms | |
| 다가오는 일정 — 이후 (n=5,000) | **2.8 ms** | **4.6 ms** | **5.3 ms** | **27.4×** |

버퍼 접근은 25,405 → 4,083 으로 줄었습니다. 드문 낱말 검색만 0.9 → 1.4 ms 로
조금 느려졌는데, p999 를 363 ms 줄이는 대가로는 받아들일 만합니다.

> **반환 결과가 같은지 따로 검증했습니다.** 빨라졌는데 답이 달라졌으면 최적화가
> 아니라 버그입니다. 캘린더 두 함수는 50명 × 6기간을 전 컬럼 대조해 **차이 0건**
> 이었습니다(처음 시도에서 44,470건 차이가 나 원인을 찾아 고쳤습니다 — 초대만
> 받고 달력은 공유받지 않은 일정의 달력 이름이 NULL 이 되고 있었습니다).
> 검색은 동점 처리가 원본부터 임의라 계약으로 검증했습니다 — 350건에서 행 수 일치,
> rank 분포 일치, **권한 없는 행 0건**.

### head-of-line blocking — 한 건이 나머지를 막던 자리

| 위치 | 무슨 일이 있었나 | 고침 |
| --- | --- | --- |
| `app/api/push/dispatch/route.ts` | 회수한 알림 50건을 `for … await` 로 하나씩 처리. 푸시는 외부 서비스(FCM/APNs) 호출이라 한 건이 몇 초 걸리는 일이 드물지 않고, 그 뒤로 49건이 전부 대기. 09:00 회의 알림이 남의 느린 엔드포인트 때문에 늦는 구조 | 상한 8의 동시 처리. 한 건이 느려도 그 작업자만 붙잡힌다 |
| `lib/chat-notify.ts` | 푸시 후 죽은 구독 정리·생존 표시를 한 건씩. 12명 그룹이면 왕복 24번이고 그 **맨 뒤에 이메일 폴백**이 걸린다 | `Promise.all` |
| `lib/auth.ts` · `lib/supabase/server.ts` | `requireUser()` 는 호출마다 직렬 왕복 2번(`auth.getUser()` 는 GoTrue 에 실제 요청을 보낸다). 125곳이 부르고 레이아웃·페이지가 각각 부른다 — 미들웨어까지 합쳐 `/dashboard` 한 장이 인증 왕복 6번으로 시작했고 그중 4번은 같은 질문의 반복 | React `cache()` 로 요청당 한 번 |

### 부하와 큐 — "응답시간"의 대부분은 일하는 시간이 아니었다

프로덕션 빌드의 `/login` 을 동시성 1 → 32 로 올리며 측정했습니다.

| 동시성 | 처리량 | p50 | p99 | p999 |
| --- | --- | --- | --- | --- |
| 1 | 107.8 req/s | 8.4 ms | 19.4 ms | 45.9 ms |
| 8 | 129.5 req/s | 59.4 ms | 110.3 ms | 148.8 ms |
| 32 | 137.7 req/s | 227.5 ms | 347.1 ms | 428.7 ms |

**동시성을 32배 올렸는데 처리량은 1.28배만 늘었습니다.** 나머지는 전부 큐입니다.
리틀의 법칙으로 확인하면 동시성 32의 예상 체류시간 = 32 ÷ 137.7 = 232 ms, 실측 p50 은
227.5 ms — 거의 정확히 일치합니다. 이 화면의 **진짜 서비스 시간은 동시성 1의 8.4 ms**
이고 나머지는 기다린 시간입니다.

### 컨텍스트 스위치 · 페이지 폴트 · GC 정지 · TCP 재전송

워커 프로세스 안에서 직접 수집한 값입니다(밖에서 `/proc` 을 긁은 것이 아닙니다).

| 후보 | 실측 | 주원인인가 |
| --- | --- | --- |
| **큐 대기** | 동시성 32의 p50 227.5 ms 중 219 ms | **예 — 가장 큰 원인** |
| **쿼리 구조** | 최대 366 ms (검색 371.6 → 8.1) | **예 — 고쳤음** |
| GC 정지 | 전체 시간의 0.86%, scavenge 5,314회 p50 3.46 ms, major 최대 **80 ms** | 일부. 동시성 1의 max 103 ms 같은 단발 이상치는 설명하지만, p999−p50 = 313 ms 격차는 설명하지 못한다 |
| 컨텍스트 스위치 | 비자발적(선점) 110,990회 = 초당 52회 | 일부. 포화의 *결과*이자 지터의 원인이지만 단독으로 수백 ms 를 만들지 않는다 |
| 페이지 폴트 | **메이저 0건** (minor 418,529 · RSS 462 MB) | 아니오. 디스크로 내려간 적이 없다 |
| TCP 재전송 | 51건 / 388,176 세그먼트 = **0.011%**, 타임아웃 0건 | 아니오. 다만 이 측정은 루프백이라 **하한값**이고, 배포 환경의 인터넷 구간은 따로 확인해야 한다 |

### 아직 하지 않은 것

- **`getClaims()` 로 인증 왕복 없애기.** supabase-js 2.110 의 `getClaims()` 는 JWKS 로
  JWT 를 로컬 검증하므로(비대칭 서명 키를 쓰는 프로젝트라면) 미들웨어의 네트워크
  왕복 한 번이 통째로 사라집니다. 서명 검증을 하므로 `getSession()` 과 달리 안전합니다.
  **하지 않았습니다** — 인증은 앱 전체의 보안 경계이고, 실제 Supabase 없이 지연 개선을
  이유로 검증 원시연산을 바꾸는 것은 눈 감고 하는 변경입니다. 선행 조건(프로젝트가
  비대칭 서명 키로 이전했는지) 확인 후 별도로 진행할 일입니다.
- **SLO 목표치 설정.** 목표를 정하려면 배포 환경의 실제 분포가 필요합니다. 그 전까지
  이 문서의 숫자는 "구조가 이렇다"는 근거이지 "우리는 이렇다"는 값이 아닙니다.
- **`sharing: 첨부 후보 검색`(p999 13.4 ms)** 이 이제 가장 느린 기능입니다. 다음 차례.

## v1.6 상세 변경 기록 (v1.6.1 · v1.6.2 · v1.6.3 포함)

### 추가된 마이그레이션

| 번호 | 내용 |
| --- | --- |
| `0068_web_push.sql` | `push_subscriptions`(구독 정보 — RLS 로 본인만) + `profiles.push_notifications`. `claim_chat_push_recipients`(보낸 사람 본인만 호출 가능, 45초 이내 읽은 사람 제외 — 이메일의 15분 쿨다운은 두지 않는다), `claim_chat_email_recipients` 를 **`p_exclude` 인자를 받도록 재정의**(푸시로 알린 사람은 메일에서 뺀다), `claim_event_push_recipients`(일정 편집 권한자만), `prune_push_subscription`/`touch_push_subscription` |
| `0069_calendar_occurrences_and_reminders.sql` | `calendar_event_exceptions`(EXDATE) + `calendar_events.detached_from`·`next_reminder_at`. `delete_event_occurrence`·`detach_event_occurrence`(참석자·붙인 자료까지 복사, RSVP 는 초기화), `list_calendar_events`/`get_calendar_event`/`list_upcoming_events` 가 예외 목록과 시간대를 함께 반환, `set_next_reminder`, `app_secrets` + `get_dispatch_token`(관리자 전용), `claim_due_event_reminders`(토큰 인증 · `for update skip locked` 로 중복 발송 차단)·`set_next_reminder_by_token`·`prune_push_subscription_by_token`, `import_calendar_events`(한 문장 일괄 삽입) |
| `0070_push_claim_is_idempotent.sql` (v1.6.3) | `chat_members.last_push_message` 추가. `claim_chat_push_recipients` 가 **같은 메시지를 두 번 청구해도 한 번만** 대상을 돌려주도록 재정의 — 아래 [전 기능 검증](#전-기능-검증-v163) 참고 |
| `0071_calendar_read_path_latency.sql` (v1.6.4) | `list_calendar_events` · `list_upcoming_events` 재작성 — 권한을 행마다 함수로 묻지 않고 한 번에 집합으로 구한 뒤 인덱스를 타게 하고, 참석자 통계 네 개를 LATERAL 한 번으로 합쳤다. `calendar_events_starts_idx` 추가. p999 218.7 → 10.1 ms · 145.2 → 5.3 ms, 결과는 전 컬럼 동일 |
| `0072_search_latency.sql` (v1.6.4) | `search_ontology` 재작성 — 행마다 부르던 `can_view_object` 를 각 브랜치 안의 집합 조건으로 내리고, 브랜치마다 `limit 30`(전체 상위 30에 한 브랜치가 30개 넘게 기여할 수 없으므로 결과 동일), 스니펫은 살아남은 30행에만 계산. p999 371.6 → 8.1 ms |
| `0073_perf_observability.sql` (v1.6.6) | `perf_samples` + `record_perf_sample`(authenticated+anon, 입력 검증) + `get_perf_percentiles`(관리자 전용, 산술평균 없음) + `purge_old_perf_samples`(30일 보관, pg_cron) |

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
| `app/(app)/calendar/calendar-shell.tsx` (v1.6.3) | 주/일 보기의 빈 칸을 **한 번 탭**하면 일정이 열린다(15분 단위 스냅). 일정 블록·알약 위의 클릭은 걸러 낸다 |
| `app/api/health/route.ts` (v1.6.3) | 마이그레이션 상태를 `true`/`false`/`"unknown"` 3값으로. "함수 없음" 은 연결 성공으로 분류하고, `ok` 가 스키마까지 본다 |
| `lib/auth.ts` · `lib/supabase/server.ts` (v1.6.4) | `requireUser()` 와 `createClient()` 를 React `cache()` 로 감쌌다 — 화면 한 장이 같은 인증 왕복을 세 번 하던 것을 한 번으로 |
| `lib/chat-notify.ts` (v1.6.4) | 푸시 뒷정리(prune·touch)를 `for … await` 에서 `Promise.all` 로. 이메일 폴백이 남의 구독 정리 뒤에 줄 서지 않는다 |
| `app/api/push/dispatch/route.ts` (v1.6.4) | 알림 발송을 상한 8의 동시 처리로. 느린 엔드포인트 하나가 나머지 49건을 막지 않는다 |
| `lib/auth.ts` (v1.6.5) | `requireUser()` 의 프로필 조회를 try/catch 로 감쌌다 — `auth.getUser()` 는 이미 감싸여 있었는데 바로 다음 줄은 그러지 않았다. 보호된 화면 전체가 공유하는 경로다 |
| `app/(auth)/login/actions.ts` (v1.6.5) | `signInWithPassword` · 프로필 조회 · `signOut` 을 통째로 try/catch — 어느 하나가 던지면 로그인 화면 전체가 죽던 것을 인라인 오류 메시지로 |
| `app/(auth)/signup/actions.ts` (v1.6.5) | `signUp` 을 try/catch — `redirect("/dashboard")` 는 그 신호(`NEXT_REDIRECT`)가 삼켜지지 않도록 try 블록 **밖으로** 뺐다 |
| `lib/slo.ts` (v1.6.6, 신규) | 기능별 SLO 목표(p99/p999)와 표본 비율. v1.6.4 로컬 백분위 + 배포 여유로 정한 잠정치 |
| `lib/observability.ts` (v1.6.6, 신규) | `measure()` — 시간 측정 + `[possion:perf]` 로그 + 샘플링된 `after()` 기록 |
| `app/(app)/admin/observability/page.tsx` (v1.6.6, 신규) | 관리자 전용 백분위 대시보드. 1H/24H/7D/30D 창, SLO 상태 배지 |
| `app/(auth)/login/actions.ts` · `app/(auth)/signup/actions.ts` (v1.6.6) | `auth.login`/`auth.signup` 계측 추가(전수 기록) |
| `app/(app)/calendar/actions.ts` · `app/(app)/dashboard/page.tsx` · `app/(app)/search/actions.ts` · `app/(app)/sharing/actions.ts` (v1.6.6) | `calendar.month`/`calendar.upcoming`/`search.ontology`/`sharing.cards`/`sharing.attachable` 계측 추가 |
| `app/globals.css` (v1.6.6) | `.badge-warn`·`.badge-danger` 추가 |
| `lib/observability.ts` (v1.6.7) | `measure()` 의 `finally` 안을 다시 try/catch 로 감쌌다 — JS 의 `finally` 는 던지면 `try` 의 성공 반환값을 덮어쓴다는 시맨틱스 때문에, 계측 코드의 예외가 v1.6.6 배포 직후 로그인을 100% 실패시켰다 |
| `lib/observability.test.mjs` (v1.6.7, 신규) | 위 `finally` 시맨틱스를 고정하는 단위 테스트 4개 |
| `lib/supabase/server.ts` (v1.6.8) | `createClient()` 에 `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` 누락 검사 추가 — `lib/supabase/middleware.ts` 에는 있었지만 이 파일에는 없어, 배포 환경에 두 값이 없으면 SDK 의 알 수 없는 오류로 로그인이 매번 실패하고 있었다. `createClient()` 를 부르는 모든 곳에 한 번에 적용된다 |
| `vercel.json` | 5분 간격 cron → `/api/push/dispatch` — **v1.6.1 에서 도로 뺐습니다**(Hobby 플랜이 거부해 배포가 통째로 실패). 지금은 수동 설정 항목입니다 |
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

### UI/UX 전면 점검 (v1.6.2)

v1.5~v1.6 에서 화면을 많이 늘렸으므로, 디자인 취지·반응형·기능 노출·모션을
기준으로 신규 화면을 전부 대조했습니다.

**1) Liquid Glass · 미니멀리즘 일관성.** 이 저장소의 규약은 "떠 있는 표면만
유리" 입니다 — 드롭다운(`.acct-menu` `.hsearch-dropdown` `.chat-attach-menu`),
모달(`.modal`), 토스트(`.upload-card`), 헤더·사이드바 크롬이 그 대상이고,
본문 패널은 불투명한 카드입니다. 캘린더가 이 규약에서 두 곳 벗어나 있었습니다.

| 어긋난 곳 | 시정 |
| --- | --- |
| 모바일에서 **떠서** 열리는 달력 목록(`.cal-side.open`)이 불투명 | `--glass-2` + `--glass-blur` + `--shadow-pop` |
| 일정에 자료를 붙이는 픽커(`.cal-picker`)가 불투명 | `--glass-3` + 유리 + 팝 모션 |

아이콘도 맞췄습니다. 이 저장소는 `✕` 를 글자로 쓰다가 폰트에 따라 컬러
이모지로 그려지는 문제를 겪고 SVG 로 통일한 이력이 있는데(`components/modal.tsx`
주석), 제가 새로 넣은 달력 관리 `⋯` 와 날짜 칸의 `+` 가 다시 글자였습니다 —
`IconMore` / `IconPlus` 로 교체했습니다.

**2) 반응형.** 두 곳이 좁은 화면에서 실제로 못 쓰는 상태였습니다.

- **주 보기**가 360px 폭에 7열을 쑤셔 넣어 한 칸이 45px 도 되지 않았습니다 —
  제목을 한 글자도 못 읽습니다. 열의 최소 폭(84px)을 지키고 격자 전체를
  **한 덩어리로** 가로 스크롤하게 했습니다(머리글·종일 줄·본문을 따로
  스크롤하면 열이 어긋나므로 컨테이너를 하나로 묶었습니다). 일 보기는 최소 폭이
  화면보다 좁아 영향이 없습니다.
- **월 보기**의 칸 높이가 모바일에서 78px 인데 일정 알약을 항상 3개 그려
  넘쳤습니다 — 좁은 화면에서는 2개 + "+N more" 로 줄입니다.

**3) 기능 노출 — 서버에 있는데 화면에서 못 쓰던 것.** 서버 액션을 전수 대조해
찾았습니다.

| 결함 | 시정 |
| --- | --- |
| **회의 링크를 입력만 하고 열 수 없었다.** 필드가 존재할 이유가 없는 상태 | 일정 편집에 **Join** 버튼, 아젠다 목록 각 행에도 **Join**(회의 직전에 목록에서 바로 들어갈 수 있어야 한다) |
| **일정에 붙인 자료가 UUID 앞 8자리**로만 보였다. 무슨 문서인지 알 수 없고 열 수도 없었다 — "회의 전에 읽을 것을 그 자리에 둔다"는 목적을 이루지 못함 | `get_object_cards` 로 **제목**을 채우고 클릭하면 워크스페이스 탭으로 열린다. 권한이 없으면 "No access" 로 표시 |
| 죽은 서버 액션 2개(`listAttachableItems`, `sendEventToChat`) | 삭제. 각각 `list_attachable_objects` RPC 와 `SendToChatButton` 이 대체 |

**4) 모션.** 캘린더에 전환 모션이 전혀 없었습니다. 기존 규약(`modal-pop`
0.22s, `chat-toast-in` 0.18s, `--ease-spring`)과 같은 성격으로 넣었습니다 —
뷰 전환 fade-up 0.18s, 알림 배너 slide-down, 모바일 달력 목록 시트 인, 픽커 팝,
일정 블록의 누름 반응(0.985 scale)과 hover 그림자. 캘린더는 하루에도 여러 번
앞뒤로 넘기는 화면이라 전환을 길게 두지 않았습니다. `prefers-reduced-motion:
reduce` 에서는 이 전환을 전부 끕니다.

**5) 그 밖의 버그.**

- **겹친 모달**(일정 편집 → 채팅으로 보내기)에서 두 가지가 어긋나 있었습니다.
  Escape 를 누르면 document 리스너가 전부 반응해 **두 개가 한꺼번에** 닫혔고,
  안쪽이 닫힐 때 `body` 스크롤 잠금을 풀어 바깥 모달이 떠 있는데 뒤 배경이
  스크롤됐습니다. `components/modal.tsx` 에 모달 스택을 두어 **맨 위만** Escape 에
  반응하고, **마지막 하나가 닫힐 때만** 스크롤을 되돌립니다.

> 남겨 둔 것: 주/일 보기의 빈 시간대를 **더블클릭**해 일정을 만드는 동작은
> 데스크톱 전용입니다(터치에는 더블클릭이 없습니다). 모바일에서는 상단의
> "New event" 와 월 보기 날짜 칸의 `+` 로 만들 수 있어 막다른 길은 없습니다.
> → **v1.6.3 에서 해결했습니다.** 아래 참고.

### 전 기능 검증 (v1.6.3)

v1.6.2 에서 "남겨 둔 것" 으로 적었던 항목을 없애고, 그 김에 앱 전체를 한 번 더
훑었습니다. 검증 과정에서 **결함 두 개**가 새로 나왔고 둘 다 고쳤습니다.

**1) 터치로 일정 만들기 (남겨 둔 항목 해결).** 주/일 보기의 빈 칸을 **한 번
탭**하면 그 시각으로 새 일정이 열립니다(구글 캘린더와 같은 동작). 더블클릭을
기다릴 이유가 원래 없었습니다 — 빈 칸에는 다른 뜻의 클릭이 없기 때문입니다.

- 시간 격자: 누른 y 좌표를 **15분 단위로 내림**해 그 시각으로 엽니다.
- 종일 줄: 그 날짜의 종일 일정으로 엽니다.
- 이미 있는 일정 블록/알약을 눌렀을 때는 "새로 만들기" 가 뜨면 안 되므로
  `closest(".cal-block")` / `closest(".cal-pill")` 로 걸러냅니다.
- 월 보기는 더블클릭을 유지하되(칸 자체가 날짜 선택을 겸합니다) 알약이나 `+`
  버튼 위의 더블클릭은 무시합니다 — 그러지 않으면 "일정 열기" 와 "새 일정" 이
  **동시에** 뜹니다. 이 겹침은 v1.6.2 에도 있던 버그입니다.

**2) 같은 알림이 두 번 갈 수 있었다** (`0070_push_claim_is_idempotent.sql`).

0068 은 `chat_members.last_push_at` 을 **쓰기만 하고 조건에서 읽지 않았습니다.**
이름은 `claim_…`(가져가면 남에게 안 준다)인데 실제로는 아무것도 claim 하지
않아, 같은 메시지로 두 번 부르면 같은 사람이 두 번 나왔습니다.

평소에는 메시지당 한 번만 부르니 드러나지 않지만, 이 호출은 Next 의 `after()`
안에서 **응답을 보낸 뒤에** 돌기 때문에 재시도(콜드 스타트 타임아웃, 배포 중
인스턴스 교체)가 실제로 일어납니다. 이메일 쪽은 15분 쿨다운이 우연히 이 역할을
해 주고 있었지만, 푸시는 "메시지마다 즉시" 가 정상 동작이라 쿨다운을 둘 수
없습니다.

그래서 쿨다운이 아니라 **멱등성**으로 막았습니다. 마지막으로 청구한 메시지 id
(`last_push_message`)를 기억해 같은 메시지면 거릅니다.

> 처음엔 시각 비교(`last_push_at < 메시지의 created_at`)로 짰다가 되돌렸습니다.
> 한 트랜잭션 안에서는 `now()` 가 고정이라 "보낸 시각 == 청구 시각" 이 되어
> **뒤이은 진짜 메시지가 조용히 삼켜졌습니다.** 알림이 두 번 가는 것보다 안 가는
> 쪽이 나쁩니다. 메시지 동일성으로 판단하면 시계와 무관하게 둘 다 맞습니다.

**3) `/api/health` 가 거짓 안심을 줬다.** 마이그레이션 적용 여부를
`error.code !== "42883"` 로 판정하고 있었습니다. DB 에 **닿지도 못했을 때**의
오류는 코드가 42883 이 아니므로 `"0067_calendar_integrations": true` — 즉
"적용됨" 으로 보고했습니다. 배포가 깨졌을 때 이 화면을 보는 사람이
마이그레이션을 후보에서 지워 버리게 되는데, 이 엔드포인트가 막으려던 바로 그
오진입니다. 이제 **3값**(`true` / `false` / `"unknown"`)으로 답하고,
"함수가 없다" 는 **연결은 성공**으로 분류하며(`reachable: true` + 스키마만
뒤처짐), `ok` 는 연결과 스키마를 모두 봅니다.

#### 검증 범위와 결과

| 검사 | 결과 |
| --- | --- |
| 마이그레이션 0001~0070 을 **빈 PostgreSQL 16 에 처음부터** 재생 | 70개 전부 오류 없음 |
| 시나리오 단언 75건 — 공유 15 · 캘린더 24 · 푸시 5 · 반복 예외/알림/가져오기 18 | 전부 통과 |
| RLS 를 `authenticated` 롤로 직접 확인 13건 | 전부 통과 |
| 단위 테스트 8개 파일 | 전부 통과 |
| `npx tsc --noEmit` · `npm run build` | 경고 없이 통과 (20 라우트) |
| 프로덕션 서버 라우트 스모크 15개 | 아래 참고 |
| 앱이 부르는 **RPC 이름 69개 · 테이블 26개**가 스키마에 실제로 있는가 | 전부 존재 |
| 그 RPC 들의 **인자 이름**이 DB 시그니처와 맞는가 | 전부 일치 |

마지막 두 줄이 이번에 새로 넣은 검사입니다. `supabase.rpc("이름", { p_x: … })`
는 문자열이라 **타입 검사가 오타를 잡지 못하고**, 틀리면 런타임에 404 로만
드러납니다. 그래서 실제 스키마에서 `pg_proc` 을 읽어 호출부와 대조하고,
기본값 없는 인자를 빠뜨린 호출도 함께 봅니다.

라우트 스모크에서 확인한 것(프로덕션 빌드 + 미들웨어를 그대로 태운 상태):

- `/sw.js` → `200 application/javascript`, `/manifest.json` → `200 application/json`
  — v1.6.1 에서 고친 미들웨어 매처가 유지되고 있습니다. 이 둘이 로그인 HTML 로
  돌아오면 웹 푸시와 PWA 설치가 통째로 죽습니다.
- `/login` `/signup` → 200. **Supabase 호스트가 응답하지 않는 상태에서도** 200
  입니다(v1.6.1 의 digest 3290735100 방어가 살아 있음).
- `/dashboard` `/calendar` `/chat` `/files` `/settings` `/admin` → `307 → /login?redirect=…`
- `/api/health` → 200 JSON. 값은 싣지 않고 존재 여부만.
- `/api/calendar/feed` → 토큰이 없거나 틀리면 404(존재 여부를 흘리지 않음).

#### 검증하면서 확인한 "버그가 아닌 것"

돌려 보고 예상과 달랐지만 코드가 맞았던 것들입니다. 다음에 같은 자리에서
멈추지 않도록 적어 둡니다.

- `list_calendar_members` 는 **소유자를 빼고** 돌려줍니다. 소유자는
  `calendars.owner_id` 이지 `calendar_members` 행이 아니고, 화면도 "SHARED
  WITH" 로 같은 뜻으로 씁니다.
- `share_object_with_conversation` 의 `members` 는 **나를 뺀** 대화 상대 수입니다.
- `claim_chat_push_recipients` 가 방금 대화를 연 사람을 건너뛰는 것은 45초
  "지금 보고 있는 중" 창입니다. 보고 있는 화면에 알림을 겹쳐 띄우지 않습니다.
- `prune_push_subscription` 이 24자 미만 엔드포인트를 무시하는 것은 의도된
  가드입니다(진짜 푸시 엔드포인트는 그보다 훨씬 깁니다).
- 달력을 `viewer` 로 공유받은 사람은 `calendar_event_exceptions` 를 **읽을 수
  있어야 합니다.** 취소된 회차를 모르면 그 사람 화면에만 유령 일정이 남습니다.

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
