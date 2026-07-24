"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setAvatarUrl, removeAvatar } from "./actions";

const BUCKET = "avatars";
const MAX_BYTES = 5 * 1024 * 1024;

export function AvatarUpload({
  userId,
  initialUrl,
  initial,
}: {
  userId: string;
  initialUrl: string | null;
  initial: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(initialUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = () => inputRef.current?.click();

  const onRemove = async () => {
    if (!url || uploading) return;
    setError(null);
    setUploading(true);
    try {
      const res = await removeAvatar();
      if ("error" in res) throw new Error(res.error);
      setUrl(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove photo.");
    } finally {
      setUploading(false);
    }
  };

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image is too large (max 5 MB).");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${userId}/avatar.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: true });
      // 실제 스토리지 오류 메시지를 그대로 보여준다(RLS 거부 등 원인 파악용).
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      const {
        data: { publicUrl },
      } = supabase.storage.from(BUCKET).getPublicUrl(path);
      // 캐시 무효화용 쿼리스트링(같은 경로에 upsert 하면 public URL 이 그대로라
      // 브라우저 캐시가 예전 이미지를 계속 보여줄 수 있다).
      const bustedUrl = `${publicUrl}?v=${Date.now()}`;

      const res = await setAvatarUrl(bustedUrl);
      if ("error" in res) throw new Error(res.error);

      setUrl(bustedUrl);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="row" style={{ gap: 14, alignItems: "center", marginBottom: 18 }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Profile avatar"
          width={64}
          height={64}
          style={{ borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border-1)" }}
        />
      ) : (
        <div
          className="avatar"
          style={{ width: 64, height: 64, fontSize: 22 }}
        >
          {initial}
        </div>
      )}
      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onChange}
        />
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onPick} disabled={uploading}>
            {uploading ? "Working…" : url ? "Change photo" : "Upload photo"}
          </button>
          {url && (
            <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={onRemove} disabled={uploading}>
              Remove
            </button>
          )}
        </div>
        {error && <div className="notice notice-error" style={{ marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}
