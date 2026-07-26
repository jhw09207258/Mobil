// 간결한 라인 아이콘 (currentColor, 18px). 사이드바/헤더 공용.
type P = { size?: number };
const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export function IconDashboard({ size }: P) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}
export function IconFiles({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M4 4h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    </svg>
  );
}
export function IconDocuments({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4" />
      <path d="M8 12h8M8 16h6" />
    </svg>
  );
}
export function IconCode({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" />
    </svg>
  );
}
export function IconSheet({ size }: P) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="3" width="18" height="18" rx="1.5" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  );
}
export function IconMindmap({ size }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="5" r="2.4" />
      <circle cx="5" cy="18" r="2.4" />
      <circle cx="19" cy="18" r="2.4" />
      <path d="M12 7.4v3.6M12 11l-5.5 4.5M12 11l5.5 4.5" />
    </svg>
  );
}
export function IconCoworkers({ size }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="7" r="2.4" />
      <path d="M15.5 14.2c2.4.5 4.1 2.6 4.5 5.3" />
    </svg>
  );
}
export function IconKey({ size }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="8" cy="8" r="4" />
      <path d="M11 11l8 8M16 16l2-2M18 18l2-2" />
    </svg>
  );
}
export function IconConsole({ size }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </svg>
  );
}
export function IconSettings({ size }: P) {
  return <IconConsole size={size} />;
}
export function IconSignOut({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
      <path d="M10 12H3M6 8l-3 4 3 4" />
    </svg>
  );
}
export function IconMenu({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
export function IconEye({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}
export function IconChat({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
      <path d="M8 10h8M8 13h5" />
    </svg>
  );
}
export function IconPlus({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
export function IconClip({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M21 12.5l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8L13 4.9a3.7 3.7 0 0 1 5.2 5.2l-8.2 8.2a1.8 1.8 0 0 1-2.6-2.6l7.6-7.6" />
    </svg>
  );
}
export function IconSmile({ size }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5c.9 1.2 2.1 1.9 3.5 1.9s2.6-.7 3.5-1.9" />
      <path d="M9 9.5h.01M15 9.5h.01" strokeWidth={2.4} />
    </svg>
  );
}
export function IconImage({ size }: P) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <circle cx="8.5" cy="9.5" r="1.8" />
      <path d="M3 17l5.5-5 4 3.5L17 11l4 4" />
    </svg>
  );
}
export function IconLink({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M10 14a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.7 1.7" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.7-1.7" />
    </svg>
  );
}
export function IconSend({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}
export function IconSearch({ size }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
export function IconTrash({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/* 메시지 액션 등 — 예전에는 ↩ ☺ ✎ 🗑 같은 날글자를 썼는데, 흑백 레거시 글리프와
   컬러 이모지가 섞여 플랫폼마다 크기·색·정렬이 제각각이었다. 나머지 아이콘과
   같은 선 굵기·색으로 통일한다. */
export function IconReply({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M9 10L4.5 14.5 9 19" />
      <path d="M4.5 14.5H14a5.5 5.5 0 0 0 5.5-5.5V5" />
    </svg>
  );
}
export function IconEdit({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M4 20h4l10-10-4-4L4 16v4Z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}
export function IconClose({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
export function IconMore({ size }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
export function IconRefresh({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M20 11a8 8 0 1 0-.6 4" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}
export function IconChevronRight({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </svg>
  );
}
export function IconChevronDown({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M5.5 9.5L12 16l6.5-6.5" />
    </svg>
  );
}
export function IconUndo({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M4 9h11a5 5 0 0 1 0 10h-6" />
      <path d="M8 5L4 9l4 4" />
    </svg>
  );
}
