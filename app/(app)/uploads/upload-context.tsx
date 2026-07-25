"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { extractTagsFromText } from "@/lib/tags";
import { formatBytes } from "@/lib/format";

// ============================================================================
// 파일 업로드 매니저 — (app) 레이아웃에 마운트되므로 앱 안에서 화면을 옮겨
// 다녀도 업로드가 끊기지 않는다(레이아웃은 페이지 이동으로 리마운트되지
// 않는다). 진행률은 XMLHttpRequest 의 upload.onprogress 로 실제 전송 바이트를
// 읽는다 — supabase-js 의 storage.upload() 는 내부적으로 fetch 를 쓰는데
// fetch 에는 업로드 진행 이벤트가 없어서 "몇 % 올라갔는지"를 알 수 없다.
// 그래서 storage-js 가 만드는 것과 동일한 요청(FormData: cacheControl + 파일)을
// XHR 로 직접 보낸다.
// ============================================================================

const BUCKET = "files";

export type UploadStatus = "uploading" | "done" | "error";

export type UploadJob = {
  id: string;
  name: string;
  size: number;
  loaded: number;
  status: UploadStatus;
  error?: string;
};

type StartOptions = {
  /** 업로드 시작 시점의 저장소 — 이동 중에 화면이 바뀌어도 그대로 적용된다. */
  repositoryId: string | null;
};

type UploadCtx = {
  jobs: UploadJob[];
  /** 업로드가 하나라도 끝날 때마다 증가 — 목록 새로고침 트리거용. */
  completedTick: number;
  uploading: boolean;
  startUploads: (files: File[], opts: StartOptions) => void;
  dismiss: (id: string) => void;
  dismissFinished: () => void;
};

const Ctx = createContext<UploadCtx | null>(null);

/** storage-js 와 동일한 업로드 요청을 XHR 로 보내 진행률을 얻는다. */
function xhrUpload(args: {
  url: string;
  token: string;
  apikey: string;
  file: File;
  onProgress: (loaded: number) => void;
}): Promise<void> {
  const { url, token, apikey, file, onProgress } = args;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", apikey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));

    // storage-js 가 Blob 을 올릴 때 만드는 본문과 같은 형태 — 필드명이 빈
    // 문자열인 것까지 동일해야 서버가 파일로 인식한다.
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);
    xhr.send(form);
  });
}

