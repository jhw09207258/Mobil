import "./tooltip.css";

/**
 * 호버/포커스 툴팁 — unlumen-ui 의 FloatingTooltip 틀(트리거를 감싸는 방식)을
 * 가져오되, 위치 계산 라이브러리(floating-ui 등) 없이 CSS 만으로 구현했다.
 * 아이콘 전용 버튼처럼 라벨이 화면에 안 보이는 곳에 적용한다 — 네이티브
 * `title` 은 브라우저마다 뜨는 속도/모양이 달라 통일감이 없다.
 */
export function Tooltip({
  content,
  children,
  side = "bottom",
}: {
  content: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <span className={`tt tt-${side}`}>
      {children}
      <span className="tt-bubble" role="tooltip">
        {content}
      </span>
    </span>
  );
}
