import "./glowing-badge.css";

export type GlowingBadgeVariant =
  | "default"
  | "neutral"
  | "success"
  | "warning"
  | "error"
  | "info";

/** 상태 배지 — 점(dot)이 은은하게 번지며(glow) 실시간/살아있음을 알린다. */
export function GlowingBadge({
  variant = "default",
  pulse = true,
  dot = true,
  children,
}: {
  variant?: GlowingBadgeVariant;
  pulse?: boolean;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`glow-badge glow-badge-${variant}`}>
      {dot && <span className={`glow-badge-dot ${pulse ? "pulse" : ""}`} aria-hidden="true" />}
      {children}
    </span>
  );
}
