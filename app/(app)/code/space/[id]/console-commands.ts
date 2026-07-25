// 터미널 입력 한 줄을 무엇을 할지로 바꾼다. 슬래시로 시작하지 않으면 전부
// 에이전트에게 보내는 프롬프트다.
//
// 모델 목록을 import 하지 않고 인자로 받는 이유: 의존성이 없어야 node 로 그냥
// 실행해 테스트할 수 있다(tsconfig 의 "@/" 별칭을 node 가 못 푼다). 목록의
// 출처는 lib/antigravity.ts 하나이고, 호출부가 그걸 넘긴다.

export type Command =
  | { type: "send"; text: string }
  | { type: "help" }
  | { type: "files" }
  | { type: "clear" }
  | { type: "reset" }
  | { type: "usage" }
  | { type: "model"; value?: string }
  | { type: "open"; path: string }
  | { type: "github" }
  | { type: "deploy" }
  | { type: "error"; message: string };

export function commandHelp(models: readonly string[]): [string, string][] {
  return [
    ["/help", "Show this list"],
    ["/files", "List every file in this Code Space"],
    ["/open <path>", "Open a file in the editor"],
    ["/model [name]", `Show or switch the reasoning model (${models.join(", ")})`],
    ["/usage", "Token usage and cost for this session"],
    ["/clear", "Clear the console (keeps the agent session)"],
    ["/reset", "Start a fresh agent session and remount the files"],
    ["/github", "Push this Code Space to GitHub"],
    ["/deploy", "Deploy this Code Space to Vercel"],
  ];
}

export function parseCommand(raw: string, models: readonly string[]): Command | null {
  const line = raw.trim();
  if (!line) return null;
  if (!line.startsWith("/")) return { type: "send", text: line };

  const [word, ...rest] = line.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  const name = word.toLowerCase();

  switch (name) {
    case "help":
    case "?":
      return { type: "help" };
    case "files":
    case "ls":
      return { type: "files" };
    case "clear":
    case "cls":
      return { type: "clear" };
    case "reset":
      return { type: "reset" };
    case "usage":
    case "tokens":
      return { type: "usage" };
    case "model":
      if (!arg) return { type: "model" };
      if (!models.includes(arg)) {
        return {
          type: "error",
          message: `Unknown model "${arg}". Available: ${models.join(", ")}`,
        };
      }
      return { type: "model", value: arg };
    case "open":
      if (!arg) return { type: "error", message: "Usage: /open <path>" };
      return { type: "open", path: arg };
    case "github":
    case "push":
      return { type: "github" };
    case "deploy":
    case "vercel":
      return { type: "deploy" };
    default:
      return {
        type: "error",
        message: `Unknown command "/${word}". Type /help for the list.`,
      };
  }
}

/**
 * Antigravity 는 사용한 토큰만 청구하고 preview 동안 컴퓨트는 무료다.
 * flash 계열 기준의 대략적인 추정치 — 정확한 청구액은 AI Studio 에서 봐야 한다.
 */
export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * 0.3 + (outputTokens / 1_000_000) * 2.5;
}
