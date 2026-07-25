/**
 * 코드 에이전트의 부분 치환 — old_string 이 파일에 정확히 한 번만 나타날 때만
 * 적용한다. 여러 번 나타나는데 첫 번째만 바꾸면 모델이 의도한 위치가 아닐 수
 * 있어 조용히 엉뚱한 곳을 고치게 되므로, 애매하면 실패시키고 모델에게 더 넓은
 * 문맥을 달라고 되돌려준다.
 */
export type EditResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

export function replaceInFile(
  content: string,
  oldStr: string,
  newStr: string
): EditResult {
  if (!oldStr) return { ok: false, error: "old_string was empty." };
  const first = content.indexOf(oldStr);
  if (first === -1) {
    return {
      ok: false,
      error:
        "old_string was not found in the file. Match it exactly, including whitespace.",
    };
  }
  if (content.indexOf(oldStr, first + oldStr.length) !== -1) {
    return {
      ok: false,
      error:
        "old_string appears more than once. Include more surrounding context so it is unique.",
    };
  }
  return {
    ok: true,
    content: content.slice(0, first) + newStr + content.slice(first + oldStr.length),
  };
}
