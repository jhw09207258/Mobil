// ============================================================================
// Big Brother 첨부 — 어시스턴트에게 보내는 이미지·문서·링크·워크스페이스 파일.
//
// 이미지와 PDF 는 Gemini 와 Claude 가 모두 원본 그대로 읽는다. 그래서 텍스트로
// 변환하지 않고 바이트를 그대로 넘긴다 — 변환하면 표·도표·레이아웃이 사라진다.
// 링크는 서버에서 받아 본문만 추려 넣는다(모델이 임의의 URL 을 직접 가져오게
// 두지 않는다 — 어디로 나가는지 통제할 수 없다).
// ============================================================================

export type BbAttachment = {
  kind: "image" | "document" | "link" | "workspace_file";
  name: string;
  /** storage 경로(image/document/workspace_file). */
  path?: string;
  /** kind === "link". */
  url?: string;
  mime?: string;
};

/** 모델에 직접 넣을 수 있는 형식. 그 외에는 텍스트로 뽑아 넣는다. */
export const INLINE_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
export const INLINE_DOC_MIME = ["application/pdf"];

export function isInlineImage(mime?: string | null): boolean {
  return !!mime && INLINE_IMAGE_MIME.includes(mime);
}
export function isInlineDoc(mime?: string | null): boolean {
  return !!mime && INLINE_DOC_MIME.includes(mime);
}

/** 첨부 하나가 모델로 갈 수 있는 최대 크기. 넘으면 이름만 알린다. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
/** 링크에서 가져올 본문 길이 상한. */
export const MAX_LINK_CHARS = 20_000;

export type ResolvedPart =
  | { type: "text"; text: string }
  | { type: "media"; mime: string; base64: string; name: string };

/**
 * HTML 에서 사람이 읽을 본문만 남긴다. 완벽한 파서가 목적이 아니라, 모델에게
 * 넘길 만큼만 추리는 것이 목적이다 — script/style 을 지우고 태그를 벗긴다.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** http/https 만 허용한다 — file:, data:, 내부망 스킴이 새어나가면 안 된다. */
export function safeHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}
