"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { Shortcut } from "@/components/ui/kbd";

const NAV: Record<string, string> = {
  h: "/dashboard",
  f: "/files",
  d: "/documents",
  s: "/sheets",
  c: "/code",
  m: "/mindmap",
};

const HELP: [string, string][] = [
  ["g h", "Go to Operational View"],
  ["g f", "Go to Repository"],
  ["g d", "Go to Docs +"],
  ["g s", "Go to Table"],
  ["g c", "Go to Code"],
  ["g m", "Go to Link Graph"],
  [",", "Go to Settings"],
  ["⌘/Ctrl S", "Save (in editors)"],
  ["?", "Toggle this help"],
];

function inEditable(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n) return false;
  const tag = n.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    n.isContentEditable === true
  );
}

export function Shortcuts() {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const gPending = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (inEditable(e.target)) return;

      // ? → help
      if (e.key === "?") {
        e.preventDefault();
        setHelp((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setHelp(false);
        return;
      }

      // g-prefix navigation
      if (gPending.current) {
        const dest = NAV[e.key.toLowerCase()];
        gPending.current = false;
        if (gTimer.current) clearTimeout(gTimer.current);
        if (dest) {
          e.preventDefault();
          router.push(dest);
        }
        return;
      }
      if (e.key.toLowerCase() === "g") {
        gPending.current = true;
        if (gTimer.current) clearTimeout(gTimer.current);
        gTimer.current = setTimeout(() => (gPending.current = false), 1200);
        return;
      }

      // , → Settings (common convention, e.g. Slack/Linear preferences)
      if (e.key === ",") {
        e.preventDefault();
        router.push("/settings");
      }
    },
    [router]
  );

  useEffect(() => {
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onKey]);

  if (!help) return null;
  return (
    <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)} width={420}>
      <div className="table-scroll">
      <table className="table">
        <tbody>
          {HELP.map(([k, d]) => (
            <tr key={k}>
              <td style={{ width: 120 }}>
                <Shortcut keys={k.split(" ")} size="sm" />
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </Modal>
  );
}
