// Big Brother 어시스턴트가 고를 수 있는 모델 전체.
//
// 이 파일은 클라이언트에서도 import 하므로 SDK 를 끌어오지 않는다(문자열만).
// 실제 호출은 provider 에 따라 lib/big-brother-gemini.ts / -claude.ts 가 맡는다.

export type BbProvider = "gemini" | "claude";

export type BbModel = {
  id: string;
  provider: BbProvider;
  label: string;
  /** 화면에서 묶어 보여줄 그룹명. */
  group: string;
};

export const BIG_BROTHER_MODELS: readonly BbModel[] = [
  {
    id: "gemini-3.5-flash",
    provider: "gemini",
    group: "Gemini",
    label: "3.5 Flash — fast, cheap (default)",
  },
  { id: "gemini-3.6-flash", provider: "gemini", group: "Gemini", label: "3.6 Flash — newer, still fast" },
  {
    id: "gemini-3.1-pro-preview",
    provider: "gemini",
    group: "Gemini",
    label: "3.1 Pro — deep reasoning, costly",
  },
  { id: "claude-opus-5", provider: "claude", group: "Claude", label: "Opus 5 — deepest reasoning" },
  { id: "claude-sonnet-5", provider: "claude", group: "Claude", label: "Sonnet 5 — balanced" },
  { id: "claude-haiku-4-5", provider: "claude", group: "Claude", label: "Haiku 4.5 — fastest" },
] as const;

export const DEFAULT_BB_MODEL = BIG_BROTHER_MODELS[0].id;

export function bbModel(id: string | undefined): BbModel | null {
  return BIG_BROTHER_MODELS.find((m) => m.id === id) ?? null;
}

/** 화면에서 provider 별로 묶기 위한 그룹 목록. */
export function bbModelGroups(): { group: string; models: BbModel[] }[] {
  const out: { group: string; models: BbModel[] }[] = [];
  for (const m of BIG_BROTHER_MODELS) {
    const hit = out.find((g) => g.group === m.group);
    if (hit) hit.models.push(m);
    else out.push({ group: m.group, models: [m] });
  }
  return out;
}
