// ============================================================================
// Apple Pages(.pages) → 텍스트 추출 (베스트 에포트).
// ----------------------------------------------------------------------------
// .pages 는 ZIP 번들이다. 두 세대를 지원한다:
//   1) Pages '09 이하: index.xml(.gz 아님) 에 본문이 XML 로 들어 있다.
//   2) 현행(2013+, IWA): Index/*.iwa — 자체 프레이밍(청크당 [type:1][len:3LE])
//      안에 raw Snappy 로 압축된 protobuf 스트림. 공식 스키마 없이도 텍스트는
//      length-delimited UTF-8 필드로 들어 있으므로, Snappy 를 풀고 유효한
//      UTF-8 문자열 필드를 휴리스틱으로 골라낸다(문서 본문 위주로 남도록
//      폰트명/로케일/식별자 패턴은 걸러낸다). 완전한 서식 보존은 범위 밖 —
//      본문 텍스트 가져오기가 목적이다.
// ============================================================================

/** raw Snappy 블록 해제(프레이밍 없는 표준 포맷). 손상 시 null. */
export function snappyDecompress(input: Uint8Array): Uint8Array | null {
  try {
    let pos = 0;
    // uncompressed length varint
    let outLen = 0;
    let shift = 0;
    for (;;) {
      const b = input[pos++];
      outLen |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 32 || pos >= input.length) return null;
    }
    if (outLen < 0 || outLen > 64 * 1024 * 1024) return null;
    const out = new Uint8Array(outLen);
    let op = 0;

    while (pos < input.length && op < outLen) {
      const tag = input[pos++];
      const type = tag & 3;
      if (type === 0) {
        // literal
        let len = (tag >> 2) + 1;
        if (len > 60) {
          const extra = len - 60;
          len = 0;
          for (let i = 0; i < extra; i++) len |= input[pos++] << (8 * i);
          len += 1;
        }
        out.set(input.subarray(pos, pos + len), op);
        pos += len;
        op += len;
      } else {
        let len: number;
        let offset: number;
        if (type === 1) {
          len = ((tag >> 2) & 0x7) + 4;
          offset = ((tag & 0xe0) << 3) | input[pos++];
        } else if (type === 2) {
          len = (tag >> 2) + 1;
          offset = input[pos] | (input[pos + 1] << 8);
          pos += 2;
        } else {
          len = (tag >> 2) + 1;
          offset =
            input[pos] | (input[pos + 1] << 8) | (input[pos + 2] << 16) | (input[pos + 3] << 24);
          pos += 4;
        }
        if (offset <= 0 || offset > op) return null;
        // 겹치는 복사(런 렝스) 지원 — 바이트 단위로 복사해야 한다.
        for (let i = 0; i < len; i++) {
          out[op] = out[op - offset];
          op++;
        }
      }
    }
    return op === outLen ? out : out.subarray(0, op);
  } catch {
    return null;
  }
}

/** IWA 파일(스냅피 청크 프레이밍) 전체 해제. */
export function decompressIwa(bytes: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [];
  let pos = 0;
  while (pos + 4 <= bytes.length) {
    const type = bytes[pos];
    const len = bytes[pos + 1] | (bytes[pos + 2] << 8) | (bytes[pos + 3] << 16);
    pos += 4;
    if (pos + len > bytes.length) break;
    const chunk = bytes.subarray(pos, pos + len);
    pos += len;
    if (type !== 0) continue; // 알 수 없는 청크 타입은 건너뜀
    const out = snappyDecompress(chunk);
    if (out) parts.push(out);
  }
  if (parts.length === 0) return null;
  const total = parts.reduce((s, p) => s + p.length, 0);
  const joined = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    joined.set(p, off);
    off += p.length;
  }
  return joined;
}

const NOISE_RE =
  /^(?:[a-z]{2}([-_][A-Z]{2})?|\d+(\.\d+)?|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z]+(-(Bold|Italic|Light|Regular|Medium|Semibold|Black|Thin|Oblique))+|(Helvetica|Arial|Times|Courier|Georgia|Verdana|Menlo|Monaco|SFPro|SF Pro|PingFang|Hiragino|Noto|Apple)[\w -]*|com\.apple[\w.]*|TS[A-Z]\w+|\.?[A-Za-z]+\.(?:pdf|jpg|jpeg|png|gif|tiff|mov|mp4))$/;

