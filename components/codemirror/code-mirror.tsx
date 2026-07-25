"use client";

import { useEffect, useRef } from "react";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, crosshairCursor } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo as cmUndo, redo as cmRedo } from "@codemirror/commands";
import {
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentUnit,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import type * as Y from "yjs";
import type { LangKey } from "@/lib/languages";
import { languageExtension } from "./languages";
import { possionTheme } from "./theme";

/**
 * CodeMirror 6 React 래퍼. EditorView 를 명령형으로 생성/정리하고, 언어와
 * 편집가능 여부는 Compartment 로 동적 재구성한다. value 는 초기 콘텐츠로만
 * 사용하며(비제어), 변경 사항은 onChange 로 상위에 전달한다.
 */
export type CodeMirrorApi = { undo: () => void; redo: () => void };

// y-codemirror.next 는 undo/redo 함수를 직접 export 하지 않고 keymap 으로만
// 노출한다 — 툴바 버튼용으로 keymap 항목에서 run 함수를 꺼내 쓴다.
const yUndoRun = yUndoManagerKeymap.find((k) => k.key === "Mod-z")?.run;
const yRedoRun =
  yUndoManagerKeymap.find((k) => k.key === "Mod-y" || k.key === "Mod-Shift-z")?.run;

export function CodeMirror({
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
  /** 실시간 동시편집용 Yjs 공유 텍스트. 주어지면 CodeMirror 자체 history 대신
   * Yjs 의 undo manager 로 동작하고, value 는 최초 마운트에만 참고된다. */
  ytext?: Y.Text;
  /** 마운트 후 undo/redo 명령 핸들을 넘겨준다(툴바 버튼용). */
  onReady?: (api: CodeMirrorApi) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const editComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // 최초 1회 EditorView 생성
  useEffect(() => {
    if (!hostRef.current) return;

    const baseExtensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      // Yjs 로 동기화되는 문서는 CodeMirror 기본 history 대신 Yjs 의 undo
      // manager 를 쓴다(yCollab 이 자체적으로 붙인다) — 둘을 같이 켜면
      // undo 스택이 꼬인다.
      ytext ? [] : history(),
      drawSelection(),
      rectangularSelection(),
      crosshairCursor(),
      indentOnInput(),
      indentUnit.of("  "),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...(ytext ? yUndoManagerKeymap : historyKeymap),
        ...foldKeymap,
        indentWithTab,
      ]),
      EditorView.lineWrapping,
      possionTheme,
      langComp.current.of(languageExtension(language)),
      editComp.current.of([
        EditorView.editable.of(editable),
        EditorState.readOnly.of(!editable),
      ]),
      ytext ? yCollab(ytext, null) : [],
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    ];

    const view = new EditorView({
      state: EditorState.create({
        doc: ytext ? ytext.toString() : value,
        extensions: baseExtensions,
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;

    onReadyRef.current?.({
      undo: () => {
        if (ytext) yUndoRun?.(view);
        else cmUndo(view);
        view.focus();
      },
      redo: () => {
        if (ytext) yRedoRun?.(view);
        else cmRedo(view);
        view.focus();
      },
    });

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 최초 마운트에만 생성 (value/language/editable 변경은 아래 effect 가 처리)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 언어 변경 → Compartment 재구성
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: langComp.current.reconfigure(languageExtension(language)),
    });
  }, [language]);

  // 편집 가능 여부 변경 → Compartment 재구성
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editComp.current.reconfigure([
        EditorView.editable.of(editable),
        EditorState.readOnly.of(!editable),
      ]),
    });
  }, [editable]);

  return <div ref={hostRef} className="cm-host" />;
}
