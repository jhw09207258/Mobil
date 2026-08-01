import "./shimmering-text.css";

/**
 * 옅은 텍스트 위로 밝은 띠가 스쳐 지나가며 "진행 중" 을 알리는 가벼운 로딩
 * 텍스트. 한 줄짜리 "Loading…" 같은 짧은 대기 문구를 조금 덜 밋밋하게
 * 보여주는 용도다 — CSS 그라디언트만 쓰고 motion 의존성은 없다.
 */
export function ShimmeringText({
  text,
  className = "",
  style,
}: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span className={`shimmer-text ${className}`} style={style}>
      {text}
    </span>
  );
}