function isProbablyBodyText(s: string): boolean {
  if (s.length < 2) return false;
  if (NOISE_RE.test(s.trim())) return false;
  // 제어문자 비율이 높으면 바이너리 오검출
  let printable = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 32 || c === 10 || c === 9) printable++;
  }
  if (printable / s.length < 0.97) return false;
  // 공백/CJK·한글 포함, 혹은 충분히 긴 단어면 본문으로 간주
  return /\s/.test(s) || /[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿]/.test(s) || s.length >= 12;
}

/** 해제된 protobuf 바이트에서 length-delimited UTF-8 문자열 필드를 긁어낸다. */
export function extractUtf8Strings(buf: Uint8Array): string[] {
  const out: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pos = 0;
  while (pos < buf.length - 2) {
    const key = buf[pos];
    // wire type 2 (length-delimited)
    if ((key & 0x07) === 2) {
      let p = pos + 1;
      let len = 0;
      let shift = 0;
      let ok = true;
      for (;;) {
        if (p >= buf.length) {
          ok = false;
          break;
        }
        const b = buf[p++];
        len |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
        if (shift > 28) {
          ok = false;
          break;
        }
      }
      if (ok && len >= 2 && len <= 20000 && p + len <= buf.length) {
        try {
          const s = decoder.decode(buf.subarray(p, p + len));
          if (isProbablyBodyText(s)) {
            out.push(s);
            pos = p + len;
            continue;
          }
        } catch {
          /* UTF-8 아님 — 그냥 지나감 */
        }
      }
    }
    pos++;
  }
  return out;
}

/** Pages '09 index.xml 에서 본문 문단 텍스트 추출(단순 태그 제거). */
function extractFromIndexXml(xml: string): string {
  const paragraphs: string[] = [];
  // <sf:p ...>...</sf:p> 문단 단위로 텍스트만
  const pRe = /<sf:p\b[^>]*>([\s\S]*?)<\/sf:p>/g;
  for (const m of xml.matchAll(pRe)) {
    const text = m[1]
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs.join("\n\n");
}

/** .pages 번들 → 본문 텍스트. 실패 시 명확한 안내 에러를 던진다. */
export async function extractPagesText(bytes: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("Not a valid .pages file (could not open the bundle).");
  }

  // 1) 구형(Pages '09)
  const indexXml = zip.file(/(^|\/)index\.xml$/i)[0];
  if (indexXml) {
    const xml = await indexXml.async("string");
    const text = extractFromIndexXml(xml);
    if (text.trim()) return text;
  }

  // 2) 현행(IWA) — Index.zip 안에 들어 있는 경우도 있다.
  let iwaFiles = zip.file(/\.iwa$/i);
  if (iwaFiles.length === 0) {
    const nested = zip.file(/(^|\/)Index\.zip$/i)[0];
    if (nested) {
      const inner = await JSZip.loadAsync(await nested.async("uint8array"));
      iwaFiles = inner.file(/\.iwa$/i);
    }
  }
  if (iwaFiles.length > 0) {
    // Document.iwa 를 앞에 — 본문이 주로 여기 있다.
    iwaFiles.sort((a, b) => Number(b.name.includes("Document")) - Number(a.name.includes("Document")));
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const f of iwaFiles) {
      const raw = await f.async("uint8array");
      const decompressed = decompressIwa(raw);
      if (!decompressed) continue;
      for (const s of extractUtf8Strings(decompressed)) {
        const key = s.trim();
        if (!seen.has(key)) {
          seen.add(key);
          parts.push(key);
        }
      }
    }
    const text = parts.join("\n\n").trim();
    if (text) return text;
  }

  throw new Error(
    "Could not extract text from this .pages file — in Pages, use File → Export To → Word (.docx) and import that instead."
  );
}
