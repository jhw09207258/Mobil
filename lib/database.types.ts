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
        };
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          content: Json;
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
          content?: Json;
          is_public?: boolean;
          yjs_state?: string | null;
        };
        Update: {
          title?: string;
          content?: Json;
          is_public?: boolean;
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
        };
        Insert: {
          id?: string;
          owner_id: string;
          name?: string;
          language?: string;
          content?: string;
          is_public?: boolean;
          yjs_state?: string | null;
        };
        Update: {
          name?: string;
          language?: string;
          content?: string;
          is_public?: boolean;
          yjs_state?: string | null;
          repository_id?: string | null;
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
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      chat_conversations: {
        Row: {
          id: string;
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
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          content: string;
        };
        Update: {
          content?: string;
          edited_at?: string | null;
        };
        Relationships: [];
      };
      repositories: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
        };
        Update: {
          name?: string;
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
          sender_id: string;
          sender_name: string;
          sender_avatar_url: string | null;
          content: string;
          created_at: string;
          edited_at: string | null;
        }[];
      };
      mark_chat_read: {
        Args: { p_conversation: string };
        Returns: undefined;
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
