# Supabase 연결 정보

Possion 전용 Supabase 프로젝트가 생성되고 마이그레이션 0001–0007 이 모두 적용되었습니다.

| 항목 | 값 |
| --- | --- |
| 프로젝트 이름 | `Possion` |
| 프로젝트 Ref | `qsdplbzhpzidkjmxmqug` |
| 리전 | `ap-northeast-2` (Seoul) |
| API URL | `https://qsdplbzhpzidkjmxmqug.supabase.co` |
| Publishable Key | `sb_publishable_-0zOSkG_hyL9VDS71rB00A_YKtwowg4` |

> Publishable(구 anon) 키는 브라우저에 노출되도록 설계된 공개 키입니다. RLS 로
> 보호되므로 클라이언트에 포함되어도 안전합니다. 절대 노출하면 안 되는 것은
> **service_role** 키이며, 이 앱은 service_role 키를 사용하지 않습니다.

## 로컬 개발

프로젝트 루트에 `.env.local` 을 만들고 아래 값을 넣습니다(이미 생성되어 있으면 생략):

```
NEXT_PUBLIC_SUPABASE_URL=https://qsdplbzhpzidkjmxmqug.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_-0zOSkG_hyL9VDS71rB00A_YKtwowg4
```

```bash
npm run dev   # http://localhost:3000
```

## Vercel 배포 환경 변수

Project → Settings → Environment Variables 에 등록:

- `NEXT_PUBLIC_SUPABASE_URL` = `https://qsdplbzhpzidkjmxmqug.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `sb_publishable_-0zOSkG_hyL9VDS71rB00A_YKtwowg4`

배포 후 Supabase 대시보드 → Authentication → URL Configuration 에서:
- **Site URL** 에 배포 도메인 등록
- **Redirect URLs** 에 `https://<배포도메인>/auth/callback` 추가

## 최초 관리자 부트스트랩

Supabase 대시보드 → SQL Editor 에서 **1회만** 실행(평문 코드는 원하는 값으로 교체):

```sql
insert into public.admin_codes (code_hash, expires_at)
values (encode(extensions.digest('CHANGE-ME-BOOTSTRAP-CODE', 'sha256'), 'hex'), null);
```

이후 앱에서 회원가입 → 로그인 → `/admin/redeem` 에서 위 평문 코드 입력 → 관리자 승격.
관리자 콘솔(`/admin`)에서 추가 코드를 발급할 수 있습니다.

## 이메일 확인 설정 (선택)

기본값은 **이메일 확인 필요(ON)** 입니다. 이 경우 가입 후 확인 메일의 링크를 눌러야
로그인할 수 있으며, 커스텀 SMTP 설정을 권장합니다(기본 내장 메일은 발송 한도가 낮음).
소규모 비공개 사용이라 즉시 로그인을 원하면 Authentication → Providers → Email 에서
"Confirm email" 을 끌 수 있습니다(보안 트레이드오프 존재).

## 적용된 마이그레이션

`0001_init` · `0002_storage` · `0003_profile_trigger` · `0004_code_files` ·
`0005_harden_function_grants` · `0006_fix_pgcrypto_search_path` ·
`0007_fix_role_change_guard`
