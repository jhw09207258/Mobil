"use client";

import { useState, useTransition } from "react";
import { setChatEmailNotifications } from "./actions";

/**
 * 새 채팅 메시지가 오면 가입한 이메일로 알린다.
 *
 * 앱을 보고 있는 동안에는 메일이 가지 않고(최근 읽음으로 판정), 같은 대화에
 * 대해서는 15분에 한 통만 나간다 — 그 판정은 서버가 한다.
 */
export function NotificationToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (next: boolean) => {
    setOn(next); // 먼저 반영하고, 실패하면 되돌린다.
    setError(null);
    start(async () => {
      const res = await setChatEmailNotifications(next);
      if ("error" in res) {
        setOn(!next);
        setError(res.error);
      }
    });
  };

  return (
    <div className="field">
      <label className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <span style={{ color: "var(--text-1)" }}>Email me about new chat messages</span>
          <span className="page-sub" style={{ display: "block", fontSize: 12, marginTop: 3 }}>
            Only when you are not already reading the conversation, and at most once every
            15 minutes per conversation. The message itself is never included in the email.
          </span>
        </span>
      </label>
      {error && (
        <div className="notice notice-error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}
