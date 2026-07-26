import { createClient } from "@/lib/supabase/server";
import {
  htmlToText,
  isInlineDoc,
  isInlineImage,
  safeHttpUrl,
  MAX_ATTACHMENT_BYTES,
  MAX_LINK_CHARS,
  type BbAttachment,
  type ResolvedPart,
} from "@/lib/bb-attachments";

// 첨부를 모델에 넣을 수 있는 조각으로 바꾼다. 저장소 접근이 필요하므로 서버 전용.

const BUCKET = "files";
/** 링크를 가져올 때 기다릴 최대 시간 — 느린 사이트가 요청 전체를 잡으면 안 된다. */
const LINK_TIMEOUT_MS = 8000;

export async function resolveAttachments(
  attachments: BbAttachment[]
): Promise<ResolvedPart[]> {
  if (!attachments.length) return [];
  const supabase = await createClient();
  const out: ResolvedPart[] = [];

  for (const a of attachments.slice(0, 10)) {
    if (a.kind === "link") {
      out.push(await resolveLink(a));
      continue;
    }

    if (!a.path) {
      out.push({ type: "text", text: `[attachment ${a.name}: missing storage path]` });
      continue;
    }

    // RLS 가 남의 파일을 막는다 — 다운로드가 실패하면 그대로 알린다.
    const { data, error } = await supabase.storage.from(BUCKET).download(a.path);
    if (error || !data) {
      out.push({ type: "text", text: `[attachment ${a.name}: could not be read]` });
      continue;
    }
    const buf = Buffer.from(await data.arrayBuffer());
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) {
      out.push({
        type: "text",
        text: `[attachment ${a.name}: ${(buf.byteLength / 1_000_000).toFixed(1)} MB, too large to send]`,
      });
      continue;
    }

    const mime = a.mime || data.type || "application/octet-stream";
    if (isInlineImage(mime) || isInlineDoc(mime)) {
      // 이미지·PDF 는 모델이 원본으로 읽는다 — 텍스트로 바꾸면 표와 도표가 사라진다.
      out.push({ type: "media", mime, base64: buf.toString("base64"), name: a.name });
    } else {
      // 그 외에는 UTF-8 로 읽어 본다. 바이너리면 알아볼 수 없는 문자가 나오므로
      // 치환 문자가 많으면 텍스트가 아니라고 보고 이름만 알린다.
      const text = buf.toString("utf-8");
      const replacementRatio =
        (text.match(/�/g)?.length ?? 0) / Math.max(text.length, 1);
      if (replacementRatio > 0.01) {
        out.push({
          type: "text",
          text: `[attachment ${a.name} (${mime}): binary, not readable as text]`,
        });
      } else {
        out.push({
          type: "text",
          text: `--- attachment: ${a.name} ---\n${text.slice(0, MAX_LINK_CHARS)}`,
        });
      }
    }
  }
  return out;
}

async function resolveLink(a: BbAttachment): Promise<ResolvedPart> {
  const url = safeHttpUrl(a.url ?? "");
  if (!url) return { type: "text", text: `[link ${a.url}: not a valid http(s) URL]` };
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "PossionBigBrother/1.0" },
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { type: "text", text: `[link ${url.href}: HTTP ${res.status}]` };
    }
    const type = res.headers.get("content-type") ?? "";
    const body = await res.text();
    const text = /html/i.test(type) ? htmlToText(body) : body;
    return {
      type: "text",
      text: `--- link: ${url.href} ---\n${text.slice(0, MAX_LINK_CHARS)}`,
    };
  } catch (e) {
    const why = e instanceof Error && e.name === "TimeoutError" ? "timed out" : "could not be fetched";
    return { type: "text", text: `[link ${url.href}: ${why}]` };
  }
}
