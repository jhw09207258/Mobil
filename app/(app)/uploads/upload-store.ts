"use client";

import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { extractTagsFromText } from "@/lib/tags";

// ============================================================================
// 파일 업로드 스토어 — 상태를 React 트리 "밖"(모듈 싱글턴)에 둔다.
//
// 왜 Context/state 가 아니라 싱글턴인가: 업로드 중에 사이드바 아이콘을 눌러
// 화면을 옮기면 Next.js 가 (app) 세그먼트를 다시 렌더링하고, 그 과정에서
// Suspense fallback(loading.tsx)이 끼거나 router.refresh() 가 겹치면 React
// 트리 일부가 다시 마운트될 수 있다. 진행 상태를 컴포넌트 state 로 들고 있으면
// 그 순간 전부 사라져 "업로드가 끊긴 것"처럼 보인다(실제로 XHR 은 살아 있어도
// 아무도 추적하지 않게 된다). 스토어를 트리 밖에 두면 무엇이 다시 마운트되든
// 진행 중인 XHR 과 진행률이 그대로 유지된다 — chat-bus.ts 와 같은 방식.
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

export type UploadSnapshot = {
  jobs: UploadJob[];
  /** 업로드가 하나 끝날 때마다 증가 — 목록 새로고침 트리거용. */
  completedTick: number;
};

const EMPTY: UploadSnapshot = { jobs: [], completedTick: 0 };

let snapshot: UploadSnapshot = EMPTY;
const listeners = new Set<() => void>();
/** 진행 중 개수 — beforeunload 경고 판단용. */
let activeCount = 0;

function commit(jobs: UploadJob[], completed = false) {
  snapshot = {
    jobs,
    completedTick: snapshot.completedTick + (completed ? 1 : 0),
  };
  listeners.forEach((l) => l());
}

function patch(id: string, next: Partial<UploadJob>, completed = false) {
  commit(
    snapshot.jobs.map((j) => (j.id === id ? { ...j, ...next } : j)),
    completed
  );
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => snapshot;
// SSR 에서는 항상 같은 참조를 돌려줘야 무한 렌더가 나지 않는다.
const getServerSnapshot = () => EMPTY;

export function dismissUpload(id: string) {
  commit(snapshot.jobs.filter((j) => j.id !== id));
}

/** storage-js 와 동일한 업로드 요청을 XHR 로 보내 진행률을 얻는다.
 *  (supabase-js 의 storage.upload() 는 fetch 기반이라 진행 이벤트가 없다.) */
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

export function startUploads(
  files: File[],
  opts: { userId: string; repositoryId: string | null }
) {
  if (files.length === 0) return;

  const queued: UploadJob[] = files.map((f) => ({
    id: crypto.randomUUID(),
    name: f.name,
    size: f.size,
    loaded: 0,
    status: "uploading",
  }));
  commit([...snapshot.jobs, ...queued]);
  activeCount += queued.length;

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
      const path = `${opts.userId}/${job.id}/${safeName}`;

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
          owner_id: opts.userId,
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
          user_id: opts.userId,
          target_type: "file",
          target_id: job.id,
          action: "create",
        });
        supabase.rpc("sync_object_tags", {
          p_kind: "file",
          p_id: job.id,
          p_tag_names: extractTagsFromText(file.name),
        });

        patch(job.id, { status: "done", loaded: file.size }, true);
        // 성공 항목은 잠시 뒤 저절로 사라진다(실패는 남겨 확인하게 한다).
        setTimeout(() => dismissUpload(job.id), 4000);
      } catch (e) {
        patch(
          job.id,
          { status: "error", error: e instanceof Error ? e.message : "Upload failed" },
          true
        );
      } finally {
        activeCount -= 1;
      }
    }
  })();
}

// 업로드 중 새로고침/탭 닫기는 브라우저가 요청을 끊는다 — 막을 수는 없으니
// 확인 창으로 경고한다(앱 안에서의 화면 이동은 영향받지 않는다).
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (activeCount > 0) e.preventDefault();
  });
}

export function useUploads() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    jobs: snap.jobs,
    completedTick: snap.completedTick,
    uploading: snap.jobs.some((j) => j.status === "uploading"),
  };
}
