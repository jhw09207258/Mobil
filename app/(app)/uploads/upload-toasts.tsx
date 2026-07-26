"use client";

import { IconClose } from "../icons";

import { formatBytes } from "@/lib/format";
import { dismissUpload, useUploads } from "./upload-store";

/**
 * 업로드 진행 토스트 — 상태는 전부 upload-store(모듈 싱글턴)에 있으므로
 * 이 컴포넌트가 다시 마운트돼도(화면 이동·refresh) 진행률이 그대로 이어진다.
 */
export function UploadToasts() {
  const { jobs } = useUploads();
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
                    onClick={() => dismissUpload(j.id)}
                    aria-label="Dismiss"
                  >
                    <IconClose size={11} />
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
