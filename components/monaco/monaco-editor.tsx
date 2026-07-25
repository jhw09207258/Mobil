"use client";

import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import { MonacoBinding } from "y-monaco";
import type * as Y from "yjs";
import type { LangKey } from "@/lib/languages";

// ============================================================================
// Monaco(= VS Code 의 에디터 코어) React 래퍼.
//
// CodeMirror 래퍼와 프로퍼티를 똑같이 맞춰 code-editor.tsx 의 교체 지점을
// 최소화했다(value/language/editable/onChange/ytext/onReady).
//
// 로딩 방식: @monaco-editor/react 의 기본 CDN 로더를 쓰지 않고 npm 패키지를
// 번들한다 — 이 앱의 CSP 가 `script-src 'self'` 라 외부 CDN 스크립트가 차단되고,
// CSP 를 느슨하게 푸는 것보다 번들하는 편이 안전하다. 언어 서비스(자동완성)는
// 웹 워커에서 도는데 CSP 에 이미 `worker-src 'self' blob:` 이 있어 그대로 된다.
// ============================================================================

/** 앱의 LangKey → Monaco 언어 id. Monaco 에는 jsx/tsx 가 따로 없다. */
const LANG_ID: Record<LangKey, string> = {
  plaintext: "plaintext",
  javascript: "javascript",
  typescript: "typescript",
  jsx: "javascript",
  tsx: "typescript",
  python: "python",
  html: "html",
  css: "css",
  json: "json",
  markdown: "markdown",
  sql: "sql",
  cpp: "cpp",
  java: "java",
  rust: "rust",
  php: "php",
  xml: "xml",
  yaml: "yaml",
  go: "go",
};

// 언어 서비스 워커. webpack5/Turbopack 모두 `new Worker(new URL(...))` 형태를
// 정적으로 인식해 번들해 준다(별도 플러그인 불필요).
// 경로 주의: monaco-editor 의 package.json exports 가 "./*" → "./esm/vs/*.js" 로
// 매핑하므로 지정자에 esm/vs 를 직접 쓰면 접두사가 두 번 붙어 해석에 실패한다
// (monaco-editor/editor/editor.worker.js 가 맞는 형태).
let workersReady = false;
function setupWorkers() {
  if (workersReady || typeof window === "undefined") return;
  workersReady = true;
  (self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
    getWorker(_moduleId: string, label: string) {
      switch (label) {
        case "typescript":
        case "javascript":
          return new Worker(
            new URL("monaco-editor/language/typescript/ts.worker.js", import.meta.url),
            { type: "module" }
          );
        case "json":
          return new Worker(
            new URL("monaco-editor/language/json/json.worker.js", import.meta.url),
            { type: "module" }
          );
        case "css":
        case "scss":
        case "less":
          return new Worker(
            new URL("monaco-editor/language/css/css.worker.js", import.meta.url),
            { type: "module" }
          );
        case "html":
        case "handlebars":
        case "razor":
          return new Worker(
            new URL("monaco-editor/language/html/html.worker.js", import.meta.url),
            { type: "module" }
          );
        default:
          return new Worker(
            new URL("monaco-editor/editor/editor.worker.js", import.meta.url),
            { type: "module" }
          );
      }
    },
  };
}

let themesDefined = false;
function defineThemes() {
  if (themesDefined) return;
  themesDefined = true;
  // 앱 팔레트(globals.css)에 맞춘 중립 그레이 테마.
  monaco.editor.defineTheme("possion-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#141414",
      "editor.lineHighlightBackground": "#ffffff08",
      "editorLineNumber.foreground": "#6e6e6e",
      "editorLineNumber.activeForeground": "#cccccc",
      "editorGutter.background": "#141414",
      "editorWidget.background": "#202020",
      "editorSuggestWidget.background": "#202020",
      "input.background": "#282828",
      "dropdown.background": "#202020",
    },
  });
  monaco.editor.defineTheme("possion-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#00000008",
    },
  });
}

export type MonacoApi = {
  undo: () => void;
  redo: () => void;
  /** 현재 선택 영역(없으면 전체 내용) — AI 어시스트에 넘길 코드. */
  getSelection: () => string;
};

export function MonacoCodeEditor({
  value,
  language,
  editable,
  onChange,
  ytext,
  onReady,
}: {
  value: string;
  language: LangKey;
  editable: boolean;
  onChange: (value: string) => void;
  /** 실시간 동시편집용 Yjs 공유 텍스트. 주어지면 내용의 원본은 Yjs 가 된다. */
  ytext?: Y.Text;
  onReady?: (api: MonacoApi) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // 최초 1회 생성 — CodeMirror 래퍼와 동일하게 비제어로 동작한다.
  useEffect(() => {
    if (!hostRef.current) return;
    setupWorkers();
    defineThemes();

    const isLight = document.documentElement.dataset.theme === "light";
    const editor = monaco.editor.create(hostRef.current, {
      // Yjs 가 붙으면 내용은 바인딩이 채우므로 빈 문자열로 시작한다.
      value: ytext ? "" : value,
      language: LANG_ID[language] ?? "plaintext",
      theme: isLight ? "possion-light" : "possion-dark",
      readOnly: !editable,
      automaticLayout: true,
      fontSize: 13.5,
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      tabSize: 2,
      wordWrap: "on",
      smoothScrolling: true,
      cursorBlinking: "smooth",
      formatOnPaste: true,
      bracketPairColorization: { enabled: true },
      padding: { top: 12, bottom: 12 },
    });
    editorRef.current = editor;

    let binding: MonacoBinding | null = null;
    const model = editor.getModel();
    if (ytext && model) {
      // Yjs ↔ Monaco 양방향 바인딩. 문서·전송 계층(lib/yjs-transport.ts)은
      // 그대로이므로 기존 협업 세션과 호환된다.
      binding = new MonacoBinding(ytext, model, new Set([editor]), null);
    }

    const sub = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
    });

    onReadyRef.current?.({
      undo: () => {
        editor.trigger("toolbar", "undo", null);
        editor.focus();
      },
      redo: () => {
        editor.trigger("toolbar", "redo", null);
        editor.focus();
      },
      getSelection: () => {
        const sel = editor.getSelection();
        const picked = sel && !sel.isEmpty() ? editor.getModel()?.getValueInRange(sel) : "";
        return picked || editor.getValue();
      },
    });

    return () => {
      sub.dispose();
      binding?.destroy();
      editor.dispose();
      editorRef.current = null;
    };
    // 최초 마운트에만 생성 — language/editable 변경은 아래 effect 가 처리한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model) monaco.editor.setModelLanguage(model, LANG_ID[language] ?? "plaintext");
  }, [language]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: !editable });
  }, [editable]);

  return <div ref={hostRef} className="monaco-host" />;
}
