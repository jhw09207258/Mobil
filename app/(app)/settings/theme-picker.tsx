"use client";

import { useEffect, useState } from "react";
import { loadTheme, saveTheme } from "@/lib/theme";

const PRESETS: { name: string; hex: string | null }[] = [
  { name: "Graphite (default)", hex: null },
  { name: "Signal Green", hex: "#3f9d5b" },
  { name: "NVIDIA Green", hex: "#76b900" },
  { name: "Brick", hex: "#c74634" },
  { name: "Steel Blue", hex: "#4f7cac" },
  { name: "Violet", hex: "#7c5cff" },
  { name: "Teal", hex: "#12a594" },
  { name: "Amber", hex: "#d29922" },
  { name: "Magenta", hex: "#d6409f" },
];

export function ThemePicker() {
  const [accent, setAccent] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setAccent(loadTheme()?.accent ?? null);
    setLoaded(true);
  }, []);

  const pick = (hex: string | null) => {
    setAccent(hex);
    saveTheme(hex);
  };

  return (
    <div className="panel" style={{ marginBottom: 24 }}>
      <div className="panel-header">
        <span className="label">APP THEME</span>
      </div>
      <div className="panel-body">
        <p className="page-sub" style={{ margin: "0 0 14px" }}>
          Pick an accent color — backgrounds, buttons, links and active icons are
          derived from it automatically, with lightness clamped so text and
          controls stay readable. Applies to the whole app on this device.
        </p>
        {loaded && (
          <div className="theme-swatches">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className={`theme-swatch ${accent === p.hex ? "active" : ""}`}
                style={{
                  background: p.hex ?? "linear-gradient(135deg, #161616 50%, #3f9d5b 50%)",
                }}
                title={p.name}
                aria-label={p.name}
                onClick={() => pick(p.hex)}
              />
            ))}
            <label className="theme-custom" title="Custom color">
              <input
                type="color"
                value={accent ?? "#3f9d5b"}
                onChange={(e) => pick(e.target.value)}
              />
              <span className="label" style={{ fontSize: 10 }}>CUSTOM</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
