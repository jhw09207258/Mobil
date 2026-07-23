"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type PresenceUser = {
  id: string;
  name: string;
  avatarUrl: string | null;
  color: string;
};

/**
 * 구글독스 스타일 "현재 접속자" 표시. 호출부는 콘텐츠 채널과 같은 topic
 * (`doc:<id>` 등)을 넘기지만, 실제 프레즌스 채널은 `presence:` 를 앞에 붙인
 * 별도 topic 으로 연다 — Supabase Realtime 은 한 클라이언트가 같은 topic 으로
 * 채널을 두 개(Yjs 브로드캐스트 + 프레즌스) 열면 충돌하므로(같은 채널 이중
 * join), topic 을 분리해 콘텐츠 동시편집과 부딪히지 않게 한다.
 *
 * RLS(0037 의 presence INSERT 정책 + 0039 로 확장한 realtime_topic_viewable)가
 * `presence:` 접두사를 벗겨 원래 topic 의 열람 권한으로 판정하므로, 편집 권한이
 * 없는 열람 전용 사용자도 자신의 접속 상태를 track 할 수 있다.
 */
export function usePresence(topic: string, self: PresenceUser | null): PresenceUser[] {
  const [users, setUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    if (!self) return;
    const supabase = createClient();
    const channel = supabase.channel(`presence:${topic}`, {
      config: { presence: { key: self.id }, private: true },
    });

    const sync = () => {
      const state = channel.presenceState<PresenceUser>();
      const list = Object.values(state)
        .map((entries) => entries[0])
        .filter((u) => !!u);
      setUsers(list);
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track(self);
        }
      });

    return () => {
      setUsers([]);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, self?.id, self?.name, self?.avatarUrl, self?.color]);

  return users;
}
