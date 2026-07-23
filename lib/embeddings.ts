import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

// ============================================================================
// 시맨틱 검색용 임베딩 파이프라인 (서버 전용).
// NVIDIA NIM 임베딩 API(nv-embedqa-e5-v5, 1024차원)를 Sophia 와 같은 키로
// 호출한다. 모든 실패는 조용히 삼킨다(콘솔 로그만) — 임베딩은 부가 기능이라
// 저장/검색의 본 흐름을 절대 막으면 안 되고, 키 미설정/NVIDIA 장애 시에는
// 어휘(tsvector) 검색만으로 동작한다.
// ============================================================================

const EMBED_URL = "https://integrate.api.nvidia.com/v1/embeddings";
const EMBED_MODEL = "nvidia/nv-embedqa-e5-v5";
// 임베딩 모델 입력 한도 대비 안전한 절단 길이. 초과분은 검색 품질에 기여하지
// 못한 채 잘리므로 앞부분(제목+도입부)을 우선한다.
const MAX_INPUT_CHARS = 2000;
const TIMEOUT_MS = 8000;

function getOrderedKeys(): string[] {
  return [process.env.NVIDIA_API_KEY_2, process.env.NVIDIA_API_KEY].filter(
    (k): k is string => !!k
  );
}

/** 텍스트 → 1024차원 임베딩. 실패 시 null (호출부는 조용히 건너뛴다). */
export async function embedText(
  text: string,
  inputType: "query" | "passage"
): Promise<number[] | null> {
  const input = text.trim().slice(0, MAX_INPUT_CHARS);
  if (!input) return null;

  for (const key of getOrderedKeys()) {
    try {
      const res = await fetch(EMBED_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EMBED_MODEL,
          input: [input],
          input_type: inputType,
          encoding_format: "float",
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error("[embeddings] NVIDIA error", res.status, (await res.text().catch(() => "")).slice(0, 200));
        continue; // 다음 키로
      }
      const json: { data?: { embedding?: number[] }[] } = await res.json();
      const embedding = json?.data?.[0]?.embedding;
      if (Array.isArray(embedding) && embedding.length > 0) return embedding;
    } catch (e) {
      console.error("[embeddings] request failed", e instanceof Error ? e.message : e);
    }
  }
  return null;
}

/** pgvector 텍스트 표기('[0.1,0.2,...]') — RPC 인자로 넘길 때 사용. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/** 시트 celldata 에서 값이 있는 셀 텍스트를 이어붙인다(임베딩 입력용). */
export function extractSheetPlainText(data: Json): string {
  if (!Array.isArray(data)) return "";
  const parts: string[] = [];
  for (const sheet of data) {
    const celldata = (sheet as { celldata?: unknown[] } | null)?.celldata;
    if (!Array.isArray(celldata)) continue;
    for (const cell of celldata) {
      const v = (cell as { v?: { v?: unknown; m?: unknown } | null } | null)?.v;
      const val = v ? (v.m ?? v.v) : null;
      if (val != null && val !== "") parts.push(String(val));
      if (parts.length > 500) return parts.join(" ");
    }
  }
  return parts.join(" ");
}

/**
 * 저장 액션의 after() 블록에서 호출 — 내용 해시가 바뀐 경우에만 임베딩을
 * 재계산해 upsert 한다(자동저장마다 API 를 두드리지 않도록).
 */
export async function syncObjectEmbedding(
  supabase: SupabaseClient<Database>,
  kind: "document" | "code" | "sheet" | "mindmap",
  id: string,
  title: string,
  text: string
): Promise<void> {
  try {
    const content = `${title}\n${text}`.trim().slice(0, MAX_INPUT_CHARS);
    if (!content) return;
    const hash = createHash("sha256").update(content).digest("hex");

    const { data: stale } = await supabase.rpc("object_embedding_stale", {
      p_kind: kind,
      p_id: id,
      p_hash: hash,
    });
    if (!stale) return;

    const embedding = await embedText(content, "passage");
    if (!embedding) return;

    await supabase.rpc("upsert_object_embedding", {
      p_kind: kind,
      p_id: id,
      p_hash: hash,
      p_embedding: toVectorLiteral(embedding),
    });
  } catch (e) {
    console.error("[embeddings] sync failed", kind, id, e instanceof Error ? e.message : e);
  }
}
