/**
 * 서명 URL 을 다운로드로 트리거한다.
 *
 * `window.location.href = url` 은 하드 내비게이션이라, 데스크톱(Tauri 웹뷰)에서
 * 앱 화면 자체가 서명 URL 로 넘어가 버린다. 보이지 않는 앵커를 클릭시키면
 * 웹과 데스크톱에서 똑같이 "내려받기" 로만 동작한다.
 */
export function triggerDownload(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 서버 액션이 반환한 base64 파일을 브라우저에서 다운로드로 트리거한다. */
export function downloadBase64File(fileName: string, mimeType: string, base64: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
