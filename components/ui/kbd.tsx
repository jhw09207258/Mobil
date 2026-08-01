import "./kbd.css";

/**
 * 키캡 하나. unlumen-ui 의 Kbd/Shortcut 틀(개별 키를 카드처럼 도드라지게)을
 * 가져오되, Possion 자체 토큰(--bg-3/--border-1/--radius)으로 다시 그렸다.
 */
export function Kbd({
  children,
  size = "md",
}: {
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  return <kbd className={`kbd kbd-${size}`}>{children}</kbd>;
}

/** 키 조합 — 예: ["⌘", "K"] → 키캡 두 개를 붙여 그린다. */
export function Shortcut({
  keys,
  size = "md",
}: {
  keys: string[];
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className="shortcut">
      {keys.map((k, i) => (
        <Kbd key={i} size={size}>
          {k}
        </Kbd>
      ))}
    </span>
  );
}