export function UploadProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string;
}) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [completedTick, setCompletedTick] = useState(0);
  // 실행 중인 업로드를 ref 로도 들고 있어야 beforeunload 에서 최신 값을 본다.
  const activeRef = useRef(0);

  const patch = useCallback((id: string, next: Partial<UploadJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...next } : j)));
  }, []);

  const startUploads = useCallback(
    (files: File[], opts: StartOptions) => {
      if (files.length === 0) return;

      const queued: UploadJob[] = files.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        size: f.size,
        loaded: 0,
        status: "uploading",
      }));
      setJobs((prev) => [...prev, ...queued]);
      activeRef.current += queued.length;

      void (async () => {
        const supabase = createClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const job = queued[i];
          // 업로드한 객체 키(storage_path)와 DB 에 기록하는 값이 반드시 같아야
          // 하므로, 경로는 원본 그대로 저장하고 URL 에만 세그먼트 단위 인코딩을
          // 적용한다(공백 등이 들어가도 어긋나지 않게).
          const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
          const path = `${userId}/${job.id}/${safeName}`;

          try {
            if (!token || !base || !apikey) throw new Error("Not signed in");
            const encoded = path.split("/").map(encodeURIComponent).join("/");
            await xhrUpload({
              url: `${base}/storage/v1/object/${BUCKET}/${encoded}`,
              token,
              apikey,
              file,
              onProgress: (loaded) => patch(job.id, { loaded }),
            });

            const { error: metaErr } = await supabase.from("files").insert({
              id: job.id,
              owner_id: userId,
              storage_path: path,
              file_name: file.name,
              mime_type: file.type || null,
              size_bytes: file.size,
              repository_id: opts.repositoryId,
            });
            if (metaErr) {
              await supabase.storage.from(BUCKET).remove([path]);
              throw new Error("Failed to record metadata");
            }

            // 부가 작업 — 응답을 기다리지 않는다(화면 갱신을 막을 이유가 없다).
            supabase.from("audit_logs").insert({
              user_id: userId,
              target_type: "file",
              target_id: job.id,
              action: "create",
            });
            supabase.rpc("sync_object_tags", {
              p_kind: "file",
              p_id: job.id,
              p_tag_names: extractTagsFromText(file.name),
            });

            patch(job.id, { status: "done", loaded: file.size });
          } catch (e) {
            patch(job.id, {
              status: "error",
              error: e instanceof Error ? e.message : "Upload failed",
            });
          } finally {
            activeRef.current -= 1;
            setCompletedTick((t) => t + 1);
          }
        }
      })();
    },
    [patch, userId]
  );

  const dismiss = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const dismissFinished = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status === "uploading"));
  }, []);

  // 완료된 항목은 잠시 뒤 저절로 사라진다(실패는 남겨 사용자가 확인하게 한다).
  useEffect(() => {
    if (!jobs.some((j) => j.status === "done")) return;
    const t = setTimeout(() => {
      setJobs((prev) => prev.filter((j) => j.status !== "done"));
    }, 4000);
    return () => clearTimeout(t);
  }, [jobs]);

  // 업로드 중 새로고침/탭 닫기는 브라우저가 요청을 끊는다 — 막을 수는 없으니
  // 확인 창으로 경고한다(앱 안에서의 화면 이동은 영향받지 않는다).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (activeRef.current > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const uploading = jobs.some((j) => j.status === "uploading");

  const value = useMemo<UploadCtx>(
    () => ({ jobs, completedTick, uploading, startUploads, dismiss, dismissFinished }),
    [jobs, completedTick, uploading, startUploads, dismiss, dismissFinished]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <UploadToasts jobs={jobs} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

export function useUploads() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUploads must be used within UploadProvider");
  return ctx;
}

function UploadToasts({
  jobs,
  onDismiss,
}: {
  jobs: UploadJob[];
  onDismiss: (id: string) => void;
}) {
  if (jobs.length === 0) return null;

  const active = jobs.filter((j) => j.status === "uploading");
  const totalBytes = active.reduce((s, j) => s + j.size, 0);
  const loadedBytes = active.reduce((s, j) => s + j.loaded, 0);
  const overallPct = totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0;

  return (
    <div className="upload-toasts">
      <div className="upload-card">
        <div className="upload-card-head">
          <span className="label">
            {active.length > 0
              ? `UPLOADING ${active.length} FILE${active.length > 1 ? "S" : ""} · ${overallPct}%`
              : "UPLOADS"}
          </span>
          {active.length > 0 && (
            <span className="upload-card-bytes">
              {formatBytes(loadedBytes)} / {formatBytes(totalBytes)}
            </span>
          )}
        </div>
        <div className="upload-list">
          {jobs.map((j) => {
            const pct =
              j.status === "done" ? 100 : j.size > 0 ? Math.round((j.loaded / j.size) * 100) : 0;
            return (
              <div key={j.id} className={`upload-item ${j.status}`}>
                <div className="upload-item-row">
                  <span className="upload-item-name" title={j.name}>
                    {j.name}
                  </span>
                  <span className="upload-item-pct">
                    {j.status === "done" ? "Done" : j.status === "error" ? "Failed" : `${pct}%`}
                  </span>
                  <button
                    type="button"
                    className="upload-item-close"
                    onClick={() => onDismiss(j.id)}
                    aria-label="Dismiss"
                  >
                    ✕
                  </button>
                </div>
                <div className="upload-bar">
                  <div className="upload-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                {j.status === "error" && j.error && (
                  <div className="upload-item-error">{j.error}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
