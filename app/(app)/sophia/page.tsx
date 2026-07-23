import { redirect } from "next/navigation";

// Sophia 는 Big Brother 로 통합되었다 — 대화 UI·기록(ai_conversations)은
// 그대로 유지되고 /big-brother 의 Assistant 탭에서 이어진다.
export default function SophiaPage() {
  redirect("/big-brother");
}
