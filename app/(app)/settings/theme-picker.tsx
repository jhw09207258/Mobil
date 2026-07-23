"use client";

import { useEffect, useState } from "react";
import { loadThemeMode, saveThemeMode, type ThemeMode } from "@/lib/theme";

export function ThemePicker() {
  const [mode, setMode] = useState<ThemeMode | null>(null);

  useEffect(() => {
    setMode(loadThemeMode());
  }, []);

  const pick = (m: ThemeMode) => {
    setMode(m);
    saveThemeMode(m);
  };

  return (
    <div className="panel" style={{ marginBottom: 24 }}>
      <div className="panel-header">
        <span className="label">APP THEME</span>
      </div>
      <div className="panel-body">
        <p className="page-sub" style={{ margin: "0 0 14px" }}>
          Applies to the whole app on this device.
        </p>
        {mode && (
          <div className="row" style={{ gap: 10 }}>
            <button
              type="button"
              className={`theme-mode-btn ${mode === "dark" ? "active" : ""}`}
              onClick={() => pick("dark")}
            >
              <span className="theme-mode-chip theme-mode-chip-dark" aria-hidden="true" />
              Dark
            </button>
            <button
              type="button"
              className={`theme-mode-btn ${mode === "light" ? "active" : ""}`}
              onClick={() => pick("light")}
            >
              <span className="theme-mode-chip theme-mode-chip-light" aria-hidden="true" />
              Light
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
