/** 유저 id를 해시해 결정적인 HSL color 를 반환한다 — 같은 사용자는 매 세션
 * 항상 같은 색으로 보여야 프레즌스 아바타를 색으로 구분하는 의미가 있다. */
export function colorForUserId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}
