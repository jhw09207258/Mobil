import "./switch.css";

/**
 * 트랙+손잡이 토글. 실제 접근성/키보드 동작은 진짜 `<input type=checkbox>`
 * 하나가 그대로 담당하고(스크린리더에 "체크박스"로 읽힘, Tab/Space 그대로
 * 동작), 화면에 보이는 알약 모양은 그 옆의 형제 `<span>`을 `:checked` 로
 * 스타일링한 것뿐이다 — 커스텀 role="switch" 를 손으로 구현하며 키보드
 * 처리를 다시 만드는 것보다 안전하다.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  label,
  labelSide = "right",
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  label?: React.ReactNode;
  labelSide?: "left" | "right";
}) {
  const input = (
    <span className="switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </span>
  );

  if (!label) return input;

  return (
    <label className={`switch-row ${disabled ? "disabled" : ""}`}>
      {labelSide === "left" && <span className="switch-label">{label}</span>}
      {input}
      {labelSide === "right" && <span className="switch-label">{label}</span>}
    </label>
  );
}
