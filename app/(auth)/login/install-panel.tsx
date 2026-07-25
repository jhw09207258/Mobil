"use client";

import { useState } from "react";

type Os = "mac" | "windows";

const REPO_URL = "https://github.com/jhw09207258/Mobil.git";

// 서명·공증된 배포 파이프라인이 아직 없어 possion.app 에서 바로 받는
// curl/irm 원라이너 대신, 실제로 지금 동작하는 방법 — 공개 GitHub 저장소를
// 그대로 clone 해 로컬에서 빌드하는 절차를 안내한다.
const LINES: Record<Os, { prompt: boolean; text: string }[]> = {
  mac: [
    { prompt: true, text: `git clone ${REPO_URL}` },
    { prompt: false, text: "Cloning into 'Mobil'..." },
    { prompt: true, text: "cd Mobil && npm install" },
    { prompt: false, text: "Installing dependencies..." },
    { prompt: true, text: "npm run tauri build" },
    { prompt: false, text: "Building Possion.app (a few minutes)..." },
    { prompt: true, text: "open src-tauri/target/release/bundle/macos/Possion.app" },
  ],
  windows: [
    { prompt: true, text: `git clone ${REPO_URL}` },
    { prompt: false, text: "Cloning into 'Mobil'..." },
    { prompt: true, text: "cd Mobil; npm install" },
    { prompt: false, text: "Installing dependencies..." },
    { prompt: true, text: "npm run tauri build" },
    { prompt: false, text: "Building the Windows installer (a few minutes)..." },
    { prompt: true, text: "start .\\src-tauri\\target\\release\\bundle\\" },
    { prompt: false, text: "Run the .msi or .exe installer from that folder." },
  ],
};

const PROMPT_CHAR: Record<Os, string> = { mac: "$", windows: "PS>" };
const OS_LABEL: Record<Os, string> = { mac: "macOS", windows: "Windows" };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="terminal-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard 권한 없음 — 조용히 무시 */
        }
      }}
      aria-label="Copy command"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function InstallPanel({ os, onBack }: { os: Os; onBack: () => void }) {
  return (
    <div className="install-panel">
      <button type="button" className="back-to-login" onClick={onBack}>
        ← Back to Login
      </button>
      <div className="install-heading">Install Possion — {OS_LABEL[os]}</div>
      <div className="terminal">
        <div className="terminal-bar">
          <span className="terminal-dot" />
          <span className="terminal-dot" />
          <span className="terminal-dot" />
        </div>
        <div className="terminal-body">
          {LINES[os].map((line, i) => (
            <div key={i} className={`terminal-line ${line.prompt ? "terminal-prompt" : "terminal-output"}`}>
              <span>{line.prompt ? `${PROMPT_CHAR[os]} ${line.text}` : line.text}</span>
              {line.prompt && <CopyButton text={line.text} />}
            </div>
          ))}
          <div className="terminal-cursor" aria-hidden="true" />
        </div>
      </div>
      <div className="install-note">
        Requires Node.js 18+ and Rust (rustup.rs) already installed.
        <br />
        <a href={REPO_URL.replace(/\.git$/, "")} target="_blank" rel="noopener noreferrer">
          View source on GitHub
        </a>
      </div>
    </div>
  );
}
