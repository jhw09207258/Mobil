"use client";

import { useSyncExternalStore } from "react";
import { fetchFile, type GitHubRef } from "@/lib/github-import";
import { addCodeFileToRepo } from "./repo-actions";

// ============================================================================
// GitHub 임포트 진행 상태 — 업로드와 같은 이유로 React 트리 "밖"(모듈 싱글턴)에
// 둔다. 임포트 중에 다른 화면으로 이동해도 진행이 끊기지 않고, 컴포넌트가 다시
// 마운트돼도 진행률이 그대로 이어진다(app/(app)/uploads/upload-store.ts 와 동일
// 한 패턴).
// ============================================================================

export type ImportState = {
  active: boolean;
  repoLabel: string;
  total: number;
  done: number;
  failed: number;
  error: string | null;
  /** 끝날 때마다 증가 — 목록 새로고침 트리거용. */
  finishedTick: number;
};

const EMPTY: ImportState = {
  active: false,
  repoLabel: "",
  total: 0,
  done: 0,
  failed: 0,
  error: null,
  finishedTick: 0,
};

let state: ImportState = EMPTY;
const listeners = new Set<() => void>();

function commit(next: Partial<ImportState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

export function dismissImport() {
  if (state.active) return; // 진행 중에는 닫지 않는다
  commit({ repoLabel: "", total: 0, done: 0, failed: 0, error: null });
}

/**
 * 파일 목록을 순회하며 내용을 받아 저장한다.
 * raw.githubusercontent.com 은 API 레이트 리밋에 걸리지 않지만, 동시 요청을
 * 무한정 늘리면 브라우저 연결 한도에 막히고 서버 액션도 몰린다 — 적당한
 * 동시성(6)으로 제한한다.
 */
export function startImport(args: {
  repoId: string;
  ref: GitHubRef;
  files: { path: string }[];
  token?: string;
}) {
  if (state.active) return;
  const { repoId, ref, files, token } = args;
  commit({
    active: true,
    repoLabel: `${ref.owner}/${ref.repo}`,
    total: files.length,
    done: 0,
    failed: 0,
    error: null,
  });

  void (async () => {
    let cursor = 0;
    const CONCURRENCY = 6;

    const worker = async () => {
      for (;;) {
        const i = cursor++;
        if (i >= files.length) return;
        const path = files[i].path;
        try {
          const content = await fetchFile(ref, path, token);
          const res = await addCodeFileToRepo(repoId, path, content);
          if ("error" in res) commit({ failed: state.failed + 1 });
          else commit({ done: state.done + 1 });
        } catch {
          commit({ failed: state.failed + 1 });
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } catch (e) {
      commit({ error: e instanceof Error ? e.message : "Import failed" });
    } finally {
      commit({ active: false, finishedTick: state.finishedTick + 1 });
    }
  })();
}

export function useImportState(): ImportState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
