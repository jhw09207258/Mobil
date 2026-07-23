"use client";

/** 프로필 사진이 있으면 원형 이미지, 없으면 이니셜 — 전 화면 공용. */
export function UserAvatar({
  url,
  name,
  size = 34,
  className = "",
}: {
  url?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        className={`chat-conv-avatar ${className}`}
        style={{ width: size, height: size, objectFit: "cover" }}
      />
    );
  }
  return (
    <span
      className={`chat-conv-avatar ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {(name || "?").charAt(0).toUpperCase()}
    </span>
  );
}
