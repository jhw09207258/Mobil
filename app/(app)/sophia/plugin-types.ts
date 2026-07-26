// Plugin 의 타입과 상수.
//
// plugin-actions.ts 와 분리된 이유: 그쪽은 "use server" 라 export 가 전부 async
// 함수여야 한다. 상수를 하나라도 export 하면 모듈이 통째로 깨지고, 그 모듈을
// 물고 있는 페이지 번들까지 함께 죽는다.

export type PluginKind =
  | "document"
  | "code"
  | "sheet"
  | "mindmap"
  | "repository"
  | "code_space";

export type Plugin = {
  kind: PluginKind;
  objectId: string;
  title: string;
  subtitle: string | null;
};

export type PluginCandidate = {
  kind: PluginKind;
  id: string;
  title: string;
  subtitle: string | null;
};

export const PLUGIN_LABEL: Record<PluginKind, string> = {
  document: "Doc",
  code: "Code",
  sheet: "Table",
  mindmap: "Link Graph",
  repository: "Repository",
  code_space: "Code Space",
};
