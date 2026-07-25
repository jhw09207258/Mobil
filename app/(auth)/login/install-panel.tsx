"use client";

type Os = "mac" | "windows";

const LINES: Record<Os, { prompt: boolean; text: string }[]> = {
  mac: [
    { prompt: true, text: "curl -fsSL https://possion.app/install.sh | sh" },
    { prompt: false, text: "Fetching Possion for macOS..." },
    { prompt: false, text: "Verifying package signature..." },
    { prompt: false, text: "Installing to /Applications/Possion.app" },
    { prompt: false, text: "Installation complete." },
    { prompt: true, text: "open -a Possion" },
  ],
  windows: [
    { prompt: true, text: "irm https://possion.app/install.ps1 | iex" },
    { prompt: false, text: "Fetching Possion for Windows..." },
    { prompt: false, text: "Verifying package signature..." },
    { prompt: false, text: "Installing to C:\\Program Files\\Possion" },
    { prompt: false, text: "Installation complete." },
    { prompt: true, text: "start Possion" },
  ],
};

const PROMPT_CHAR: Record<Os, string> = { mac: "$", windows: "PS>" };
const OS_LABEL: Record<Os, string> = { mac: "macOS", windows: "Windows" };

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
              {line.prompt ? `${PROMPT_CHAR[os]} ${line.text}` : line.text}
            </div>
          ))}
          <div className="terminal-cursor" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
