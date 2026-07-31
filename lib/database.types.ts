/**
 * Supabase 스키마에 대응하는 타입 정의.
 * supabase/migrations/0001_init.sql 의 테이블 구조와 일치한다.
 * @supabase/ssr 가 요구하는 GenericSchema 형태(Tables/Views/Functions/Enums/
 * CompositeTypes + 테이블별 Relationships)를 갖춰야 rpc() 인자 타입이 올바르게
 * 추론된다.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Role = "user" | "admin";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type Permission = "view" | "edit";
/** documents 전용 — owner 는 소유자 본인만(관리자도 못 봄), 나머지는 기존 그대로. */
export type DocVisibility = "owner" | "private" | "public";
export type TargetType = "document" | "file" | "code";
export type AuditAction =
  | "view"
  | "create"
  | "update"
  | "delete"
  | "download";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          role: Role;
          approval_status: ApprovalStatus;
          approved_by: string | null;
          approved_at: string | null;
          avatar_url: string | null;
          age: number | null;
          address: string | null;
          gender: string | null;
          bio: string | null;
          phone: string | null;
          age_public: boolean;
          address_public: boolean;
          phone_public: boolean;
          email_chat_notifications: boolean;
          push_notifications: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          role?: Role;
          approval_status?: ApprovalStatus;
        };
        Update: {
          email?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          age?: number | null;
          address?: string | null;
          gender?: string | null;
          bio?: string | null;
          phone?: string | null;
          age_public?: boolean;
          address_public?: boolean;
          phone_public?: boolean;
          email_chat_notifications?: boolean;
          push_notifications?: boolean;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          content: Json;
          visibility: DocVisibility;
          created_at: string;
          updated_at: string;
          yjs_state: string | null;
          repository_id: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title?: string;
          content?: Json;
          visibility?: DocVisibility;
          yjs_state?: string | null;
        };
        Update: {
          title?: string;
          content?: Json;
          visibility?: DocVisibility;
          yjs_state?: string | null;
          repository_id?: string | null;
        };
        Relationships: [];
      };
      document_permissions: {
        Row: {
          id: string;
          document_id: string;
          user_id: string;
          permission: Permission;
          granted_by: string;
          granted_at: string;
        };
        Insert: {
          document_id: string;
          user_id: string;
          permission: Permission;
          granted_by: string;
        };
        Update: {
          permission?: Permission;
        };
        Relationships: [];
      };
      code_files: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          language: string;
          content: string;
          is_public: boolean;
          created_at: string;
          updated_at: string;
          yjs_state: string | null;
          repository_id: string | null;
          // 코드 파일은 Code Space 안에서만 존재한다(0055).
          code_repository_id: string;
          path: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name?: string;
          language?: string;
          content?: string;
          is_public?: boolean;
          yjs_state?: string | null;
          code_repository_id: string;
          path: string;
        };
        Update: {
          name?: string;
          language?: string;
          content?: string;
          is_public?: boolean;
          yjs_state?: string | null;
          repository_id?: string | null;
          code_repository_id?: string | null;
          path?: string | null;
        };
        Relationships: [];
      };
      code_repositories: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          github_owner: string | null;
          github_repo: string | null;
          github_ref: string | null;
          imported_at: string | null;
          github_pushed_at: string | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          github_owner?: string | null;
          github_repo?: string | null;
          github_ref?: string | null;
          imported_at?: string | null;
        };
        Update: {
          name?: string;
          github_owner?: string | null;
          github_repo?: string | null;
          github_ref?: string | null;
          imported_at?: string | null;
          github_pushed_at?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      user_integrations: {
        Row: {
          user_id: string;
          provider: string;
          token: string;
          account: string | null;
          meta: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          provider: string;
          token: string;
          account?: string | null;
          meta?: Json;
          updated_at?: string;
        };
        Update: {
          token?: string;
          account?: string | null;
          meta?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      code_file_permissions: {
        Row: {
          id: string;
          code_file_id: string;
          user_id: string;
          permission: Permission;
          granted_by: string;
          granted_at: string;
        };
        Insert: {
          code_file_id: string;
          user_id: string;
          permission: Permission;
          granted_by: string;
        };
        Update: {
          permission?: Permission;
        };
        Relationships: [];
      };
      mind_maps: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          data: Json;
          is_public: boolean;
          created_at: string;
          updated_at: string;
          yjs_state: string | null;
          repository_id: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title?: string;
          data?: Json;
          is_public?: boolean;
          yjs_state?: string | null;
        };
        Update: {
          title?: string;
          data?: Json;
          is_public?: boolean;
          yjs_state?: string | null;
          repository_id?: string | null;
        };
        Relationships: [];
      };
      mind_map_permissions: {
        Row: {
          id: string;
          mind_map_id: string;
          user_id: string;
          permission: Permission;
          granted_by: string;
          granted_at: string;
        };
        Insert: {
          mind_map_id: string;
          user_id: string;
          permission: Permission;
          granted_by: string;
        };
        Update: {
          permission?: Permission;
        };
        Relationships: [];
      };
      sheets: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          data: Json;
          is_public: boolean;
          created_at: string;
          updated_at: string;
          yjs_state: string | null;
          repository_id: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title?: string;
          data?: Json;
          is_public?: boolean;
          yjs_state?: string | null;
        };
        Update: {
          title?: string;
          data?: Json;
          is_public?: boolean;
          yjs_state?: string | null;
          repository_id?: string | null;
        };
        Relationships: [];
      };
      sheet_permissions: {
        Row: {
          id: string;
          sheet_id: string;
          user_id: string;
          permission: Permission;
          granted_by: string;
          granted_at: string;
        };
        Insert: {
          sheet_id: string;
          user_id: string;
          permission: Permission;
          granted_by: string;
        };
        Update: {
          permission?: Permission;
        };
        Relationships: [];
      };
      files: {
        Row: {
          id: string;
          owner_id: string;
          storage_path: string;
          file_name: string;
          mime_type: string | null;
          size_bytes: number | null;
          is_public: boolean;
          created_at: string;
          repository_id: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          storage_path: string;
          file_name: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          is_public?: boolean;
          repository_id?: string | null;
        };
        Update: {
          file_name?: string;
          is_public?: boolean;
          repository_id?: string | null;
        };
        Relationships: [];
      };
      file_permissions: {
        Row: {
          id: string;
          file_id: string;
          user_id: string;
          permission: Permission;
          granted_by: string;
          granted_at: string;
        };
        Insert: {
          file_id: string;
          user_id: string;
          permission: Permission;
          granted_by: string;
        };
        Update: {
          permission?: Permission;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          user_id: string | null;
          target_type: TargetType;
          target_id: string;
          action: AuditAction;
          created_at: string;
        };
        Insert: {
          user_id?: string | null;
          target_type: TargetType;
          target_id: string;
          action: AuditAction;
        };
        Update: {
          user_id?: string | null;
        };
        Relationships: [];
      };
      agent_runs: {
        Row: {
          space_id: string;
          owner_id: string;
          lines: Json;
          interaction_id: string | null;
          environment_id: string | null;
          model: string | null;
          turns: number;
          total_tokens: number;
          input_tokens: number;
          output_tokens: number;
          status: string;
          updated_at: string;
        };
        Insert: {
          space_id: string;
          owner_id: string;
          lines?: Json;
          interaction_id?: string | null;
          environment_id?: string | null;
          model?: string | null;
          turns?: number;
          total_tokens?: number;
          input_tokens?: number;
          output_tokens?: number;
          status?: string;
          updated_at?: string;
        };
        Update: {
          lines?: Json;
          interaction_id?: string | null;
          environment_id?: string | null;
          model?: string | null;
          turns?: number;
          total_tokens?: number;
          input_tokens?: number;
          output_tokens?: number;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ai_conversation_plugins: {
        Row: {
          id: string;
          conversation_id: string;
          kind: string;
          object_id: string;
          created_at: string;
        };
        Insert: {
          conversation_id: string;
          kind: string;
          object_id: string;
        };
        Update: never;
        Relationships: [];
      };
      ai_conversations: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title?: string;
        };
        Update: {
          title?: string;
        };
        Relationships: [];
      };
      ai_messages: {
        Row: {
          id: string;
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
          attachments: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
          attachments?: Json;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      chat_conversations: {
        Row: {
          id: string;
          bigbrother_enabled: boolean;
          kind: "dm" | "group";
          title: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          kind: "dm" | "group";
          title?: string | null;
          created_by: string;
        };
        Update: {
          title?: string | null;
        };
        Relationships: [];
      };
      chat_members: {
        Row: {
          conversation_id: string;
          user_id: string;
          joined_at: string;
          last_read_at: string;
        };
        Insert: {
          conversation_id: string;
          user_id: string;
        };
        Update: {
          last_read_at?: string;
        };
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          content: string;
          created_at: string;
          edited_at: string | null;
          reply_to_id: string | null;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          content: string;
          reply_to_id?: string | null;
        };
        Update: {
          content?: string;
          edited_at?: string | null;
        };
        Relationships: [];
      };
      chat_message_reactions: {
        Row: {
          message_id: string;
          user_id: string;
          emoji: string;
          created_at: string;
        };
        Insert: {
          message_id: string;
          user_id: string;
          emoji: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      repositories: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          parent_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          parent_id?: string | null;
        };
        Update: {
          name?: string;
          parent_id?: string | null;
        };
        Relationships: [];
      };
      starred_items: {
        Row: {
          id: string;
          user_id: string;
          kind: "document" | "code" | "sheet" | "file";
          object_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          kind: "document" | "code" | "sheet" | "file";
          object_id: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      // ---- 0066: 캘린더 ----
      calendars: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          description: string | null;
          color: string;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          description?: string | null;
          color?: string;
          is_default?: boolean;
        };
        Update: {
          name?: string;
          description?: string | null;
          color?: string;
        };
        Relationships: [];
      };
      calendar_members: {
        Row: {
          calendar_id: string;
          user_id: string;
          role: "viewer" | "editor";
          added_by: string;
          added_at: string;
        };
        Insert: {
          calendar_id: string;
          user_id: string;
          role?: "viewer" | "editor";
          added_by: string;
        };
        Update: {
          role?: "viewer" | "editor";
        };
        Relationships: [];
      };
      calendar_feed_tokens: {
        Row: {
          user_id: string;
          token: string;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      // ---- 0068: 웹 푸시 ----
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
          last_used_at: string | null;
          failure_count: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          failure_count?: number;
        };
        Update: {
          p256dh?: string;
          auth?: string;
          user_agent?: string | null;
          last_used_at?: string | null;
          failure_count?: number;
        };
        Relationships: [];
      };
      // 발송기 토큰 등 — RLS 로 직접 접근이 막혀 있고 RPC 로만 읽는다.
      app_secrets: {
        Row: { name: string; value: string; updated_at: string };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      redeem_admin_code: {
        Args: { p_code: string };
        Returns: undefined;
      };
      approve_user: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      reject_user: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      admin_delete_user: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      get_content_contributors: {
        Args: { p_kind: string; p_id: string };
        Returns: {
          user_id: string;
          display_name: string | null;
          email: string;
          avatar_url: string | null;
          first_contributed_at: string;
        }[];
      };
      list_users_by_approval: {
        Args: { p_status: string | null };
        Returns: {
          id: string;
          email: string;
          display_name: string | null;
          role: Role;
          approval_status: ApprovalStatus;
          created_at: string;
        }[];
      };
      sync_object_tags: {
        Args: { p_kind: string; p_id: string; p_tag_names: string[] | null };
        Returns: undefined;
      };
      cleanup_object_tags: {
        Args: { p_kind: string; p_id: string };
        Returns: undefined;
      };
      search_by_tag: {
        Args: { p_tag: string };
        Returns: { kind: string; id: string; title: string; updated_at: string | null }[];
      };
      get_object_tags_bulk: {
        Args: { p_kind: string; p_ids: string[] };
        Returns: { object_id: string; tag_name: string }[];
      };
      list_coworkers: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          display_name: string | null;
          email: string;
          role: Role;
          gender: string | null;
          bio: string | null;
          avatar_url: string | null;
          age: number | null;
          address: string | null;
          phone: string | null;
        }[];
      };
      generate_admin_code: {
        Args: { p_expires_at: string | null };
        Returns: string;
      };
      my_storage_usage: {
        Args: Record<string, never>;
        Returns: { bucket_id: string; bytes: number; file_count: number }[];
      };
      platform_storage_usage: {
        Args: Record<string, never>;
        Returns: { bucket_id: string; bytes: number; file_count: number }[];
      };
      my_content_breakdown: {
        Args: Record<string, never>;
        Returns: { category: string; bytes: number; item_count: number }[];
      };
      platform_content_breakdown: {
        Args: Record<string, never>;
        Returns: { category: string; bytes: number; item_count: number }[];
      };
      admin_user_overview: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          email: string;
          display_name: string | null;
          role: Role;
          created_at: string;
          documents_count: number;
          files_count: number;
          code_count: number;
          sheets_count: number;
          maps_count: number;
          storage_bytes: number;
        }[];
      };
      admin_orphaned_media: {
        Args: Record<string, never>;
        Returns: { name: string; bytes: number; created_at: string }[];
      };
      search_ontology: {
        Args: { p_query: string };
        Returns: {
          kind: string;
          id: string;
          title: string;
          snippet: string;
          rank: number;
          updated_at: string;
        }[];
      };
      get_linked_objects: {
        Args: { p_kind: string; p_id: string };
        Returns: { kind: string; id: string; title: string; link_source: string }[];
      };
      get_backlinks: {
        Args: { p_kind: string; p_id: string };
        Returns: { kind: string; id: string; title: string | null; link_source: string }[];
      };
      sync_object_links: {
        Args: {
          p_source: string;
          p_from_kind: string;
          p_from_id: string;
          p_links: { to_kind: string; to_id: string }[];
        };
        Returns: undefined;
      };
      cleanup_object_links: {
        Args: { p_kind: string; p_id: string };
        Returns: undefined;
      };
      can_view_object: {
        Args: { p_kind: string; p_id: string };
        Returns: boolean;
      };
      object_embedding_stale: {
        Args: { p_kind: string; p_id: string; p_hash: string };
        Returns: boolean;
      };
      upsert_object_embedding: {
        Args: { p_kind: string; p_id: string; p_hash: string; p_embedding: string };
        Returns: undefined;
      };
      match_objects: {
        Args: { p_embedding: string; p_limit?: number; p_kind?: string | null };
        Returns: { kind: string; id: string; title: string | null; similarity: number }[];
      };
      get_linked_objects_deep: {
        Args: { p_kind: string; p_id: string; p_depth?: number };
        Returns: {
          kind: string;
          id: string;
          title: string | null;
          link_source: string;
          depth: number;
          via_title: string | null;
        }[];
      };
      start_chat_dm: {
        Args: { p_other: string };
        Returns: string;
      };
      create_chat_group: {
        Args: { p_title: string; p_members: string[] };
        Returns: string;
      };
      add_chat_members: {
        Args: { p_conversation: string; p_members: string[] };
        Returns: undefined;
      };
      list_chat_conversations: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          kind: "dm" | "group";
          title: string;
          avatar_url: string | null;
          member_count: number;
          last_message: string | null;
          last_message_at: string | null;
          unread_count: number;
          updated_at: string;
        }[];
      };
      get_chat_messages: {
        Args: { p_conversation: string; p_limit?: number };
        Returns: {
          id: string;
          // 봇 메시지는 보낸 사람이 없다.
          sender_id: string | null;
          sender_name: string;
          sender_avatar_url: string | null;
          content: string;
          created_at: string;
          edited_at: string | null;
          reply_to_id: string | null;
          reply_to_sender_name: string | null;
          reply_to_content: string | null;
          reactions: Json;
          is_bot: boolean;
        }[];
      };
      toggle_chat_reaction: {
        Args: { p_message: string; p_emoji: string };
        Returns: boolean;
      };
      move_to_trash: {
        Args: { p_kind: string; p_id: string };
        Returns: undefined;
      };
      /** 에이전트가 고친 코드 파일을 열어 둔 편집기들에 증분 Yjs 업데이트로 밀어준다. */
      /** 채팅에 Big Brother 를 넣거나 뺀다(그 대화 멤버만). */
      set_bigbrother: {
        Args: { p_conversation: string; p_enabled: boolean };
        Returns: undefined;
      };
      /** 봇 답변을 채팅에 남긴다 — 사람 인증으로는 sender_id 없이 못 넣는다. */
      post_bigbrother_message: {
        Args: { p_conversation: string; p_content: string };
        Returns: string;
      };
      /** 대화에 연결된 항목 + 제목을 종류별 테이블에서 모아 준다. */
      list_conversation_plugins: {
        Args: { p_conversation_id: string };
        Returns: { kind: string; object_id: string; title: string; subtitle: string | null }[];
      };
      broadcast_code_yupdate: {
        Args: { p_file_id: string; p_update: string };
        Returns: undefined;
      };
      restore_from_trash: {
        Args: { p_kind: string; p_id: string };
        Returns: undefined;
      };
      purge_trash_item: {
        Args: { p_kind: string; p_id: string };
        Returns: undefined;
      };
      list_trash: {
        Args: Record<string, never>;
        Returns: {
          kind: string;
          id: string;
          title: string;
          deleted_at: string;
          expires_at: string;
          storage_path: string | null;
        }[];
      };
      mark_chat_read: {
        Args: { p_conversation: string };
        Returns: undefined;
      };
      log_document_activity: {
        Args: { p_doc: string; p_added: number; p_removed: number; p_preview: string | null };
        Returns: undefined;
      };
      get_document_activity: {
        Args: { p_doc: string; p_limit?: number };
        Returns: {
          id: string;
          user_id: string;
          user_name: string;
          avatar_url: string | null;
          added: number;
          removed: number;
          preview: string | null;
          created_at: string;
        }[];
      };
      get_chat_members: {
        Args: { p_conversation: string };
        Returns: {
          user_id: string;
          name: string;
          avatar_url: string | null;
          last_read_at: string;
        }[];
      };

      // ---- 0065: 채팅으로 자료 공유 ----
      /** 소유자/관리자가 한 사람에게 권한을 준다. 새로 준 경우에만 true. */
      grant_object_access: {
        Args: { p_kind: string; p_id: string; p_user: string; p_permission?: Permission };
        Returns: boolean;
      };
      /** 대화 멤버 전원에게. { can_grant, granted, members, already } */
      share_object_with_conversation: {
        Args: {
          p_kind: string;
          p_id: string;
          p_conversation: string;
          p_permission?: Permission;
        };
        Returns: Json;
      };
      /** 첨부 칩 여러 개의 메타데이터를 한 번에. */
      get_object_cards: {
        Args: { p_refs: Json };
        Returns: {
          kind: string;
          id: string;
          title: string | null;
          subtitle: string | null;
          owner_id: string | null;
          owner_name: string | null;
          updated_at: string | null;
          size_bytes: number | null;
          mime_type: string | null;
          can_view: boolean;
          can_edit: boolean;
          object_exists: boolean;
        }[];
      };
      /** 권한 요청 대상(소유자)만 알려 준다 — 제목은 주지 않는다. */
      request_object_access: {
        Args: { p_kind: string; p_id: string };
        Returns: Json;
      };
      list_attachable_objects: {
        Args: { p_query?: string | null; p_limit?: number };
        Returns: {
          kind: string;
          id: string;
          title: string;
          subtitle: string | null;
          updated_at: string | null;
        }[];
      };

      // ---- 0075: storage locality ----
      list_code_repositories: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          name: string;
          github_owner: string | null;
          github_repo: string | null;
          github_ref: string | null;
          imported_at: string | null;
          created_at: string;
          file_count: number;
        }[];
      };
      list_repository_contents: {
        Args: { p_repository?: string | null };
        Returns: { kind: string; id: string; label: string }[];
      };
      get_repository_graph: {
        Args: { p_repository: string };
        Returns: Json;
      };
      get_object_events: {
        Args: { p_kind: string; p_id: string };
        Returns: {
          id: string;
          title: string;
          starts_at: string;
          all_day: boolean;
          calendar_id: string;
        }[];
      };

      // ---- 0066/0067: 캘린더 ----
      ensure_default_calendar: {
        Args: Record<string, never>;
        Returns: string;
      };
      list_calendars: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          name: string;
          description: string | null;
          color: string;
          is_default: boolean;
          owner_id: string;
          owner_name: string;
          my_role: string;
          member_count: number;
          event_count: number;
        }[];
      };
      // ---- 0068: 웹 푸시 ----
      /** 푸시로 알린 사람은 p_exclude 로 넘겨 메일에서 뺀다(중복 알림 방지). */
      claim_chat_email_recipients: {
        Args: { p_message: string; p_exclude?: string[] };
        Returns: { user_id: string; email: string; display_name: string | null }[];
      };
      claim_chat_push_recipients: {
        Args: { p_message: string };
        Returns: { user_id: string; endpoint: string; p256dh: string; auth: string }[];
      };
      claim_event_push_recipients: {
        Args: { p_event: string; p_users?: string[] | null };
        Returns: { user_id: string; endpoint: string; p256dh: string; auth: string }[];
      };
      prune_push_subscription: {
        Args: { p_endpoint: string };
        Returns: undefined;
      };
      touch_push_subscription: {
        Args: { p_endpoint: string };
        Returns: undefined;
      };

      // ---- 0069: 반복 예외 · 알림 예약 · 일괄 가져오기 ----
      delete_event_occurrence: {
        Args: { p_event: string; p_occurrence_start: string };
        Returns: undefined;
      };
      detach_event_occurrence: {
        Args: { p_event: string; p_occurrence_start: string };
        Returns: string;
      };
      set_next_reminder: {
        Args: { p_event: string; p_at: string | null };
        Returns: undefined;
      };
      set_next_reminder_by_token: {
        Args: { p_token: string; p_event: string; p_at: string };
        Returns: undefined;
      };
      prune_push_subscription_by_token: {
        Args: { p_token: string; p_endpoint: string };
        Returns: undefined;
      };
      get_dispatch_token: {
        Args: { p_rotate?: boolean };
        Returns: string;
      };
      claim_due_event_reminders: {
        Args: { p_token: string; p_limit?: number };
        Returns: {
          event_id: string;
          title: string;
          starts_at: string;
          ends_at: string;
          all_day: boolean;
          location: string | null;
          time_zone: string;
          recurrence: string | null;
          recurrence_until: string | null;
          reminder_minutes: number | null;
          reminder_at: string;
          exceptions: string[] | null;
          recipients: Json;
        }[];
      };
      import_calendar_events: {
        Args: { p_calendar: string; p_events: Json };
        Returns: number;
      };

      list_calendar_events: {
        Args: { p_from: string; p_to: string };
        Returns: {
          id: string;
          calendar_id: string;
          calendar_name: string;
          calendar_color: string;
          created_by: string;
          created_by_name: string;
          title: string;
          description: string | null;
          location: string | null;
          conference_url: string | null;
          starts_at: string;
          ends_at: string;
          all_day: boolean;
          time_zone: string;
          color: string | null;
          recurrence: string | null;
          recurrence_until: string | null;
          reminder_minutes: number | null;
          status: string;
          busy: boolean;
          repository_id: string | null;
          attendee_count: number;
          accepted_count: number;
          my_response: string | null;
          is_invited: boolean;
          link_count: number;
          can_edit: boolean;
          exceptions: string[];
          detached_from: string | null;
        }[];
      };
      get_calendar_event: {
        Args: { p_event: string };
        Returns: Json;
      };
      save_calendar_event: {
        Args: {
          p_id: string | null;
          p_calendar: string;
          p_title: string;
          p_starts_at: string;
          p_ends_at: string;
          p_all_day?: boolean;
          p_description?: string | null;
          p_location?: string | null;
          p_conference_url?: string | null;
          p_time_zone?: string;
          p_color?: string | null;
          p_recurrence?: string | null;
          p_recurrence_until?: string | null;
          p_reminder_minutes?: number | null;
          p_status?: string;
          p_busy?: boolean;
          p_repository?: string | null;
          p_attendees?: string[] | null;
        };
        Returns: string;
      };
      delete_calendar_event: {
        Args: { p_event: string };
        Returns: undefined;
      };
      respond_to_event: {
        Args: { p_event: string; p_response: string };
        Returns: undefined;
      };
      share_calendar: {
        Args: { p_calendar: string; p_user: string; p_role?: string };
        Returns: undefined;
      };
      list_calendar_members: {
        Args: { p_calendar: string };
        Returns: {
          user_id: string;
          name: string;
          avatar_url: string | null;
          role: string;
          added_at: string;
        }[];
      };
      link_event_object: {
        Args: { p_event: string; p_kind: string; p_id: string };
        Returns: undefined;
      };
      unlink_event_object: {
        Args: { p_event: string; p_kind: string; p_id: string };
        Returns: undefined;
      };
      get_calendar_feed_token: {
        Args: { p_rotate?: boolean };
        Returns: string;
      };
      get_calendar_feed: {
        Args: { p_token: string };
        Returns: {
          id: string;
          calendar_name: string;
          title: string;
          description: string | null;
          location: string | null;
          conference_url: string | null;
          starts_at: string;
          ends_at: string;
          all_day: boolean;
          recurrence: string | null;
          recurrence_until: string | null;
          status: string;
          updated_at: string;
        }[];
      };
      list_upcoming_events: {
        Args: { p_days?: number };
        Returns: {
          id: string;
          title: string;
          starts_at: string;
          ends_at: string;
          all_day: boolean;
          location: string | null;
          conference_url: string | null;
          color: string | null;
          calendar_color: string;
          recurrence: string | null;
          recurrence_until: string | null;
          my_response: string | null;
          reminder_minutes: number | null;
          time_zone: string;
          exceptions: string[];
        }[];
      };
      record_perf_sample: {
        Args: { p_feature: string; p_ms: number };
        Returns: void;
      };
      get_perf_percentiles: {
        Args: { p_window_hours?: number };
        Returns: {
          feature: string;
          n: number;
          p50: number | null;
          p90: number | null;
          p95: number | null;
          p99: number | null;
          p999: number | null;
          max_ms: number | null;
          outlier_pct: number | null;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
