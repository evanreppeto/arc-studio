/**
 * Supabase Database types — generated, do not edit by hand.
 *
 * Regenerate from the applied schema (prod is the source of truth) with:
 *
 *   supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
 *
 * This file was previously a hand-maintained subset covering only the tables the
 * app happened to touch. That drifted: a table missing here types as `never`, so
 * `.from("new_table").upsert(...)` failed typecheck long after the migration
 * shipped. It is now generated in full — add tables by running a migration and
 * regenerating, never by editing this file.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_platform_actions: {
        Row: {
          ad_spend_decision_id: string
          attempted_at: string | null
          created_at: string
          id: string
          last_error: string | null
          platform: string
          request_payload: Json
          response_payload: Json
          status: string
        }
        Insert: {
          ad_spend_decision_id: string
          attempted_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          platform: string
          request_payload?: Json
          response_payload?: Json
          status?: string
        }
        Update: {
          ad_spend_decision_id?: string
          attempted_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          platform?: string
          request_payload?: Json
          response_payload?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_platform_actions_ad_spend_decision_id_fkey"
            columns: ["ad_spend_decision_id"]
            isOneToOne: false
            referencedRelation: "ad_spend_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_spend_decisions: {
        Row: {
          applied_at: string | null
          approval_item_id: string | null
          broad_budget_scale: number | null
          capacity_snapshot_id: string | null
          created_at: string
          decision_key: string
          id: string
          payload: Json
          reason: string | null
          reroute_budget_scale: number | null
          status: Database["public"]["Enums"]["ad_spend_decision_status"]
          target_keywords: string[]
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          approval_item_id?: string | null
          broad_budget_scale?: number | null
          capacity_snapshot_id?: string | null
          created_at?: string
          decision_key: string
          id?: string
          payload?: Json
          reason?: string | null
          reroute_budget_scale?: number | null
          status?: Database["public"]["Enums"]["ad_spend_decision_status"]
          target_keywords?: string[]
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          approval_item_id?: string | null
          broad_budget_scale?: number | null
          capacity_snapshot_id?: string | null
          created_at?: string
          decision_key?: string
          id?: string
          payload?: Json
          reason?: string | null
          reroute_budget_scale?: number | null
          status?: Database["public"]["Enums"]["ad_spend_decision_status"]
          target_keywords?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_spend_decisions_approval_item_id_fkey"
            columns: ["approval_item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_spend_decisions_capacity_snapshot_id_fkey"
            columns: ["capacity_snapshot_id"]
            isOneToOne: false
            referencedRelation: "capacity_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_api_tokens: {
        Row: {
          created_at: string
          id: string
          label: string | null
          last_used_at: string | null
          org_id: string
          prefix: string
          revoked_at: string | null
          scopes: string[] | null
          token_hash: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          org_id: string
          prefix: string
          revoked_at?: string | null
          scopes?: string[] | null
          token_hash: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          org_id?: string
          prefix?: string
          revoked_at?: string | null
          scopes?: string[] | null
          token_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_api_tokens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_connections: {
        Row: {
          agent_key: string | null
          created_at: string
          display_name: string | null
          enabled: boolean
          last_error: string | null
          last_seen_at: string | null
          last_status: string | null
          org_id: string
          updated_at: string
          webhook_secret_ref: string | null
          webhook_url: string | null
          workspace_id: string
        }
        Insert: {
          agent_key?: string | null
          created_at?: string
          display_name?: string | null
          enabled?: boolean
          last_error?: string | null
          last_seen_at?: string | null
          last_status?: string | null
          org_id: string
          updated_at?: string
          webhook_secret_ref?: string | null
          webhook_url?: string | null
          workspace_id: string
        }
        Update: {
          agent_key?: string | null
          created_at?: string
          display_name?: string | null
          enabled?: boolean
          last_error?: string | null
          last_seen_at?: string | null
          last_status?: string | null
          org_id?: string
          updated_at?: string
          webhook_secret_ref?: string | null
          webhook_url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_outputs: {
        Row: {
          approval_item_id: string | null
          approval_status: Database["public"]["Enums"]["approval_status"]
          body: string | null
          campaign_asset_id: string | null
          compliance_status: Database["public"]["Enums"]["approval_status"]
          created_at: string
          edited_body: string | null
          id: string
          org_id: string
          output_type: string
          risk_level: Database["public"]["Enums"]["agent_risk_level"]
          structured_payload: Json
          task_id: string
          title: string
          updated_at: string
        }
        Insert: {
          approval_item_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_status"]
          body?: string | null
          campaign_asset_id?: string | null
          compliance_status?: Database["public"]["Enums"]["approval_status"]
          created_at?: string
          edited_body?: string | null
          id?: string
          org_id: string
          output_type: string
          risk_level?: Database["public"]["Enums"]["agent_risk_level"]
          structured_payload?: Json
          task_id: string
          title: string
          updated_at?: string
        }
        Update: {
          approval_item_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_status"]
          body?: string | null
          campaign_asset_id?: string | null
          compliance_status?: Database["public"]["Enums"]["approval_status"]
          created_at?: string
          edited_body?: string | null
          id?: string
          org_id?: string
          output_type?: string
          risk_level?: Database["public"]["Enums"]["agent_risk_level"]
          structured_payload?: Json
          task_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_outputs_approval_item_id_fkey"
            columns: ["approval_item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_outputs_campaign_asset_id_fkey"
            columns: ["campaign_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_outputs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_outputs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_permissions: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          permission_key: string
          permission_type: Database["public"]["Enums"]["agent_permission_type"]
          requires_approval: boolean
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          permission_key: string
          permission_type: Database["public"]["Enums"]["agent_permission_type"]
          requires_approval?: boolean
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          permission_key?: string
          permission_type?: Database["public"]["Enums"]["agent_permission_type"]
          requires_approval?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "agent_permissions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_run_logs: {
        Row: {
          agent_id: string
          completed_at: string | null
          cost_estimate_cents: number | null
          created_at: string
          error_message: string | null
          id: string
          input_token_count: number | null
          metadata: Json
          model_name: string | null
          model_provider: string | null
          org_id: string
          output_token_count: number | null
          reasoning_summary: string | null
          retry_count: number
          run_status: Database["public"]["Enums"]["agent_run_status"]
          started_at: string | null
          task_id: string | null
        }
        Insert: {
          agent_id: string
          completed_at?: string | null
          cost_estimate_cents?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_token_count?: number | null
          metadata?: Json
          model_name?: string | null
          model_provider?: string | null
          org_id: string
          output_token_count?: number | null
          reasoning_summary?: string | null
          retry_count?: number
          run_status?: Database["public"]["Enums"]["agent_run_status"]
          started_at?: string | null
          task_id?: string | null
        }
        Update: {
          agent_id?: string
          completed_at?: string | null
          cost_estimate_cents?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_token_count?: number | null
          metadata?: Json
          model_name?: string | null
          model_provider?: string | null
          org_id?: string
          output_token_count?: number | null
          reasoning_summary?: string | null
          retry_count?: number
          run_status?: Database["public"]["Enums"]["agent_run_status"]
          started_at?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_run_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_run_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_run_logs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_task_events: {
        Row: {
          actor_kind: string
          actor_label: string
          body: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          org_id: string
          task_id: string
          title: string
        }
        Insert: {
          actor_kind: string
          actor_label: string
          body?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          org_id: string
          task_id: string
          title: string
        }
        Update: {
          actor_kind?: string
          actor_label?: string
          body?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          org_id?: string
          task_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_task_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_task_inputs: {
        Row: {
          created_at: string
          id: string
          input_type: string
          org_id: string
          payload: Json
          source_id: string | null
          source_table: string | null
          summary: string | null
          task_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          input_type: string
          org_id: string
          payload?: Json
          source_id?: string | null
          source_table?: string | null
          summary?: string | null
          task_id: string
        }
        Update: {
          created_at?: string
          id?: string
          input_type?: string
          org_id?: string
          payload?: Json
          source_id?: string | null
          source_table?: string | null
          summary?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_task_inputs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_task_inputs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_task_label_assignments: {
        Row: {
          created_at: string
          id: string
          label_id: string
          state: string
          suggested_by: string | null
          task_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label_id: string
          state?: string
          suggested_by?: string | null
          task_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label_id?: string
          state?: string
          suggested_by?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_task_label_assignments_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "task_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_task_label_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tasks: {
        Row: {
          agent_id: string
          approval_item_id: string | null
          approver_label: string
          campaign_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          driver_agent_id: string | null
          driver_kind: string
          driver_label: string
          due_at: string | null
          id: string
          max_retries: number
          metadata: Json
          objective: string
          org_id: string
          owner_kind: string
          owner_label: string
          persona_snapshot_id: string | null
          priority: Database["public"]["Enums"]["agent_task_priority"]
          retry_count: number
          scheduled_for: string | null
          source_id: string | null
          source_type: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["agent_task_status"]
          task_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agent_id: string
          approval_item_id?: string | null
          approver_label?: string
          campaign_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          driver_agent_id?: string | null
          driver_kind?: string
          driver_label?: string
          due_at?: string | null
          id?: string
          max_retries?: number
          metadata?: Json
          objective: string
          org_id: string
          owner_kind?: string
          owner_label?: string
          persona_snapshot_id?: string | null
          priority?: Database["public"]["Enums"]["agent_task_priority"]
          retry_count?: number
          scheduled_for?: string | null
          source_id?: string | null
          source_type?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["agent_task_status"]
          task_type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agent_id?: string
          approval_item_id?: string | null
          approver_label?: string
          campaign_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          driver_agent_id?: string | null
          driver_kind?: string
          driver_label?: string
          due_at?: string | null
          id?: string
          max_retries?: number
          metadata?: Json
          objective?: string
          org_id?: string
          owner_kind?: string
          owner_label?: string
          persona_snapshot_id?: string | null
          priority?: Database["public"]["Enums"]["agent_task_priority"]
          retry_count?: number
          scheduled_for?: string | null
          source_id?: string | null
          source_type?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["agent_task_status"]
          task_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tasks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tasks_approval_item_id_fkey"
            columns: ["approval_item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tasks_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tasks_driver_agent_id_fkey"
            columns: ["driver_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tasks_persona_snapshot_id_fkey"
            columns: ["persona_snapshot_id"]
            isOneToOne: false
            referencedRelation: "persona_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tasks_workspace_org_fkey"
            columns: ["org_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      agent_tool_requests: {
        Row: {
          agent_task_id: string | null
          approval_item_id: string | null
          approval_status: Database["public"]["Enums"]["approval_status"]
          campaign_asset_id: string | null
          campaign_id: string | null
          created_at: string
          crm_source_id: string | null
          crm_source_type: string | null
          error_message: string | null
          handoff_type: string
          id: string
          persona_snapshot_id: string | null
          prompt: string | null
          requested_by_agent_id: string
          result_summary: string | null
          result_url: string | null
          risk_level: Database["public"]["Enums"]["agent_risk_level"]
          source_payload: Json
          status: Database["public"]["Enums"]["agent_tool_request_status"]
          tool_name: string
          updated_at: string
        }
        Insert: {
          agent_task_id?: string | null
          approval_item_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_status"]
          campaign_asset_id?: string | null
          campaign_id?: string | null
          created_at?: string
          crm_source_id?: string | null
          crm_source_type?: string | null
          error_message?: string | null
          handoff_type: string
          id?: string
          persona_snapshot_id?: string | null
          prompt?: string | null
          requested_by_agent_id: string
          result_summary?: string | null
          result_url?: string | null
          risk_level?: Database["public"]["Enums"]["agent_risk_level"]
          source_payload?: Json
          status?: Database["public"]["Enums"]["agent_tool_request_status"]
          tool_name: string
          updated_at?: string
        }
        Update: {
          agent_task_id?: string | null
          approval_item_id?: string | null
          approval_status?: Database["public"]["Enums"]["approval_status"]
          campaign_asset_id?: string | null
          campaign_id?: string | null
          created_at?: string
          crm_source_id?: string | null
          crm_source_type?: string | null
          error_message?: string | null
          handoff_type?: string
          id?: string
          persona_snapshot_id?: string | null
          prompt?: string | null
          requested_by_agent_id?: string
          result_summary?: string | null
          result_url?: string | null
          risk_level?: Database["public"]["Enums"]["agent_risk_level"]
          source_payload?: Json
          status?: Database["public"]["Enums"]["agent_tool_request_status"]
          tool_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tool_requests_agent_task_id_fkey"
            columns: ["agent_task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tool_requests_approval_item_id_fkey"
            columns: ["approval_item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tool_requests_campaign_asset_id_fkey"
            columns: ["campaign_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tool_requests_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tool_requests_persona_snapshot_id_fkey"
            columns: ["persona_snapshot_id"]
            isOneToOne: false
            referencedRelation: "persona_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tool_requests_requested_by_agent_id_fkey"
            columns: ["requested_by_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          allowed_actions: string[]
          blocked_actions: string[]
          created_at: string
          default_approval_policy: string
          description: string | null
          id: string
          key: string
          metadata: Json
          name: string
          org_id: string
          status: Database["public"]["Enums"]["agent_status"]
          system_instructions: string | null
          updated_at: string
        }
        Insert: {
          allowed_actions?: string[]
          blocked_actions?: string[]
          created_at?: string
          default_approval_policy?: string
          description?: string | null
          id?: string
          key: string
          metadata?: Json
          name: string
          org_id: string
          status?: Database["public"]["Enums"]["agent_status"]
          system_instructions?: string | null
          updated_at?: string
        }
        Update: {
          allowed_actions?: string[]
          blocked_actions?: string[]
          created_at?: string
          default_approval_policy?: string
          description?: string | null
          id?: string
          key?: string
          metadata?: Json
          name?: string
          org_id?: string
          status?: Database["public"]["Enums"]["agent_status"]
          system_instructions?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_events: {
        Row: {
          actor_user: string | null
          campaign_id: string | null
          cost_estimate_cents: number
          created_at: string
          id: string
          input_tokens: number | null
          metadata: Json
          model: string
          occurred_at: string
          org_id: string | null
          output_tokens: number | null
          service: Database["public"]["Enums"]["ai_usage_service"]
          task_id: string | null
          units: number | null
          workspace_id: string | null
        }
        Insert: {
          actor_user?: string | null
          campaign_id?: string | null
          cost_estimate_cents?: number
          created_at?: string
          id?: string
          input_tokens?: number | null
          metadata?: Json
          model: string
          occurred_at?: string
          org_id?: string | null
          output_tokens?: number | null
          service: Database["public"]["Enums"]["ai_usage_service"]
          task_id?: string | null
          units?: number | null
          workspace_id?: string | null
        }
        Update: {
          actor_user?: string | null
          campaign_id?: string | null
          cost_estimate_cents?: number
          created_at?: string
          id?: string
          input_tokens?: number | null
          metadata?: Json
          model?: string
          occurred_at?: string
          org_id?: string | null
          output_tokens?: number | null
          service?: Database["public"]["Enums"]["ai_usage_service"]
          task_id?: string | null
          units?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_snapshots: {
        Row: {
          created_at: string
          expires_at: string | null
          generated_at: string
          id: string
          payload: Json
          period_end: string | null
          period_start: string | null
          snapshot_key: string
          snapshot_type: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          generated_at?: string
          id?: string
          payload?: Json
          period_end?: string | null
          period_start?: string | null
          snapshot_key: string
          snapshot_type: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          generated_at?: string
          id?: string
          payload?: Json
          period_end?: string | null
          period_start?: string | null
          snapshot_key?: string
          snapshot_type?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          org_id: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          org_id: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          org_id?: string
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_decisions: {
        Row: {
          approval_item_id: string
          created_at: string
          decided_at: string
          decided_by: string
          decision: Database["public"]["Enums"]["approval_decision_kind"]
          decision_notes: string | null
          edited_output: string | null
          id: string
          metadata: Json
          next_status: Database["public"]["Enums"]["approval_status"]
          org_id: string
          previous_status: Database["public"]["Enums"]["approval_status"] | null
        }
        Insert: {
          approval_item_id: string
          created_at?: string
          decided_at?: string
          decided_by: string
          decision: Database["public"]["Enums"]["approval_decision_kind"]
          decision_notes?: string | null
          edited_output?: string | null
          id?: string
          metadata?: Json
          next_status: Database["public"]["Enums"]["approval_status"]
          org_id: string
          previous_status?:
            | Database["public"]["Enums"]["approval_status"]
            | null
        }
        Update: {
          approval_item_id?: string
          created_at?: string
          decided_at?: string
          decided_by?: string
          decision?: Database["public"]["Enums"]["approval_decision_kind"]
          decision_notes?: string | null
          edited_output?: string | null
          id?: string
          metadata?: Json
          next_status?: Database["public"]["Enums"]["approval_status"]
          org_id?: string
          previous_status?:
            | Database["public"]["Enums"]["approval_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_decisions_approval_item_id_fkey"
            columns: ["approval_item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_decisions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_items: {
        Row: {
          approval_required: boolean
          audit_payload: Json
          campaign_asset_id: string | null
          campaign_id: string | null
          company_id: string | null
          compliance_notes: string | null
          contact_id: string | null
          created_at: string
          decision_notes: string | null
          draft_output: string | null
          edited_output: string | null
          id: string
          item_type: string
          lead_id: string | null
          locked_until_approved: boolean
          org_id: string
          prompt_inputs: Json
          property_id: string | null
          reasoning_payload: Json
          requested_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_level: string
          status: Database["public"]["Enums"]["approval_status"]
          submitted_at: string
          updated_at: string
        }
        Insert: {
          approval_required?: boolean
          audit_payload?: Json
          campaign_asset_id?: string | null
          campaign_id?: string | null
          company_id?: string | null
          compliance_notes?: string | null
          contact_id?: string | null
          created_at?: string
          decision_notes?: string | null
          draft_output?: string | null
          edited_output?: string | null
          id?: string
          item_type: string
          lead_id?: string | null
          locked_until_approved?: boolean
          org_id: string
          prompt_inputs?: Json
          property_id?: string | null
          reasoning_payload?: Json
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level?: string
          status?: Database["public"]["Enums"]["approval_status"]
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          approval_required?: boolean
          audit_payload?: Json
          campaign_asset_id?: string | null
          campaign_id?: string | null
          company_id?: string | null
          compliance_notes?: string | null
          contact_id?: string | null
          created_at?: string
          decision_notes?: string | null
          draft_output?: string | null
          edited_output?: string | null
          id?: string
          item_type?: string
          lead_id?: string | null
          locked_until_approved?: boolean
          org_id?: string
          prompt_inputs?: Json
          property_id?: string | null
          reasoning_payload?: Json
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level?: string
          status?: Database["public"]["Enums"]["approval_status"]
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_items_campaign_asset_id_fkey"
            columns: ["campaign_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_items_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_items_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_items_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_recommendations: {
        Row: {
          agent: string
          approval_item_id: string
          created_at: string
          id: string
          metadata: Json
          org_id: string
          rationale: string | null
          recommendation: string
          risk_flags: string[]
          suggested_edits: string | null
        }
        Insert: {
          agent?: string
          approval_item_id: string
          created_at?: string
          id?: string
          metadata?: Json
          org_id: string
          rationale?: string | null
          recommendation: string
          risk_flags?: string[]
          suggested_edits?: string | null
        }
        Update: {
          agent?: string
          approval_item_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string
          rationale?: string | null
          recommendation?: string
          risk_flags?: string[]
          suggested_edits?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_recommendations_approval_item_id_fkey"
            columns: ["approval_item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_recommendations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      arc_conversation_shares: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          permission: string
          shared_by: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          permission?: string
          shared_by?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          permission?: string
          shared_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "arc_conversation_shares_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "arc_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      arc_conversations: {
        Row: {
          campaign_id: string | null
          created_at: string
          id: string
          last_message_at: string
          metadata: Json
          operator: string
          org_id: string
          owner_id: string | null
          pinned_at: string | null
          project_id: string | null
          status: string
          summary: string | null
          summary_through_message_id: string | null
          title: string
          updated_at: string
          visibility: string
          workspace_id: string | null
          workspace_permission: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string
          metadata?: Json
          operator?: string
          org_id: string
          owner_id?: string | null
          pinned_at?: string | null
          project_id?: string | null
          status?: string
          summary?: string | null
          summary_through_message_id?: string | null
          title?: string
          updated_at?: string
          visibility?: string
          workspace_id?: string | null
          workspace_permission?: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string
          metadata?: Json
          operator?: string
          org_id?: string
          owner_id?: string | null
          pinned_at?: string | null
          project_id?: string | null
          status?: string
          summary?: string | null
          summary_through_message_id?: string | null
          title?: string
          updated_at?: string
          visibility?: string
          workspace_id?: string | null
          workspace_permission?: string
        }
        Relationships: [
          {
            foreignKeyName: "arc_conversations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arc_conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arc_conversations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "arc_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arc_conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      arc_generated_skills: {
        Row: {
          asset_type: string | null
          command: string
          counter_example_asset_ids: Json
          created_at: string
          description: string
          evidence_tier: string
          exemplar_count: number
          generated_at: string
          id: string
          instructions: string
          key: string
          name: string
          org_id: string
          persona: string | null
          source_asset_ids: Json
          updated_at: string
        }
        Insert: {
          asset_type?: string | null
          command: string
          counter_example_asset_ids?: Json
          created_at?: string
          description: string
          evidence_tier: string
          exemplar_count?: number
          generated_at?: string
          id?: string
          instructions: string
          key: string
          name: string
          org_id: string
          persona?: string | null
          source_asset_ids?: Json
          updated_at?: string
        }
        Update: {
          asset_type?: string | null
          command?: string
          counter_example_asset_ids?: Json
          created_at?: string
          description?: string
          evidence_tier?: string
          exemplar_count?: number
          generated_at?: string
          id?: string
          instructions?: string
          key?: string
          name?: string
          org_id?: string
          persona?: string | null
          source_asset_ids?: Json
          updated_at?: string
        }
        Relationships: []
      }
      arc_instances: {
        Row: {
          brand_policy: Json
          created_at: string
          display_name: string
          id: string
          key: string
          memory_policy: string
          metadata: Json
          model_policy: Json
          org_id: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          brand_policy?: Json
          created_at?: string
          display_name?: string
          id?: string
          key?: string
          memory_policy?: string
          metadata?: Json
          model_policy?: Json
          org_id: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          brand_policy?: Json
          created_at?: string
          display_name?: string
          id?: string
          key?: string
          memory_policy?: string
          metadata?: Json
          model_policy?: Json
          org_id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "arc_instances_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arc_instances_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      arc_messages: {
        Row: {
          agent_task_id: string | null
          author_user_id: string | null
          body: string
          conversation_id: string
          created_at: string
          id: string
          mentions: Json
          metadata: Json
          org_id: string
          role: string
          status: string
          workspace_id: string | null
        }
        Insert: {
          agent_task_id?: string | null
          author_user_id?: string | null
          body?: string
          conversation_id: string
          created_at?: string
          id?: string
          mentions?: Json
          metadata?: Json
          org_id: string
          role: string
          status?: string
          workspace_id?: string | null
        }
        Update: {
          agent_task_id?: string | null
          author_user_id?: string | null
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          mentions?: Json
          metadata?: Json
          org_id?: string
          role?: string
          status?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "arc_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "arc_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arc_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arc_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      arc_project_shares: {
        Row: {
          created_at: string
          id: string
          permission: string
          project_id: string
          shared_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission?: string
          project_id: string
          shared_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission?: string
          project_id?: string
          shared_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "arc_project_shares_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "arc_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      arc_projects: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          name: string
          operator: string
          org_id: string
          owner_id: string | null
          updated_at: string
          visibility: string
          workspace_id: string | null
          workspace_permission: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          operator?: string
          org_id: string
          owner_id?: string | null
          updated_at?: string
          visibility?: string
          workspace_id?: string | null
          workspace_permission?: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          operator?: string
          org_id?: string
          owner_id?: string | null
          updated_at?: string
          visibility?: string
          workspace_id?: string | null
          workspace_permission?: string
        }
        Relationships: [
          {
            foreignKeyName: "arc_projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arc_projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      arc_saved_items: {
        Row: {
          body: string | null
          caption: string | null
          created_at: string
          id: string
          kind: string
          media_url: string | null
          note: string | null
          operator: string
          org_id: string
          promoted_asset_id: string | null
          promoted_campaign_id: string | null
          source_asset_id: string | null
          source_campaign_id: string | null
          source_conversation_id: string | null
          source_message_id: string | null
          title: string | null
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          body?: string | null
          caption?: string | null
          created_at?: string
          id?: string
          kind: string
          media_url?: string | null
          note?: string | null
          operator: string
          org_id: string
          promoted_asset_id?: string | null
          promoted_campaign_id?: string | null
          source_asset_id?: string | null
          source_campaign_id?: string | null
          source_conversation_id?: string | null
          source_message_id?: string | null
          title?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          body?: string | null
          caption?: string | null
          created_at?: string
          id?: string
          kind?: string
          media_url?: string | null
          note?: string | null
          operator?: string
          org_id?: string
          promoted_asset_id?: string | null
          promoted_campaign_id?: string | null
          source_asset_id?: string | null
          source_campaign_id?: string | null
          source_conversation_id?: string | null
          source_message_id?: string | null
          title?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "arc_saved_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arc_saved_items_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "arc_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arc_saved_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_kind: string
          actor_user_id: string | null
          created_at: string
          id: string
          ip_address: unknown
          metadata: Json
          org_id: string
          subject_id: string | null
          subject_table: string | null
          summary: string | null
          user_agent: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          actor_kind?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          org_id: string
          subject_id?: string | null
          subject_table?: string | null
          summary?: string | null
          user_agent?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          actor_kind?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          org_id?: string
          subject_id?: string | null
          subject_table?: string | null
          summary?: string | null
          user_agent?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audits: {
        Row: {
          brand: string
          competitors: string[]
          created_at: string
          description: string | null
          domain: string
          email: string
          error: string | null
          full_report: Json | null
          id: string
          industry: string
          preview_report: Json | null
          price_cents: number | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          brand: string
          competitors?: string[]
          created_at?: string
          description?: string | null
          domain: string
          email: string
          error?: string | null
          full_report?: Json | null
          id: string
          industry: string
          preview_report?: Json | null
          price_cents?: number | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string
          competitors?: string[]
          created_at?: string
          description?: string | null
          domain?: string
          email?: string
          error?: string | null
          full_report?: Json | null
          id?: string
          industry?: string
          preview_report?: Json | null
          price_cents?: number | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          subscription_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      business_profiles: {
        Row: {
          accent: string
          banned_phrases: Json
          brand_palette: Json
          created_at: string
          density: string
          description: string | null
          display_name: string
          favicon_url: string | null
          guardrails: Json
          id: string
          industry: string | null
          legal_name: string | null
          logo_url: string | null
          motion: string
          onboarding_completed_at: string | null
          org_id: string
          preferred_phrases: Json
          proof_points: Json
          service_areas: Json
          services: Json
          short_mark: string | null
          status: string
          tagline: string | null
          time_zone: string | null
          tone: string
          updated_at: string
          voice_guidance: string | null
          website_url: string | null
        }
        Insert: {
          accent?: string
          banned_phrases?: Json
          brand_palette?: Json
          created_at?: string
          density?: string
          description?: string | null
          display_name?: string
          favicon_url?: string | null
          guardrails?: Json
          id?: string
          industry?: string | null
          legal_name?: string | null
          logo_url?: string | null
          motion?: string
          onboarding_completed_at?: string | null
          org_id: string
          preferred_phrases?: Json
          proof_points?: Json
          service_areas?: Json
          services?: Json
          short_mark?: string | null
          status?: string
          tagline?: string | null
          time_zone?: string | null
          tone?: string
          updated_at?: string
          voice_guidance?: string | null
          website_url?: string | null
        }
        Update: {
          accent?: string
          banned_phrases?: Json
          brand_palette?: Json
          created_at?: string
          density?: string
          description?: string | null
          display_name?: string
          favicon_url?: string | null
          guardrails?: Json
          id?: string
          industry?: string | null
          legal_name?: string | null
          logo_url?: string | null
          motion?: string
          onboarding_completed_at?: string | null
          org_id?: string
          preferred_phrases?: Json
          proof_points?: Json
          service_areas?: Json
          services?: Json
          short_mark?: string | null
          status?: string
          tagline?: string | null
          time_zone?: string | null
          tone?: string
          updated_at?: string
          voice_guidance?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_assets: {
        Row: {
          approved_at: string | null
          approved_body: string | null
          approved_by: string | null
          asset_type: Database["public"]["Enums"]["campaign_asset_type"]
          audit_payload: Json
          campaign_id: string
          channel: string | null
          compliance_notes: string | null
          created_at: string
          dispatch_locked: boolean
          draft_body: string | null
          edited_body: string | null
          edited_fields: Json
          external_asset_id: string | null
          id: string
          org_id: string
          prompt_input: string | null
          prompt_inputs: Json
          reasoning_payload: Json
          source_system: string | null
          status: Database["public"]["Enums"]["approval_status"]
          title: string
          tool_source: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_body?: string | null
          approved_by?: string | null
          asset_type: Database["public"]["Enums"]["campaign_asset_type"]
          audit_payload?: Json
          campaign_id: string
          channel?: string | null
          compliance_notes?: string | null
          created_at?: string
          dispatch_locked?: boolean
          draft_body?: string | null
          edited_body?: string | null
          edited_fields?: Json
          external_asset_id?: string | null
          id?: string
          org_id: string
          prompt_input?: string | null
          prompt_inputs?: Json
          reasoning_payload?: Json
          source_system?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          title: string
          tool_source?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_body?: string | null
          approved_by?: string | null
          asset_type?: Database["public"]["Enums"]["campaign_asset_type"]
          audit_payload?: Json
          campaign_id?: string
          channel?: string | null
          compliance_notes?: string | null
          created_at?: string
          dispatch_locked?: boolean
          draft_body?: string | null
          edited_body?: string | null
          edited_fields?: Json
          external_asset_id?: string | null
          id?: string
          org_id?: string
          prompt_input?: string | null
          prompt_inputs?: Json
          reasoning_payload?: Json
          source_system?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          title?: string
          tool_source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_assets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_assets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_audiences: {
        Row: {
          audience_name: string
          campaign_id: string
          created_at: string
          estimated_size: number | null
          exclusion_rules: Json
          id: string
          inclusion_rules: Json
          persona: string
          reasoning_payload: Json
          relationship_stage: string | null
          updated_at: string
        }
        Insert: {
          audience_name: string
          campaign_id: string
          created_at?: string
          estimated_size?: number | null
          exclusion_rules?: Json
          id?: string
          inclusion_rules?: Json
          persona: string
          reasoning_payload?: Json
          relationship_stage?: string | null
          updated_at?: string
        }
        Update: {
          audience_name?: string
          campaign_id?: string
          created_at?: string
          estimated_size?: number | null
          exclusion_rules?: Json
          id?: string
          inclusion_rules?: Json
          persona?: string
          reasoning_payload?: Json
          relationship_stage?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_audiences_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_dispatches: {
        Row: {
          approval_item_id: string | null
          audience_count: number | null
          campaign_asset_id: string | null
          campaign_id: string
          channel: string | null
          contact_id: string | null
          created_at: string
          dispatched_at: string | null
          id: string
          idempotency_key: string | null
          last_error: string | null
          org_id: string
          payload: Json
          provider: string | null
          provider_message_id: string | null
          recipient_summary: string | null
          result_note: string | null
          scheduled_for: string | null
          status: Database["public"]["Enums"]["campaign_dispatch_status"]
          updated_at: string
        }
        Insert: {
          approval_item_id?: string | null
          audience_count?: number | null
          campaign_asset_id?: string | null
          campaign_id: string
          channel?: string | null
          contact_id?: string | null
          created_at?: string
          dispatched_at?: string | null
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          org_id: string
          payload?: Json
          provider?: string | null
          provider_message_id?: string | null
          recipient_summary?: string | null
          result_note?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["campaign_dispatch_status"]
          updated_at?: string
        }
        Update: {
          approval_item_id?: string | null
          audience_count?: number | null
          campaign_asset_id?: string | null
          campaign_id?: string
          channel?: string | null
          contact_id?: string | null
          created_at?: string
          dispatched_at?: string | null
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          org_id?: string
          payload?: Json
          provider?: string | null
          provider_message_id?: string | null
          recipient_summary?: string | null
          result_note?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["campaign_dispatch_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_dispatches_approval_item_id_fkey"
            columns: ["approval_item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_dispatches_campaign_asset_id_fkey"
            columns: ["campaign_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_dispatches_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_dispatches_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_dispatches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_events: {
        Row: {
          actor: string | null
          approval_item_id: string | null
          campaign_asset_id: string | null
          campaign_id: string
          created_at: string
          detail: string | null
          event_type: Database["public"]["Enums"]["campaign_event_type"]
          id: string
          occurred_at: string
          org_id: string
          payload: Json
        }
        Insert: {
          actor?: string | null
          approval_item_id?: string | null
          campaign_asset_id?: string | null
          campaign_id: string
          created_at?: string
          detail?: string | null
          event_type: Database["public"]["Enums"]["campaign_event_type"]
          id?: string
          occurred_at?: string
          org_id: string
          payload?: Json
        }
        Update: {
          actor?: string | null
          approval_item_id?: string | null
          campaign_asset_id?: string | null
          campaign_id?: string
          created_at?: string
          detail?: string | null
          event_type?: Database["public"]["Enums"]["campaign_event_type"]
          id?: string
          occurred_at?: string
          org_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "campaign_events_approval_item_id_fkey"
            columns: ["approval_item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_events_campaign_asset_id_fkey"
            columns: ["campaign_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_results: {
        Row: {
          calls: number | null
          campaign_asset_id: string | null
          campaign_id: string
          channel: string | null
          clicks: number | null
          created_at: string
          forms: number | null
          id: string
          impressions: number | null
          jobs: number | null
          leads: number | null
          metadata: Json
          org_id: string
          period_end: string
          period_start: string
          spend_cents: number | null
          updated_at: string
          won_revenue_cents: number | null
        }
        Insert: {
          calls?: number | null
          campaign_asset_id?: string | null
          campaign_id: string
          channel?: string | null
          clicks?: number | null
          created_at?: string
          forms?: number | null
          id?: string
          impressions?: number | null
          jobs?: number | null
          leads?: number | null
          metadata?: Json
          org_id: string
          period_end: string
          period_start: string
          spend_cents?: number | null
          updated_at?: string
          won_revenue_cents?: number | null
        }
        Update: {
          calls?: number | null
          campaign_asset_id?: string | null
          campaign_id?: string
          channel?: string | null
          clicks?: number | null
          created_at?: string
          forms?: number | null
          id?: string
          impressions?: number | null
          jobs?: number | null
          leads?: number | null
          metadata?: Json
          org_id?: string
          period_end?: string
          period_start?: string
          spend_cents?: number | null
          updated_at?: string
          won_revenue_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_results_campaign_asset_id_fkey"
            columns: ["campaign_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_results_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_results_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_shares: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          permission: string
          shared_by: string | null
          user_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          permission?: string
          shared_by?: string | null
          user_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          permission?: string
          shared_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_shares_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          approval_item_id: string | null
          audience_summary: string | null
          audit_payload: Json
          campaign_phase: string
          campaign_theme: string | null
          company_id: string | null
          compliance_notes: string | null
          contact_id: string | null
          created_at: string
          external_campaign_id: string | null
          id: string
          launch_locked: boolean
          lead_id: string | null
          name: string
          objective: string | null
          offer_summary: string | null
          org_id: string
          owner: string | null
          owner_id: string | null
          persona: string
          property_id: string | null
          reasoning_payload: Json
          restoration_focus:
            | Database["public"]["Enums"]["restoration_focus"]
            | null
          source_signal: Json
          source_system: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          updated_at: string
          visibility: string
          workspace_id: string | null
          workspace_permission: string
        }
        Insert: {
          approval_item_id?: string | null
          audience_summary?: string | null
          audit_payload?: Json
          campaign_phase?: string
          campaign_theme?: string | null
          company_id?: string | null
          compliance_notes?: string | null
          contact_id?: string | null
          created_at?: string
          external_campaign_id?: string | null
          id?: string
          launch_locked?: boolean
          lead_id?: string | null
          name: string
          objective?: string | null
          offer_summary?: string | null
          org_id: string
          owner?: string | null
          owner_id?: string | null
          persona: string
          property_id?: string | null
          reasoning_payload?: Json
          restoration_focus?:
            | Database["public"]["Enums"]["restoration_focus"]
            | null
          source_signal?: Json
          source_system?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          updated_at?: string
          visibility?: string
          workspace_id?: string | null
          workspace_permission?: string
        }
        Update: {
          approval_item_id?: string | null
          audience_summary?: string | null
          audit_payload?: Json
          campaign_phase?: string
          campaign_theme?: string | null
          company_id?: string | null
          compliance_notes?: string | null
          contact_id?: string | null
          created_at?: string
          external_campaign_id?: string | null
          id?: string
          launch_locked?: boolean
          lead_id?: string | null
          name?: string
          objective?: string | null
          offer_summary?: string | null
          org_id?: string
          owner?: string | null
          owner_id?: string | null
          persona?: string
          property_id?: string | null
          reasoning_payload?: Json
          restoration_focus?:
            | Database["public"]["Enums"]["restoration_focus"]
            | null
          source_signal?: Json
          source_system?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          updated_at?: string
          visibility?: string
          workspace_id?: string | null
          workspace_permission?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_approval_item_id_fkey"
            columns: ["approval_item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      capacity_snapshots: {
        Row: {
          active_claims_count: number
          capacity_state: string
          created_at: string
          id: string
          observed_at: string
          payload: Json
          source_system: string
        }
        Insert: {
          active_claims_count: number
          capacity_state: string
          created_at?: string
          id?: string
          observed_at?: string
          payload?: Json
          source_system?: string
        }
        Update: {
          active_claims_count?: number
          capacity_state?: string
          created_at?: string
          id?: string
          observed_at?: string
          payload?: Json
          source_system?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          created_at: string
          email: string | null
          id: string
          metadata: Json
          name: string
          org_id: string
          origin: string
          partner_tier: string | null
          persona: string
          phone: string | null
          review_status: string
          status: Database["public"]["Enums"]["company_status"]
          updated_at: string
          website_url: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          metadata?: Json
          name: string
          org_id: string
          origin?: string
          partner_tier?: string | null
          persona?: string
          phone?: string | null
          review_status?: string
          status?: Database["public"]["Enums"]["company_status"]
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          metadata?: Json
          name?: string
          org_id?: string
          origin?: string
          partner_tier?: string | null
          persona?: string
          phone?: string | null
          review_status?: string
          status?: Database["public"]["Enums"]["company_status"]
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_apps: {
        Row: {
          audit_payload: Json
          category: string
          created_at: string
          id: string
          name: string
          pricing_notes: string | null
          research_status: string
          takeaways: string | null
          target_user: string | null
          updated_at: string
        }
        Insert: {
          audit_payload?: Json
          category: string
          created_at?: string
          id?: string
          name: string
          pricing_notes?: string | null
          research_status?: string
          takeaways?: string | null
          target_user?: string | null
          updated_at?: string
        }
        Update: {
          audit_payload?: Json
          category?: string
          created_at?: string
          id?: string
          name?: string
          pricing_notes?: string | null
          research_status?: string
          takeaways?: string | null
          target_user?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      competitor_campaigns: {
        Row: {
          ad_creatives: Json
          captured_at: string
          channel_mix: Json
          competitor_name: string
          competitor_url: string | null
          created_at: string
          created_by_agent_id: string | null
          est_spend: string | null
          id: string
          org_id: string
          persona: string | null
          raw_payload: Json
          run_id: string | null
          source: string
          status: string
          summary: string | null
          top_keywords: string[]
          updated_at: string
        }
        Insert: {
          ad_creatives?: Json
          captured_at?: string
          channel_mix?: Json
          competitor_name: string
          competitor_url?: string | null
          created_at?: string
          created_by_agent_id?: string | null
          est_spend?: string | null
          id?: string
          org_id: string
          persona?: string | null
          raw_payload?: Json
          run_id?: string | null
          source: string
          status?: string
          summary?: string | null
          top_keywords?: string[]
          updated_at?: string
        }
        Update: {
          ad_creatives?: Json
          captured_at?: string
          channel_mix?: Json
          competitor_name?: string
          competitor_url?: string | null
          created_at?: string
          created_by_agent_id?: string | null
          est_spend?: string | null
          id?: string
          org_id?: string
          persona?: string | null
          raw_payload?: Json
          run_id?: string | null
          source?: string
          status?: string
          summary?: string | null
          top_keywords?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_campaigns_created_by_agent_id_fkey"
            columns: ["created_by_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_features: {
        Row: {
          adoption_status: string
          competitor_app_id: string
          created_at: string
          feature_category: string | null
          feature_name: string
          growth_engine_application: string | null
          id: string
          observed_pattern: string | null
          reasoning_payload: Json
          updated_at: string
        }
        Insert: {
          adoption_status?: string
          competitor_app_id: string
          created_at?: string
          feature_category?: string | null
          feature_name: string
          growth_engine_application?: string | null
          id?: string
          observed_pattern?: string | null
          reasoning_payload?: Json
          updated_at?: string
        }
        Update: {
          adoption_status?: string
          competitor_app_id?: string
          created_at?: string
          feature_category?: string | null
          feature_name?: string
          growth_engine_application?: string | null
          id?: string
          observed_pattern?: string | null
          reasoning_payload?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_features_competitor_app_id_fkey"
            columns: ["competitor_app_id"]
            isOneToOne: false
            referencedRelation: "competitor_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      connections: {
        Row: {
          config: Json
          created_at: string
          credential_ref: string | null
          enabled: boolean
          env_var: string | null
          id: string
          kind: Database["public"]["Enums"]["connection_kind"]
          label: string
          last_test_error: string | null
          last_test_ok: boolean | null
          last_tested_at: string | null
          last_used_at: string | null
          org_id: string
          provider: Database["public"]["Enums"]["connection_provider"]
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          credential_ref?: string | null
          enabled?: boolean
          env_var?: string | null
          id?: string
          kind: Database["public"]["Enums"]["connection_kind"]
          label: string
          last_test_error?: string | null
          last_test_ok?: boolean | null
          last_tested_at?: string | null
          last_used_at?: string | null
          org_id: string
          provider: Database["public"]["Enums"]["connection_provider"]
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          credential_ref?: string | null
          enabled?: boolean
          env_var?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["connection_kind"]
          label?: string
          last_test_error?: string | null
          last_test_ok?: boolean | null
          last_tested_at?: string | null
          last_used_at?: string | null
          org_id?: string
          provider?: Database["public"]["Enums"]["connection_provider"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_spend_budgets: {
        Row: {
          cap_cents: number
          created_at: string
          id: string
          org_id: string | null
          period: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          cap_cents?: number
          created_at?: string
          id?: string
          org_id?: string | null
          period?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          cap_cents?: number
          created_at?: string
          id?: string
          org_id?: string | null
          period?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_spend_budgets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_spend_budgets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_usage_events: {
        Row: {
          connector_key: string
          context: Json
          cost_estimate_cents: number
          created_at: string
          id: string
          metadata: Json
          occurred_at: string
          org_id: string | null
          units: number
          workspace_id: string | null
        }
        Insert: {
          connector_key: string
          context?: Json
          cost_estimate_cents?: number
          created_at?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          org_id?: string | null
          units?: number
          workspace_id?: string | null
        }
        Update: {
          connector_key?: string
          context?: Json
          cost_estimate_cents?: number
          created_at?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          org_id?: string | null
          units?: number
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connector_usage_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_usage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company_id: string | null
          created_at: string
          email: string | null
          first_name: string | null
          full_name: string | null
          id: string
          last_name: string | null
          metadata: Json
          org_id: string
          origin: string
          persona: string
          phone: string | null
          review_status: string
          status: Database["public"]["Enums"]["contact_status"]
          title: string | null
          updated_at: string
          email_unsubscribed_at: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          metadata?: Json
          org_id: string
          origin?: string
          persona?: string
          phone?: string | null
          review_status?: string
          status?: Database["public"]["Enums"]["contact_status"]
          title?: string | null
          updated_at?: string
          email_unsubscribed_at?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          metadata?: Json
          org_id?: string
          origin?: string
          persona?: string
          phone?: string | null
          review_status?: string
          status?: Database["public"]["Enums"]["contact_status"]
          title?: string | null
          updated_at?: string
          email_unsubscribed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_activities: {
        Row: {
          activity_type: Database["public"]["Enums"]["crm_activity_type"]
          actor_kind: Database["public"]["Enums"]["actor_kind"]
          actor_name: string | null
          detail: string | null
          entity_id: string
          entity_type: Database["public"]["Enums"]["crm_entity_type"]
          id: string
          metadata: Json
          occurred_at: string
          org_id: string
          summary: string
        }
        Insert: {
          activity_type: Database["public"]["Enums"]["crm_activity_type"]
          actor_kind: Database["public"]["Enums"]["actor_kind"]
          actor_name?: string | null
          detail?: string | null
          entity_id: string
          entity_type: Database["public"]["Enums"]["crm_entity_type"]
          id?: string
          metadata?: Json
          occurred_at?: string
          org_id: string
          summary: string
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["crm_activity_type"]
          actor_kind?: Database["public"]["Enums"]["actor_kind"]
          actor_name?: string | null
          detail?: string | null
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["crm_entity_type"]
          id?: string
          metadata?: Json
          occurred_at?: string
          org_id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notes: {
        Row: {
          author_kind: Database["public"]["Enums"]["actor_kind"]
          author_name: string | null
          body: string
          created_at: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["crm_entity_type"]
          id: string
          is_internal: boolean
          is_pinned: boolean
          org_id: string
          updated_at: string
        }
        Insert: {
          author_kind: Database["public"]["Enums"]["actor_kind"]
          author_name?: string | null
          body: string
          created_at?: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["crm_entity_type"]
          id?: string
          is_internal?: boolean
          is_pinned?: boolean
          org_id: string
          updated_at?: string
        }
        Update: {
          author_kind?: Database["public"]["Enums"]["actor_kind"]
          author_name?: string | null
          body?: string
          created_at?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["crm_entity_type"]
          id?: string
          is_internal?: boolean
          is_pinned?: boolean
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tasks: {
        Row: {
          assignee_kind: Database["public"]["Enums"]["actor_kind"] | null
          assignee_name: string | null
          author_kind: Database["public"]["Enums"]["actor_kind"]
          author_name: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["crm_entity_type"] | null
          id: string
          org_id: string
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_kind?: Database["public"]["Enums"]["actor_kind"] | null
          assignee_name?: string | null
          author_kind: Database["public"]["Enums"]["actor_kind"]
          author_name?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["crm_entity_type"] | null
          id?: string
          org_id: string
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_kind?: Database["public"]["Enums"]["actor_kind"] | null
          assignee_name?: string | null
          author_kind?: Database["public"]["Enums"]["actor_kind"]
          author_name?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["crm_entity_type"] | null
          id?: string
          org_id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_events: {
        Row: {
          campaign_asset_id: string | null
          campaign_id: string | null
          channel: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string
          direction: string | null
          event_type: string
          external_event_id: string | null
          id: string
          job_id: string | null
          lead_id: string | null
          metadata: Json
          occurred_at: string
          org_id: string
          outcome_id: string | null
          property_id: string | null
          reasoning_payload: Json
          source_system: string | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          campaign_asset_id?: string | null
          campaign_id?: string | null
          channel?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          direction?: string | null
          event_type: string
          external_event_id?: string | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          metadata?: Json
          occurred_at?: string
          org_id: string
          outcome_id?: string | null
          property_id?: string | null
          reasoning_payload?: Json
          source_system?: string | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          campaign_asset_id?: string | null
          campaign_id?: string | null
          channel?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          direction?: string | null
          event_type?: string
          external_event_id?: string | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          metadata?: Json
          occurred_at?: string
          org_id?: string
          outcome_id?: string | null
          property_id?: string | null
          reasoning_payload?: Json
          source_system?: string | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_events_campaign_asset_id_fkey"
            columns: ["campaign_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_outcome_id_fkey"
            columns: ["outcome_id"]
            isOneToOne: false
            referencedRelation: "outcomes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          actor: string
          created_at: string
          id: string
          occurred_at: string
          org_id: string
          payload: Json
          subject_id: string
          subject_type: Database["public"]["Enums"]["event_subject_type"]
          type: string
        }
        Insert: {
          actor: string
          created_at?: string
          id?: string
          occurred_at?: string
          org_id: string
          payload?: Json
          subject_id: string
          subject_type: Database["public"]["Enums"]["event_subject_type"]
          type: string
        }
        Update: {
          actor?: string
          created_at?: string
          id?: string
          occurred_at?: string
          org_id?: string
          payload?: Json
          subject_id?: string
          subject_type?: Database["public"]["Enums"]["event_subject_type"]
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      external_object_mappings: {
        Row: {
          created_at: string
          external_object_id: string
          external_object_type: string
          external_system_id: string
          id: string
          last_modified_at: string | null
          local_id: string
          local_table: string
          metadata: Json
          sync_hash: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_object_id: string
          external_object_type: string
          external_system_id: string
          id?: string
          last_modified_at?: string | null
          local_id: string
          local_table: string
          metadata?: Json
          sync_hash?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_object_id?: string
          external_object_type?: string
          external_system_id?: string
          id?: string
          last_modified_at?: string | null
          local_id?: string
          local_table?: string
          metadata?: Json
          sync_hash?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_object_mappings_external_system_id_fkey"
            columns: ["external_system_id"]
            isOneToOne: false
            referencedRelation: "external_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      external_systems: {
        Row: {
          base_url: string | null
          config: Json
          created_at: string
          id: string
          status: Database["public"]["Enums"]["integration_status"]
          system_key: string
          system_kind: Database["public"]["Enums"]["external_system_kind"]
          updated_at: string
        }
        Insert: {
          base_url?: string | null
          config?: Json
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["integration_status"]
          system_key: string
          system_kind: Database["public"]["Enums"]["external_system_kind"]
          updated_at?: string
        }
        Update: {
          base_url?: string | null
          config?: Json
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["integration_status"]
          system_key?: string
          system_kind?: Database["public"]["Enums"]["external_system_kind"]
          updated_at?: string
        }
        Relationships: []
      }
      google_drive_connections: {
        Row: {
          connected_at: string
          connected_by: string
          connected_email: string | null
          created_at: string
          id: string
          last_error: string | null
          last_import_at: string | null
          org_id: string
          refresh_token_ref: string
          scopes: string[]
          updated_at: string
        }
        Insert: {
          connected_at?: string
          connected_by: string
          connected_email?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_import_at?: string | null
          org_id: string
          refresh_token_ref: string
          scopes?: string[]
          updated_at?: string
        }
        Update: {
          connected_at?: string
          connected_by?: string
          connected_email?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_import_at?: string | null
          org_id?: string
          refresh_token_ref?: string
          scopes?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_drive_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      google_drive_sources: {
        Row: {
          connected_by: string
          created_at: string
          drive_folder_id: string
          drive_folder_name: string | null
          id: string
          last_error: string | null
          last_imported_count: number
          last_seen_file_ids: string[]
          last_synced_at: string | null
          library_folder_id: string | null
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          connected_by: string
          created_at?: string
          drive_folder_id: string
          drive_folder_name?: string | null
          id?: string
          last_error?: string | null
          last_imported_count?: number
          last_seen_file_ids?: string[]
          last_synced_at?: string | null
          library_folder_id?: string | null
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          connected_by?: string
          created_at?: string
          drive_folder_id?: string
          drive_folder_name?: string | null
          id?: string
          last_error?: string | null
          last_imported_count?: number
          last_seen_file_ids?: string[]
          last_synced_at?: string | null
          library_folder_id?: string | null
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_drive_sources_library_folder_id_fkey"
            columns: ["library_folder_id"]
            isOneToOne: false
            referencedRelation: "media_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_drive_sources_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      guardrail_findings: {
        Row: {
          agent_task_id: string | null
          approval_item_id: string | null
          campaign_asset_id: string | null
          created_at: string
          finding_message: string
          guardrail_rule_id: string | null
          id: string
          matched_text: string | null
          metadata: Json
          scope: Database["public"]["Enums"]["guardrail_scope"]
          severity: Database["public"]["Enums"]["guardrail_severity"]
          status: string
        }
        Insert: {
          agent_task_id?: string | null
          approval_item_id?: string | null
          campaign_asset_id?: string | null
          created_at?: string
          finding_message: string
          guardrail_rule_id?: string | null
          id?: string
          matched_text?: string | null
          metadata?: Json
          scope: Database["public"]["Enums"]["guardrail_scope"]
          severity: Database["public"]["Enums"]["guardrail_severity"]
          status?: string
        }
        Update: {
          agent_task_id?: string | null
          approval_item_id?: string | null
          campaign_asset_id?: string | null
          created_at?: string
          finding_message?: string
          guardrail_rule_id?: string | null
          id?: string
          matched_text?: string | null
          metadata?: Json
          scope?: Database["public"]["Enums"]["guardrail_scope"]
          severity?: Database["public"]["Enums"]["guardrail_severity"]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardrail_findings_agent_task_id_fkey"
            columns: ["agent_task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardrail_findings_approval_item_id_fkey"
            columns: ["approval_item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardrail_findings_campaign_asset_id_fkey"
            columns: ["campaign_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardrail_findings_guardrail_rule_id_fkey"
            columns: ["guardrail_rule_id"]
            isOneToOne: false
            referencedRelation: "guardrail_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      guardrail_rules: {
        Row: {
          created_at: string
          failure_message: string
          id: string
          matcher_payload: Json
          org_id: string
          pattern: string | null
          rule_key: string
          scope: Database["public"]["Enums"]["guardrail_scope"]
          severity: Database["public"]["Enums"]["guardrail_severity"]
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          failure_message: string
          id?: string
          matcher_payload?: Json
          org_id: string
          pattern?: string | null
          rule_key: string
          scope: Database["public"]["Enums"]["guardrail_scope"]
          severity?: Database["public"]["Enums"]["guardrail_severity"]
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          failure_message?: string
          id?: string
          matcher_payload?: Json
          org_id?: string
          pattern?: string | null
          rule_key?: string
          scope?: Database["public"]["Enums"]["guardrail_scope"]
          severity?: Database["public"]["Enums"]["guardrail_severity"]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardrail_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_registry: {
        Row: {
          audit_payload: Json
          category: string
          config: Json
          connection_notes: string | null
          created_at: string
          id: string
          name: string
          owner: string | null
          provider: string
          status: Database["public"]["Enums"]["integration_status"]
          sync_direction: string | null
          updated_at: string
        }
        Insert: {
          audit_payload?: Json
          category: string
          config?: Json
          connection_notes?: string | null
          created_at?: string
          id?: string
          name: string
          owner?: string | null
          provider: string
          status?: Database["public"]["Enums"]["integration_status"]
          sync_direction?: string | null
          updated_at?: string
        }
        Update: {
          audit_payload?: Json
          category?: string
          config?: Json
          connection_notes?: string | null
          created_at?: string
          id?: string
          name?: string
          owner?: string | null
          provider?: string
          status?: Database["public"]["Enums"]["integration_status"]
          sync_direction?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      integrity_findings: {
        Row: {
          created_at: string
          detail: Json
          detected_at: string
          id: string
          org_id: string
          resolved_at: string | null
          rule_key: string
          severity: Database["public"]["Enums"]["integrity_severity"]
          subject_id: string
          subject_type: Database["public"]["Enums"]["event_subject_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          detected_at?: string
          id?: string
          org_id: string
          resolved_at?: string | null
          rule_key: string
          severity?: Database["public"]["Enums"]["integrity_severity"]
          subject_id: string
          subject_type: Database["public"]["Enums"]["event_subject_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          detail?: Json
          detected_at?: string
          id?: string
          org_id?: string
          resolved_at?: string | null
          rule_key?: string
          severity?: Database["public"]["Enums"]["integrity_severity"]
          subject_id?: string
          subject_type?: Database["public"]["Enums"]["event_subject_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrity_findings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          company_id: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          estimated_revenue_cents: number | null
          id: string
          job_number: string | null
          lead_id: string | null
          metadata: Json
          org_id: string
          persona: string
          property_id: string | null
          scheduled_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          estimated_revenue_cents?: number | null
          id?: string
          job_number?: string | null
          lead_id?: string | null
          metadata?: Json
          org_id: string
          persona?: string
          property_id?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          estimated_revenue_cents?: number | null
          id?: string
          job_number?: string | null
          lead_id?: string | null
          metadata?: Json
          org_id?: string
          persona?: string
          property_id?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      journey_identities: {
        Row: {
          anonymous_id: string
          contact_id: string | null
          created_at: string
          first_seen_at: string
          id: string
          last_seen_at: string
          opted_out_at: string | null
          org_id: string
          resolution: string
          updated_at: string
        }
        Insert: {
          anonymous_id: string
          contact_id?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          opted_out_at?: string | null
          org_id: string
          resolution?: string
          updated_at?: string
        }
        Update: {
          anonymous_id?: string
          contact_id?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          opted_out_at?: string | null
          org_id?: string
          resolution?: string
          updated_at?: string
        }
        Relationships: []
      }
      journey_touchpoints: {
        Row: {
          campaign_asset_id: string | null
          campaign_id: string | null
          channel: string | null
          contact_id: string | null
          created_at: string
          direction: string
          external_ref: string | null
          id: string
          identity_id: string
          is_conversion: boolean
          kind: string
          metadata: Json
          occurred_at: string
          org_id: string
          source: string
          summary: string | null
          value_cents: number | null
        }
        Insert: {
          campaign_asset_id?: string | null
          campaign_id?: string | null
          channel?: string | null
          contact_id?: string | null
          created_at?: string
          direction?: string
          external_ref?: string | null
          id?: string
          identity_id: string
          is_conversion?: boolean
          kind: string
          metadata?: Json
          occurred_at?: string
          org_id: string
          source?: string
          summary?: string | null
          value_cents?: number | null
        }
        Update: {
          campaign_asset_id?: string | null
          campaign_id?: string | null
          channel?: string | null
          contact_id?: string | null
          created_at?: string
          direction?: string
          external_ref?: string | null
          id?: string
          identity_id?: string
          is_conversion?: boolean
          kind?: string
          metadata?: Json
          occurred_at?: string
          org_id?: string
          source?: string
          summary?: string | null
          value_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "journey_touchpoints_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "journey_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_edges: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          from_node_id: string
          id: string
          org_id: string
          props: Json
          relation: string
          source: string | null
          to_node_id: string
          trust_tier: Database["public"]["Enums"]["knowledge_trust_tier"]
          updated_at: string
          weight: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          from_node_id: string
          id?: string
          org_id: string
          props?: Json
          relation: string
          source?: string | null
          to_node_id: string
          trust_tier?: Database["public"]["Enums"]["knowledge_trust_tier"]
          updated_at?: string
          weight?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          from_node_id?: string
          id?: string
          org_id?: string
          props?: Json
          relation?: string
          source?: string | null
          to_node_id?: string
          trust_tier?: Database["public"]["Enums"]["knowledge_trust_tier"]
          updated_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_edges_from_node_id_fkey"
            columns: ["from_node_id"]
            isOneToOne: false
            referencedRelation: "knowledge_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_edges_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_edges_to_node_id_fkey"
            columns: ["to_node_id"]
            isOneToOne: false
            referencedRelation: "knowledge_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_nodes: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body: string | null
          confidence: number | null
          created_at: string
          created_by: string | null
          embedding: string | null
          id: string
          key: string | null
          kind: string
          label: string
          org_id: string
          persona: string | null
          props: Json
          ref_id: string | null
          ref_table: string | null
          source: string | null
          source_reference: string | null
          summary: string | null
          tags: string[]
          trust_tier: Database["public"]["Enums"]["knowledge_trust_tier"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          embedding?: string | null
          id?: string
          key?: string | null
          kind: string
          label: string
          org_id: string
          persona?: string | null
          props?: Json
          ref_id?: string | null
          ref_table?: string | null
          source?: string | null
          source_reference?: string | null
          summary?: string | null
          tags?: string[]
          trust_tier?: Database["public"]["Enums"]["knowledge_trust_tier"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          embedding?: string | null
          id?: string
          key?: string | null
          kind?: string
          label?: string
          org_id?: string
          persona?: string | null
          props?: Json
          ref_id?: string | null
          ref_table?: string | null
          source?: string | null
          source_reference?: string | null
          summary?: string | null
          tags?: string[]
          trust_tier?: Database["public"]["Enums"]["knowledge_trust_tier"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_nodes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          agent_confidence: number | null
          attributed_asset_id: string | null
          attributed_campaign_id: string | null
          attribution_channel: string | null
          attribution_method: string | null
          attribution_utm: Json
          company_id: string | null
          contact_id: string | null
          created_at: string
          external_lead_id: string | null
          id: string
          lead_score: number
          loss_signals: string[]
          loss_summary: string | null
          matched_non_target_keywords: string[]
          matched_target_keywords: string[]
          metadata: Json
          org_id: string
          origin: string
          persona: string
          property_id: string | null
          received_at: string
          review_status: string
          routing_recommendation: Database["public"]["Enums"]["routing_recommendation"]
          source: string
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
        }
        Insert: {
          agent_confidence?: number | null
          attributed_asset_id?: string | null
          attributed_campaign_id?: string | null
          attribution_channel?: string | null
          attribution_method?: string | null
          attribution_utm?: Json
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          external_lead_id?: string | null
          id?: string
          lead_score?: number
          loss_signals?: string[]
          loss_summary?: string | null
          matched_non_target_keywords?: string[]
          matched_target_keywords?: string[]
          metadata?: Json
          org_id: string
          origin?: string
          persona: string
          property_id?: string | null
          received_at?: string
          review_status?: string
          routing_recommendation?: Database["public"]["Enums"]["routing_recommendation"]
          source: string
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
        }
        Update: {
          agent_confidence?: number | null
          attributed_asset_id?: string | null
          attributed_campaign_id?: string | null
          attribution_channel?: string | null
          attribution_method?: string | null
          attribution_utm?: Json
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          external_lead_id?: string | null
          id?: string
          lead_score?: number
          loss_signals?: string[]
          loss_summary?: string | null
          matched_non_target_keywords?: string[]
          matched_target_keywords?: string[]
          metadata?: Json
          org_id?: string
          origin?: string
          persona?: string
          property_id?: string | null
          received_at?: string
          review_status?: string
          routing_recommendation?: Database["public"]["Enums"]["routing_recommendation"]
          source?: string
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_attributed_asset_id_fkey"
            columns: ["attributed_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_attributed_campaign_id_fkey"
            columns: ["attributed_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          available_to_arc: boolean
          byte_size: number | null
          content_type: string
          created_at: string
          duration_seconds: number | null
          file_name: string
          folder_id: string | null
          height: number | null
          id: string
          kind: string
          org_id: string
          provenance: Json
          public_url: string
          risk_flags: string[]
          source: string
          storage_path: string
          tags: string[]
          updated_at: string
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          available_to_arc?: boolean
          byte_size?: number | null
          content_type: string
          created_at?: string
          duration_seconds?: number | null
          file_name: string
          folder_id?: string | null
          height?: number | null
          id?: string
          kind: string
          org_id: string
          provenance?: Json
          public_url: string
          risk_flags?: string[]
          source?: string
          storage_path: string
          tags?: string[]
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          available_to_arc?: boolean
          byte_size?: number | null
          content_type?: string
          created_at?: string
          duration_seconds?: number | null
          file_name?: string
          folder_id?: string | null
          height?: number | null
          id?: string
          kind?: string
          org_id?: string
          provenance?: Json
          public_url?: string
          risk_flags?: string[]
          source?: string
          storage_path?: string
          tags?: string[]
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "media_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      media_folders: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          org_id: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          org_id: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_folders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "media_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      next_best_actions: {
        Row: {
          action_type: string
          approval_item_id: string | null
          approval_required: boolean
          audit_payload: Json
          campaign_id: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string
          due_at: string | null
          id: string
          lead_id: string | null
          org_id: string
          persona_snapshot_id: string | null
          priority: number
          property_id: string | null
          reason: string | null
          reasoning_payload: Json
          recommendation: string | null
          status: Database["public"]["Enums"]["next_best_action_status"]
          title: string
          updated_at: string
        }
        Insert: {
          action_type: string
          approval_item_id?: string | null
          approval_required?: boolean
          audit_payload?: Json
          campaign_id?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          lead_id?: string | null
          org_id: string
          persona_snapshot_id?: string | null
          priority?: number
          property_id?: string | null
          reason?: string | null
          reasoning_payload?: Json
          recommendation?: string | null
          status?: Database["public"]["Enums"]["next_best_action_status"]
          title: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          approval_item_id?: string | null
          approval_required?: boolean
          audit_payload?: Json
          campaign_id?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          lead_id?: string | null
          org_id?: string
          persona_snapshot_id?: string | null
          priority?: number
          property_id?: string | null
          reason?: string | null
          reasoning_payload?: Json
          recommendation?: string | null
          status?: Database["public"]["Enums"]["next_best_action_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "next_best_actions_approval_item_id_fkey"
            columns: ["approval_item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_best_actions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_best_actions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_best_actions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_best_actions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_best_actions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_best_actions_persona_snapshot_id_fkey"
            columns: ["persona_snapshot_id"]
            isOneToOne: false
            referencedRelation: "persona_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_best_actions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      nurture_enrollments: {
        Row: {
          company_id: string | null
          contact_id: string | null
          created_at: string
          frequency_cap_until: string | null
          id: string
          last_message_at: string | null
          lead_id: string | null
          metadata: Json
          nurture_sequence_id: string
          status: Database["public"]["Enums"]["nurture_enrollment_status"]
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          frequency_cap_until?: string | null
          id?: string
          last_message_at?: string | null
          lead_id?: string | null
          metadata?: Json
          nurture_sequence_id: string
          status?: Database["public"]["Enums"]["nurture_enrollment_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          frequency_cap_until?: string | null
          id?: string
          last_message_at?: string | null
          lead_id?: string | null
          metadata?: Json
          nurture_sequence_id?: string
          status?: Database["public"]["Enums"]["nurture_enrollment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurture_enrollments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurture_enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurture_enrollments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurture_enrollments_nurture_sequence_id_fkey"
            columns: ["nurture_sequence_id"]
            isOneToOne: false
            referencedRelation: "nurture_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      nurture_sequences: {
        Row: {
          activated_at: string | null
          campaign_id: string | null
          created_at: string
          id: string
          name: string
          persona: string
          sequence_key: string
          sequence_payload: Json
          status: Database["public"]["Enums"]["nurture_sequence_status"]
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          campaign_id?: string | null
          created_at?: string
          id?: string
          name: string
          persona: string
          sequence_key: string
          sequence_payload?: Json
          status?: Database["public"]["Enums"]["nurture_sequence_status"]
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          campaign_id?: string | null
          created_at?: string
          id?: string
          name?: string
          persona?: string
          sequence_key?: string
          sequence_payload?: Json
          status?: Database["public"]["Enums"]["nurture_sequence_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurture_sequences_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          agent_task_id: string | null
          campaign_id: string | null
          confidence: number
          created_at: string
          detected_by: string
          dismissed_at: string | null
          dismissed_reason: string | null
          evidence: Json
          id: string
          kind: string
          org_id: string
          recommended_action: string
          recommended_campaign_type: string | null
          snoozed_until: string | null
          status: Database["public"]["Enums"]["opportunity_status"]
          subject_id: string
          subject_type: string
          summary: string
          title: string
          updated_at: string
          urgency: Database["public"]["Enums"]["opportunity_urgency"]
        }
        Insert: {
          agent_task_id?: string | null
          campaign_id?: string | null
          confidence?: number
          created_at?: string
          detected_by?: string
          dismissed_at?: string | null
          dismissed_reason?: string | null
          evidence?: Json
          id?: string
          kind: string
          org_id: string
          recommended_action?: string
          recommended_campaign_type?: string | null
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["opportunity_status"]
          subject_id: string
          subject_type: string
          summary?: string
          title: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["opportunity_urgency"]
        }
        Update: {
          agent_task_id?: string | null
          campaign_id?: string | null
          confidence?: number
          created_at?: string
          detected_by?: string
          dismissed_at?: string | null
          dismissed_reason?: string | null
          evidence?: Json
          id?: string
          kind?: string
          org_id?: string
          recommended_action?: string
          recommended_campaign_type?: string | null
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["opportunity_status"]
          subject_id?: string
          subject_type?: string
          summary?: string
          title?: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["opportunity_urgency"]
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_onboarding_state: {
        Row: {
          brand_captured_at: string | null
          created_at: string
          dismissed_at: string | null
          org_id: string
          updated_at: string
        }
        Insert: {
          brand_captured_at?: string | null
          created_at?: string
          dismissed_at?: string | null
          org_id: string
          updated_at?: string
        }
        Update: {
          brand_captured_at?: string | null
          created_at?: string
          dismissed_at?: string | null
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_onboarding_state_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_plans: {
        Row: {
          created_at: string
          current_period_end: string | null
          monthly_cap_cents: number | null
          org_id: string
          plan_tier: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          monthly_cap_cents?: number | null
          org_id: string
          plan_tier?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          monthly_cap_cents?: number | null
          org_id?: string
          plan_tier?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_plans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          invited_email: string | null
          joined_at: string | null
          org_id: string
          role: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          invited_email?: string | null
          joined_at?: string | null
          org_id: string
          role?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          invited_email?: string | null
          joined_at?: string | null
          org_id?: string
          role?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          branding: Json
          created_at: string
          id: string
          name: string
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          updated_at: string
        }
        Insert: {
          branding?: Json
          created_at?: string
          id?: string
          name: string
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Update: {
          branding?: Json
          created_at?: string
          id?: string
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Relationships: []
      }
      outcomes: {
        Row: {
          closed_at: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string
          gross_margin_cents: number | null
          gross_revenue_cents: number | null
          id: string
          job_id: string | null
          lead_id: string | null
          metadata: Json
          org_id: string
          persona: string
          property_id: string | null
          status: Database["public"]["Enums"]["outcome_status"]
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          gross_margin_cents?: number | null
          gross_revenue_cents?: number | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          metadata?: Json
          org_id: string
          persona?: string
          property_id?: string | null
          status?: Database["public"]["Enums"]["outcome_status"]
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          gross_margin_cents?: number | null
          gross_revenue_cents?: number | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          metadata?: Json
          org_id?: string
          persona?: string
          property_id?: string | null
          status?: Database["public"]["Enums"]["outcome_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outcomes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcomes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcomes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcomes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcomes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcomes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_health_snapshots: {
        Row: {
          company_id: string | null
          contact_id: string | null
          created_at: string
          health_score: number
          id: string
          last_referral_at: string | null
          persona: string
          reasoning_payload: Json
          recommended_action: string | null
          relationship_stage: string | null
          risk_flags: string[]
          trailing_90_day_referrals: number
          trailing_90_day_won_revenue_cents: number | null
        }
        Insert: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          health_score: number
          id?: string
          last_referral_at?: string | null
          persona: string
          reasoning_payload?: Json
          recommended_action?: string | null
          relationship_stage?: string | null
          risk_flags?: string[]
          trailing_90_day_referrals?: number
          trailing_90_day_won_revenue_cents?: number | null
        }
        Update: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          health_score?: number
          id?: string
          last_referral_at?: string | null
          persona?: string
          reasoning_payload?: Json
          recommended_action?: string | null
          relationship_stage?: string | null
          risk_flags?: string[]
          trailing_90_day_referrals?: number
          trailing_90_day_won_revenue_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_health_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_health_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_referral_submissions: {
        Row: {
          company_id: string | null
          contact_id: string | null
          created_at: string
          customer_payload: Json
          id: string
          lead_id: string | null
          loss_type_classification: string
          notification_payload: Json
          partner_referral_token_id: string | null
          property_id: string | null
          rejection_reason: string | null
          status: string
          submitted_at: string
        }
        Insert: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          customer_payload?: Json
          id?: string
          lead_id?: string | null
          loss_type_classification: string
          notification_payload?: Json
          partner_referral_token_id?: string | null
          property_id?: string | null
          rejection_reason?: string | null
          status?: string
          submitted_at?: string
        }
        Update: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          customer_payload?: Json
          id?: string
          lead_id?: string | null
          loss_type_classification?: string
          notification_payload?: Json
          partner_referral_token_id?: string | null
          property_id?: string | null
          rejection_reason?: string | null
          status?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_referral_submissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_referral_submissions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_referral_submissions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_referral_submissions_partner_referral_token_id_fkey"
            columns: ["partner_referral_token_id"]
            isOneToOne: false
            referencedRelation: "partner_referral_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_referral_submissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_referral_tokens: {
        Row: {
          company_id: string
          contact_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          label: string | null
          last_used_at: string | null
          status: string
          token_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          contact_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          status?: string
          token_id?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          contact_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          status?: string
          token_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_referral_tokens_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_referral_tokens_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_definitions: {
        Row: {
          audience_type: string
          created_at: string
          id: string
          is_active: boolean
          key: string
          label: string
          metadata: Json
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          audience_type: string
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          metadata?: Json
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          audience_type?: string
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          metadata?: Json
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "persona_definitions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_knowledge_entries: {
        Row: {
          body: string
          created_at: string
          entry_type: string
          id: string
          metadata: Json
          org_id: string
          persona: string
          priority: number
          section_key: string
          source_reference: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          entry_type: string
          id?: string
          metadata?: Json
          org_id: string
          persona: string
          priority?: number
          section_key: string
          source_reference?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          entry_type?: string
          id?: string
          metadata?: Json
          org_id?: string
          persona?: string
          priority?: number
          section_key?: string
          source_reference?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "persona_knowledge_entries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_snapshots: {
        Row: {
          audit_payload: Json
          behavior_context: Json
          campaign_id: string | null
          capacity_context: Json
          channel_context: Json
          company_id: string | null
          confidence_score: number | null
          contact_id: string | null
          created_at: string
          dominant_loss_pattern: string | null
          hyper_persona_summary: string | null
          id: string
          is_current: boolean
          job_id: string | null
          lead_id: string | null
          message_context: Json
          message_posture: string | null
          next_best_action: string | null
          org_id: string
          outcome_id: string | null
          persona: string
          preferred_channel: string | null
          property_id: string | null
          reasoning_payload: Json
          recommended_offer: string | null
          relationship_context: Json
          relationship_stage: string | null
          risk_flags: string[]
          situation_context: Json
          snapshot_version: number
          source_events: Json
          source_hash: string | null
          updated_at: string
          value_context: Json
          value_tier: string | null
        }
        Insert: {
          audit_payload?: Json
          behavior_context?: Json
          campaign_id?: string | null
          capacity_context?: Json
          channel_context?: Json
          company_id?: string | null
          confidence_score?: number | null
          contact_id?: string | null
          created_at?: string
          dominant_loss_pattern?: string | null
          hyper_persona_summary?: string | null
          id?: string
          is_current?: boolean
          job_id?: string | null
          lead_id?: string | null
          message_context?: Json
          message_posture?: string | null
          next_best_action?: string | null
          org_id: string
          outcome_id?: string | null
          persona: string
          preferred_channel?: string | null
          property_id?: string | null
          reasoning_payload?: Json
          recommended_offer?: string | null
          relationship_context?: Json
          relationship_stage?: string | null
          risk_flags?: string[]
          situation_context?: Json
          snapshot_version?: number
          source_events?: Json
          source_hash?: string | null
          updated_at?: string
          value_context?: Json
          value_tier?: string | null
        }
        Update: {
          audit_payload?: Json
          behavior_context?: Json
          campaign_id?: string | null
          capacity_context?: Json
          channel_context?: Json
          company_id?: string | null
          confidence_score?: number | null
          contact_id?: string | null
          created_at?: string
          dominant_loss_pattern?: string | null
          hyper_persona_summary?: string | null
          id?: string
          is_current?: boolean
          job_id?: string | null
          lead_id?: string | null
          message_context?: Json
          message_posture?: string | null
          next_best_action?: string | null
          org_id?: string
          outcome_id?: string | null
          persona?: string
          preferred_channel?: string | null
          property_id?: string | null
          reasoning_payload?: Json
          recommended_offer?: string | null
          relationship_context?: Json
          relationship_stage?: string | null
          risk_flags?: string[]
          situation_context?: Json
          snapshot_version?: number
          source_events?: Json
          source_hash?: string | null
          updated_at?: string
          value_context?: Json
          value_tier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "persona_snapshots_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persona_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persona_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persona_snapshots_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persona_snapshots_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persona_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persona_snapshots_outcome_id_fkey"
            columns: ["outcome_id"]
            isOneToOne: false
            referencedRelation: "outcomes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persona_snapshots_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      personalization_rules: {
        Row: {
          created_at: string
          created_by: string | null
          hero_text: string | null
          id: string
          landing_context: Json
          persona: string
          primary_cta: string | null
          priority: number
          proof_points: string[]
          rule_key: string
          status: string
          trigger_conditions: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hero_text?: string | null
          id?: string
          landing_context?: Json
          persona: string
          primary_cta?: string | null
          priority?: number
          proof_points?: string[]
          rule_key: string
          status?: string
          trigger_conditions?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hero_text?: string | null
          id?: string
          landing_context?: Json
          persona?: string
          primary_cta?: string | null
          priority?: number
          proof_points?: string[]
          rule_key?: string
          status?: string
          trigger_conditions?: Json
          updated_at?: string
        }
        Relationships: []
      }
      personas: {
        Row: {
          angle: string
          arc_activity: Json
          audience: string
          audience_share: number
          best_timing: string
          channel: string
          created_at: string
          cta: string
          goals: Json
          id: string
          initials: string
          is_active: boolean
          live: boolean
          name: string
          next_action: string
          objections: Json
          org_id: string
          profile: string
          proof_points: Json
          quote: string
          sample_message: Json
          score: number
          score_trend: Json
          segment: string
          signal_drivers: Json
          signals: Json
          slug: string
          stage: string
          updated_at: string
        }
        Insert: {
          angle?: string
          arc_activity?: Json
          audience?: string
          audience_share?: number
          best_timing?: string
          channel?: string
          created_at?: string
          cta?: string
          goals?: Json
          id?: string
          initials?: string
          is_active?: boolean
          live?: boolean
          name: string
          next_action?: string
          objections?: Json
          org_id: string
          profile?: string
          proof_points?: Json
          quote?: string
          sample_message?: Json
          score?: number
          score_trend?: Json
          segment?: string
          signal_drivers?: Json
          signals?: Json
          slug: string
          stage?: string
          updated_at?: string
        }
        Update: {
          angle?: string
          arc_activity?: Json
          audience?: string
          audience_share?: number
          best_timing?: string
          channel?: string
          created_at?: string
          cta?: string
          goals?: Json
          id?: string
          initials?: string
          is_active?: boolean
          live?: boolean
          name?: string
          next_action?: string
          objections?: Json
          org_id?: string
          profile?: string
          proof_points?: Json
          quote?: string
          sample_message?: Json
          score?: number
          score_trend?: Json
          segment?: string
          signal_drivers?: Json
          signals?: Json
          slug?: string
          stage?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          idempotency_key: string
          payload: Json
          processed_at: string | null
          received_at: string
          rejection_reason: string | null
          schema_version: string
          source_system_id: string | null
          source_system_key: string
          status: Database["public"]["Enums"]["platform_event_status"]
          subject_id: string | null
          subject_type: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          idempotency_key: string
          payload?: Json
          processed_at?: string | null
          received_at?: string
          rejection_reason?: string | null
          schema_version?: string
          source_system_id?: string | null
          source_system_key: string
          status?: Database["public"]["Enums"]["platform_event_status"]
          subject_id?: string | null
          subject_type?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          payload?: Json
          processed_at?: string | null
          received_at?: string
          rejection_reason?: string | null
          schema_version?: string
          source_system_id?: string | null
          source_system_key?: string
          status?: Database["public"]["Enums"]["platform_event_status"]
          subject_id?: string | null
          subject_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_events_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "external_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          metadata: Json
          timezone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          metadata?: Json
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          metadata?: Json
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          city: string
          company_id: string | null
          contact_id: string | null
          created_at: string
          id: string
          metadata: Json
          org_id: string
          origin: string
          persona: string
          postal_code: string
          property_type: string | null
          review_status: string
          state: string
          street_line_1: string
          street_line_2: string | null
          updated_at: string
        }
        Insert: {
          city: string
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id: string
          origin?: string
          persona?: string
          postal_code: string
          property_type?: string | null
          review_status?: string
          state: string
          street_line_1: string
          street_line_2?: string | null
          updated_at?: string
        }
        Update: {
          city?: string
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string
          origin?: string
          persona?: string
          postal_code?: string
          property_type?: string | null
          review_status?: string
          state?: string
          street_line_1?: string
          street_line_2?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rejected_intake_events: {
        Row: {
          created_at: string
          errors: Json
          external_event_id: string | null
          id: string
          loss_signals: string[]
          payload: Json
          persona_attempted: string | null
          received_at: string
          rejection_code: string | null
          rejection_message: string | null
          source: string | null
          source_system: string | null
          status: Database["public"]["Enums"]["intake_audit_status"]
        }
        Insert: {
          created_at?: string
          errors?: Json
          external_event_id?: string | null
          id?: string
          loss_signals?: string[]
          payload?: Json
          persona_attempted?: string | null
          received_at?: string
          rejection_code?: string | null
          rejection_message?: string | null
          source?: string | null
          source_system?: string | null
          status?: Database["public"]["Enums"]["intake_audit_status"]
        }
        Update: {
          created_at?: string
          errors?: Json
          external_event_id?: string | null
          id?: string
          loss_signals?: string[]
          payload?: Json
          persona_attempted?: string | null
          received_at?: string
          rejection_code?: string | null
          rejection_message?: string | null
          source?: string | null
          source_system?: string | null
          status?: Database["public"]["Enums"]["intake_audit_status"]
        }
        Relationships: []
      }
      routing_decisions: {
        Row: {
          confidence: number
          created_at: string
          decided_at: string
          decided_by: string
          decision: Database["public"]["Enums"]["routing_decision_kind"]
          id: string
          lead_id: string
          org_id: string
          rationale: Json
          sla_target_minutes: number | null
        }
        Insert: {
          confidence: number
          created_at?: string
          decided_at?: string
          decided_by: string
          decision: Database["public"]["Enums"]["routing_decision_kind"]
          id?: string
          lead_id: string
          org_id: string
          rationale?: Json
          sla_target_minutes?: number | null
        }
        Update: {
          confidence?: number
          created_at?: string
          decided_at?: string
          decided_by?: string
          decision?: Database["public"]["Enums"]["routing_decision_kind"]
          id?: string
          lead_id?: string
          org_id?: string
          rationale?: Json
          sla_target_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "routing_decisions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_decisions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      score_weight_configs: {
        Row: {
          activated_at: string | null
          applies_to: string
          created_at: string
          created_by: string | null
          id: string
          key: string
          notes: string | null
          status: string
          updated_at: string
          weights: Json
        }
        Insert: {
          activated_at?: string | null
          applies_to: string
          created_at?: string
          created_by?: string | null
          id?: string
          key: string
          notes?: string | null
          status?: string
          updated_at?: string
          weights?: Json
        }
        Update: {
          activated_at?: string | null
          applies_to?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key?: string
          notes?: string | null
          status?: string
          updated_at?: string
          weights?: Json
        }
        Relationships: []
      }
      social_accounts: {
        Row: {
          account_name: string
          created_at: string
          external_account_id: string | null
          id: string
          last_verified_at: string | null
          oauth_secret_ref: string | null
          permissions_payload: Json
          platform: Database["public"]["Enums"]["social_platform"]
          status: Database["public"]["Enums"]["integration_status"]
          updated_at: string
          verification_state: string
        }
        Insert: {
          account_name: string
          created_at?: string
          external_account_id?: string | null
          id?: string
          last_verified_at?: string | null
          oauth_secret_ref?: string | null
          permissions_payload?: Json
          platform: Database["public"]["Enums"]["social_platform"]
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
          verification_state?: string
        }
        Update: {
          account_name?: string
          created_at?: string
          external_account_id?: string | null
          id?: string
          last_verified_at?: string | null
          oauth_secret_ref?: string | null
          permissions_payload?: Json
          platform?: Database["public"]["Enums"]["social_platform"]
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
          verification_state?: string
        }
        Relationships: []
      }
      social_posts: {
        Row: {
          approval_item_id: string | null
          body_text: string
          campaign_asset_id: string | null
          campaign_id: string | null
          channels: Database["public"]["Enums"]["social_platform"][]
          created_at: string
          created_by: string | null
          failure_message: string | null
          id: string
          media_urls: string[]
          publish_result_payload: Json
          published_at: string | null
          scheduled_at: string | null
          status: Database["public"]["Enums"]["social_post_status"]
          updated_at: string
        }
        Insert: {
          approval_item_id?: string | null
          body_text: string
          campaign_asset_id?: string | null
          campaign_id?: string | null
          channels?: Database["public"]["Enums"]["social_platform"][]
          created_at?: string
          created_by?: string | null
          failure_message?: string | null
          id?: string
          media_urls?: string[]
          publish_result_payload?: Json
          published_at?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["social_post_status"]
          updated_at?: string
        }
        Update: {
          approval_item_id?: string | null
          body_text?: string
          campaign_asset_id?: string | null
          campaign_id?: string | null
          channels?: Database["public"]["Enums"]["social_platform"][]
          created_at?: string
          created_by?: string | null
          failure_message?: string | null
          id?: string
          media_urls?: string[]
          publish_result_payload?: Json
          published_at?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["social_post_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_approval_item_id_fkey"
            columns: ["approval_item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_campaign_asset_id_fkey"
            columns: ["campaign_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      software_research_notes: {
        Row: {
          competitor_app_id: string | null
          created_at: string
          decision: string | null
          evidence_payload: Json
          id: string
          note_type: string
          source_name: string | null
          source_url: string | null
          summary: string
          updated_at: string
        }
        Insert: {
          competitor_app_id?: string | null
          created_at?: string
          decision?: string | null
          evidence_payload?: Json
          id?: string
          note_type?: string
          source_name?: string | null
          source_url?: string | null
          summary: string
          updated_at?: string
        }
        Update: {
          competitor_app_id?: string | null
          created_at?: string
          decision?: string | null
          evidence_payload?: Json
          id?: string
          note_type?: string
          source_name?: string | null
          source_url?: string | null
          summary?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "software_research_notes_competitor_app_id_fkey"
            columns: ["competitor_app_id"]
            isOneToOne: false
            referencedRelation: "competitor_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_conflicts: {
        Row: {
          conflict_type: string
          created_at: string
          external_object_mapping_id: string | null
          id: string
          incoming_payload: Json
          local_payload: Json
          platform_event_id: string | null
          resolution_strategy: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          conflict_type: string
          created_at?: string
          external_object_mapping_id?: string | null
          id?: string
          incoming_payload?: Json
          local_payload?: Json
          platform_event_id?: string | null
          resolution_strategy?: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          conflict_type?: string
          created_at?: string
          external_object_mapping_id?: string | null
          id?: string
          incoming_payload?: Json
          local_payload?: Json
          platform_event_id?: string | null
          resolution_strategy?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_conflicts_external_object_mapping_id_fkey"
            columns: ["external_object_mapping_id"]
            isOneToOne: false
            referencedRelation: "external_object_mappings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_conflicts_platform_event_id_fkey"
            columns: ["platform_event_id"]
            isOneToOne: false
            referencedRelation: "platform_events"
            referencedColumns: ["id"]
          },
        ]
      }
      task_labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          status: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          color: string
          created_at?: string
          id?: string
          name: string
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      tracking_links: {
        Row: {
          campaign_asset_id: string | null
          campaign_id: string | null
          contact_id: string | null
          created_at: string
          destination_url: string
          encryption_scheme: string
          expires_at: string | null
          id: string
          nurture_sequence_id: string | null
          token_hash: string
          utm_payload: Json
        }
        Insert: {
          campaign_asset_id?: string | null
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string
          destination_url: string
          encryption_scheme?: string
          expires_at?: string | null
          id?: string
          nurture_sequence_id?: string | null
          token_hash: string
          utm_payload?: Json
        }
        Update: {
          campaign_asset_id?: string | null
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string
          destination_url?: string
          encryption_scheme?: string
          expires_at?: string | null
          id?: string
          nurture_sequence_id?: string | null
          token_hash?: string
          utm_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "tracking_links_campaign_asset_id_fkey"
            columns: ["campaign_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_links_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_links_nurture_sequence_id_fkey"
            columns: ["nurture_sequence_id"]
            isOneToOne: false
            referencedRelation: "nurture_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_notes: {
        Row: {
          author: string
          body: string
          created_at: string
          folder: string
          id: string
          org_id: string
          slug: string
          status: Database["public"]["Enums"]["vault_note_status"]
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          author?: string
          body?: string
          created_at?: string
          folder: string
          id?: string
          org_id: string
          slug: string
          status?: Database["public"]["Enums"]["vault_note_status"]
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          author?: string
          body?: string
          created_at?: string
          folder?: string
          id?: string
          org_id?: string
          slug?: string
          status?: Database["public"]["Enums"]["vault_note_status"]
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      visitor_persona_contexts: {
        Row: {
          created_at: string
          expires_at: string
          first_url: string | null
          id: string
          inferred_persona: string | null
          last_url: string | null
          personalization_rule_id: string | null
          referrer: string | null
          session_key: string
          updated_at: string
          utm_payload: Json
        }
        Insert: {
          created_at?: string
          expires_at: string
          first_url?: string | null
          id?: string
          inferred_persona?: string | null
          last_url?: string | null
          personalization_rule_id?: string | null
          referrer?: string | null
          session_key: string
          updated_at?: string
          utm_payload?: Json
        }
        Update: {
          created_at?: string
          expires_at?: string
          first_url?: string | null
          id?: string
          inferred_persona?: string | null
          last_url?: string | null
          personalization_rule_id?: string | null
          referrer?: string | null
          session_key?: string
          updated_at?: string
          utm_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "visitor_persona_contexts_personalization_rule_id_fkey"
            columns: ["personalization_rule_id"]
            isOneToOne: false
            referencedRelation: "personalization_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      weather_event_targets: {
        Row: {
          company_id: string | null
          contact_id: string | null
          created_at: string
          distance_miles: number | null
          id: string
          lead_id: string | null
          outbound_dispatch_id: string | null
          property_id: string | null
          suppressed_reason: string | null
          weather_event_id: string
        }
        Insert: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          distance_miles?: number | null
          id?: string
          lead_id?: string | null
          outbound_dispatch_id?: string | null
          property_id?: string | null
          suppressed_reason?: string | null
          weather_event_id: string
        }
        Update: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          distance_miles?: number | null
          id?: string
          lead_id?: string | null
          outbound_dispatch_id?: string | null
          property_id?: string | null
          suppressed_reason?: string | null
          weather_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weather_event_targets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_event_targets_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_event_targets_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_event_targets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_event_targets_weather_event_id_fkey"
            columns: ["weather_event_id"]
            isOneToOne: false
            referencedRelation: "weather_events"
            referencedColumns: ["id"]
          },
        ]
      }
      weather_events: {
        Row: {
          alert_type: string
          created_at: string
          ends_at: string | null
          external_event_id: string | null
          id: string
          latitude: number | null
          longitude: number | null
          processed_at: string | null
          radius_miles: number
          raw_payload: Json
          severity: string | null
          source_system: string
          starts_at: string | null
          status: Database["public"]["Enums"]["weather_event_status"]
          zip_codes: string[]
        }
        Insert: {
          alert_type: string
          created_at?: string
          ends_at?: string | null
          external_event_id?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          processed_at?: string | null
          radius_miles?: number
          raw_payload?: Json
          severity?: string | null
          source_system: string
          starts_at?: string | null
          status?: Database["public"]["Enums"]["weather_event_status"]
          zip_codes?: string[]
        }
        Update: {
          alert_type?: string
          created_at?: string
          ends_at?: string | null
          external_event_id?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          processed_at?: string | null
          radius_miles?: number
          raw_payload?: Json
          severity?: string | null
          source_system?: string
          starts_at?: string | null
          status?: Database["public"]["Enums"]["weather_event_status"]
          zip_codes?: string[]
        }
        Relationships: []
      }
      workspace_connectors: {
        Row: {
          config: Json
          connector_key: string
          created_at: string
          credential_ref: string | null
          enabled: boolean
          id: string
          last_test_error: string | null
          last_test_ok: boolean | null
          last_tested_at: string | null
          org_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          config?: Json
          connector_key: string
          created_at?: string
          credential_ref?: string | null
          enabled?: boolean
          id?: string
          last_test_error?: string | null
          last_test_ok?: boolean | null
          last_tested_at?: string | null
          org_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          config?: Json
          connector_key?: string
          created_at?: string
          credential_ref?: string | null
          enabled?: boolean
          id?: string
          last_test_error?: string | null
          last_test_ok?: boolean | null
          last_tested_at?: string | null
          org_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      workspace_invites: {
        Row: {
          code_hash: string
          created_at: string
          expires_at: string | null
          id: string
          invited_by: string | null
          invited_email: string | null
          org_id: string
          role: string
          status: string
          updated_at: string
          used_at: string | null
          used_by: string | null
          workspace_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          invited_email?: string | null
          org_id: string
          role?: string
          status?: string
          updated_at?: string
          used_at?: string | null
          used_by?: string | null
          workspace_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          invited_email?: string | null
          org_id?: string
          role?: string
          status?: string
          updated_at?: string
          used_at?: string | null
          used_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_media_config: {
        Row: {
          config: Json
          created_at: string
          id: string
          org_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          org_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          org_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      waitlist_signups: {
        Row: {
          attribution: Json
          created_at: string
          email: string
          id: string
          source: string
        }
        Insert: {
          attribution?: Json
          created_at?: string
          email: string
          id?: string
          source?: string
        }
        Update: {
          attribution?: Json
          created_at?: string
          email?: string
          id?: string
          source?: string
        }
        Relationships: []
      }
      workspace_memberships: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          invited_email: string | null
          joined_at: string | null
          org_id: string
          role: string
          status: string
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          invited_email?: string | null
          joined_at?: string | null
          org_id: string
          role?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          invited_email?: string | null
          joined_at?: string | null
          org_id?: string
          role?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          attribution: Json
          accent_key: string | null
          created_at: string
          created_by: string | null
          id: string
          key: string
          logo_url: string | null
          metadata: Json
          name: string
          org_id: string
          settings: Json
          short_label: string | null
          slug: string
          status: string
          subtitle: string | null
          updated_at: string
          workspace_type: string
        }
        Insert: {
          attribution?: Json
          accent_key?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          key?: string
          logo_url?: string | null
          metadata?: Json
          name: string
          org_id: string
          settings?: Json
          short_label?: string | null
          slug: string
          status?: string
          subtitle?: string | null
          updated_at?: string
          workspace_type?: string
        }
        Update: {
          attribution?: Json
          accent_key?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          key?: string
          logo_url?: string | null
          metadata?: Json
          name?: string
          org_id?: string
          settings?: Json
          short_label?: string | null
          slug?: string
          status?: string
          subtitle?: string | null
          updated_at?: string
          workspace_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      arc_append_message_step: {
        Args: {
          p_agent_task_id: string
          p_at: string
          p_label: string
          p_status: string
        }
        Returns: boolean
      }
      arc_complete_message: {
        Args: {
          p_body: string
          p_mentions?: Json
          p_message_id: string
          p_metadata?: Json
        }
        Returns: boolean
      }
      arc_create_vault_secret: {
        Args: { new_description: string; new_name: string; new_secret: string }
        Returns: string
      }
      arc_read_vault_secret: { Args: { secret_id: string }; Returns: string }
      arc_stream_message_reasoning: {
        Args: { p_agent_task_id: string; p_reasoning: string }
        Returns: boolean
      }
      check_agent_task_tenancy_constraints: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          ok: boolean
        }[]
      }
      match_knowledge_nodes: {
        Args: {
          match_count: number
          match_org_id: string
          query_embedding: string
          tiers: string[]
        }
        Returns: {
          distance: number
          id: string
          kind: string
          label: string
          summary: string
          tags: string[]
          trust_tier: string
        }[]
      }
    }
    Enums: {
      actor_kind: "human" | "agent" | "system"
      ad_spend_decision_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "applied"
        | "failed"
        | "reverted"
        | "canceled"
      agent_permission_type: "allowed" | "blocked"
      agent_risk_level: "low" | "medium" | "high" | "blocked"
      agent_run_status:
        | "queued"
        | "running"
        | "completed"
        | "failed"
        | "canceled"
      agent_status:
        | "draft"
        | "ready"
        | "running"
        | "paused"
        | "blocked"
        | "disabled"
      agent_task_priority: "low" | "medium" | "high" | "urgent"
      agent_task_status:
        | "queued"
        | "running"
        | "blocked"
        | "needs_approval"
        | "completed"
        | "failed"
        | "canceled"
      agent_tool_request_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "ready_to_run"
        | "running"
        | "completed"
        | "failed"
        | "rejected"
        | "archived"
      ai_usage_service: "arc_claude" | "gemini_image" | "gemini_video"
      approval_decision_kind:
        | "approved"
        | "declined"
        | "revision_requested"
        | "archived"
        | "blocked"
        | "reverted"
      approval_status:
        | "draft"
        | "needs_compliance"
        | "pending_approval"
        | "pending_owner_approval"
        | "approved"
        | "declined"
        | "rejected"
        | "revision_requested"
        | "blocked"
        | "needs_revision"
        | "archived"
      campaign_asset_type:
        | "landing_page"
        | "search_ad"
        | "social_ad"
        | "display_ad"
        | "google_business_post"
        | "email"
        | "sms"
        | "video_prompt"
        | "image_prompt"
        | "one_pager"
        | "referral_packet"
        | "review_response"
        | "script"
        | "other"
      campaign_dispatch_status:
        | "queued"
        | "scheduled"
        | "sent"
        | "delivered"
        | "failed"
        | "canceled"
      campaign_event_type:
        | "created"
        | "brief_created"
        | "asset_generated"
        | "approval_submitted"
        | "approval_decided"
        | "exported"
        | "launched"
        | "paused"
        | "archived"
        | "result_recorded"
        | "campaign_launched"
        | "asset_deployed"
        | "reopened"
        | "operator_directive"
        | "dispatch_queued"
        | "dispatch_sent"
        | "dispatch_delivered"
        | "dispatch_failed"
        | "dispatch_canceled"
        | "asset_edited"
      campaign_status:
        | "draft"
        | "briefing"
        | "generating"
        | "pending_approval"
        | "approved"
        | "active"
        | "paused"
        | "archived"
        | "blocked"
      company_status: "active" | "inactive" | "archived"
      connection_kind: "email" | "social" | "storage"
      connection_provider:
        | "resend"
        | "instagram"
        | "facebook"
        | "linkedin"
        | "x"
        | "google_drive"
      contact_status: "active" | "inactive" | "do_not_contact" | "archived"
      crm_activity_type:
        | "note_added"
        | "status_changed"
        | "call_logged"
        | "email_logged"
        | "sms_logged"
        | "meeting_logged"
        | "task_created"
        | "task_completed"
        | "record_created"
        | "record_updated"
        | "ai_recommendation"
        | "approval_requested"
        | "approval_decided"
        | "converted"
        | "file_added"
      crm_entity_type:
        | "company"
        | "contact"
        | "property"
        | "lead"
        | "job"
        | "outcome"
        | "campaign"
      dispatch_status:
        | "queued"
        | "blocked_pending_approval"
        | "blocked_compliance"
        | "dispatched"
        | "failed"
        | "skipped"
        | "canceled"
      event_subject_type:
        | "company"
        | "contact"
        | "property"
        | "lead"
        | "job"
        | "outcome"
      external_system_kind:
        | "marketing_platform"
        | "manager_app"
        | "business_development_app"
        | "ad_platform"
        | "weather_provider"
        | "social_platform"
        | "email_platform"
        | "sms_platform"
        | "other"
      guardrail_scope:
        | "prompt_input"
        | "generated_output"
        | "approval_review"
        | "dispatch_payload"
        | "loss_classification"
      guardrail_severity: "info" | "warning" | "blocker"
      intake_audit_status: "accepted" | "rejected" | "archived" | "needs_review"
      integration_status:
        | "planned"
        | "ready"
        | "connected"
        | "needs_auth"
        | "blocked"
        | "disabled"
      integrity_severity: "info" | "warning" | "blocking"
      job_status:
        | "pending"
        | "scheduled"
        | "in_progress"
        | "completed"
        | "canceled"
      knowledge_trust_tier:
        | "observed"
        | "proposed"
        | "trusted"
        | "rejected"
        | "archived"
      lead_status:
        | "new"
        | "validated"
        | "needs_review"
        | "qualified"
        | "converted"
        | "lost"
        | "archived"
      next_best_action_status:
        | "open"
        | "accepted"
        | "snoozed"
        | "completed"
        | "dismissed"
      nurture_enrollment_status:
        | "queued"
        | "active"
        | "completed"
        | "suppressed"
        | "failed"
        | "unsubscribed"
      nurture_sequence_status: "draft" | "paused" | "active" | "archived"
      opportunity_status:
        | "pending"
        | "drafting"
        | "drafted"
        | "dismissed"
        | "snoozed"
      opportunity_urgency: "low" | "medium" | "high"
      org_status: "active" | "suspended" | "archived"
      outcome_status: "pending" | "won" | "lost" | "paid" | "written_off"
      platform_event_status:
        | "received"
        | "accepted"
        | "rejected"
        | "processed"
        | "failed"
        | "reconciled"
      restoration_focus:
        | "flood"
        | "water_backup"
        | "burst_pipe"
        | "storm_surge"
        | "standing_water"
        | "mold"
        | "sewage"
        | "fire"
      routing_decision_kind:
        | "mitigation"
        | "review"
        | "out_of_scope"
        | "archived"
      routing_recommendation:
        | "target"
        | "elevated"
        | "downgraded"
        | "isolated"
        | "archived"
      social_platform:
        | "facebook"
        | "instagram"
        | "linkedin"
        | "google_my_business"
        | "youtube"
        | "tiktok"
        | "threads"
        | "other"
      social_post_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "scheduled"
        | "published"
        | "failed"
        | "declined"
        | "archived"
      task_priority: "low" | "normal" | "high" | "urgent"
      task_status: "open" | "in_progress" | "completed" | "canceled"
      vault_note_status: "draft" | "needs_review" | "published" | "archived"
      weather_event_status:
        | "received"
        | "qualified"
        | "ignored"
        | "processed"
        | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      actor_kind: ["human", "agent", "system"],
      ad_spend_decision_status: [
        "draft",
        "pending_approval",
        "approved",
        "applied",
        "failed",
        "reverted",
        "canceled",
      ],
      agent_permission_type: ["allowed", "blocked"],
      agent_risk_level: ["low", "medium", "high", "blocked"],
      agent_run_status: [
        "queued",
        "running",
        "completed",
        "failed",
        "canceled",
      ],
      agent_status: [
        "draft",
        "ready",
        "running",
        "paused",
        "blocked",
        "disabled",
      ],
      agent_task_priority: ["low", "medium", "high", "urgent"],
      agent_task_status: [
        "queued",
        "running",
        "blocked",
        "needs_approval",
        "completed",
        "failed",
        "canceled",
      ],
      agent_tool_request_status: [
        "draft",
        "pending_approval",
        "approved",
        "ready_to_run",
        "running",
        "completed",
        "failed",
        "rejected",
        "archived",
      ],
      ai_usage_service: ["arc_claude", "gemini_image", "gemini_video"],
      approval_decision_kind: [
        "approved",
        "declined",
        "revision_requested",
        "archived",
        "blocked",
        "reverted",
      ],
      approval_status: [
        "draft",
        "needs_compliance",
        "pending_approval",
        "pending_owner_approval",
        "approved",
        "declined",
        "rejected",
        "revision_requested",
        "blocked",
        "needs_revision",
        "archived",
      ],
      campaign_asset_type: [
        "landing_page",
        "search_ad",
        "social_ad",
        "display_ad",
        "google_business_post",
        "email",
        "sms",
        "video_prompt",
        "image_prompt",
        "one_pager",
        "referral_packet",
        "review_response",
        "script",
        "other",
      ],
      campaign_dispatch_status: [
        "queued",
        "scheduled",
        "sent",
        "delivered",
        "failed",
        "canceled",
      ],
      campaign_event_type: [
        "created",
        "brief_created",
        "asset_generated",
        "approval_submitted",
        "approval_decided",
        "exported",
        "launched",
        "paused",
        "archived",
        "result_recorded",
        "campaign_launched",
        "asset_deployed",
        "reopened",
        "operator_directive",
        "dispatch_queued",
        "dispatch_sent",
        "dispatch_delivered",
        "dispatch_failed",
        "dispatch_canceled",
        "asset_edited",
      ],
      campaign_status: [
        "draft",
        "briefing",
        "generating",
        "pending_approval",
        "approved",
        "active",
        "paused",
        "archived",
        "blocked",
      ],
      company_status: ["active", "inactive", "archived"],
      connection_kind: ["email", "social", "storage"],
      connection_provider: [
        "resend",
        "instagram",
        "facebook",
        "linkedin",
        "x",
        "google_drive",
      ],
      contact_status: ["active", "inactive", "do_not_contact", "archived"],
      crm_activity_type: [
        "note_added",
        "status_changed",
        "call_logged",
        "email_logged",
        "sms_logged",
        "meeting_logged",
        "task_created",
        "task_completed",
        "record_created",
        "record_updated",
        "ai_recommendation",
        "approval_requested",
        "approval_decided",
        "converted",
        "file_added",
      ],
      crm_entity_type: [
        "company",
        "contact",
        "property",
        "lead",
        "job",
        "outcome",
        "campaign",
      ],
      dispatch_status: [
        "queued",
        "blocked_pending_approval",
        "blocked_compliance",
        "dispatched",
        "failed",
        "skipped",
        "canceled",
      ],
      event_subject_type: [
        "company",
        "contact",
        "property",
        "lead",
        "job",
        "outcome",
      ],
      external_system_kind: [
        "marketing_platform",
        "manager_app",
        "business_development_app",
        "ad_platform",
        "weather_provider",
        "social_platform",
        "email_platform",
        "sms_platform",
        "other",
      ],
      guardrail_scope: [
        "prompt_input",
        "generated_output",
        "approval_review",
        "dispatch_payload",
        "loss_classification",
      ],
      guardrail_severity: ["info", "warning", "blocker"],
      intake_audit_status: ["accepted", "rejected", "archived", "needs_review"],
      integration_status: [
        "planned",
        "ready",
        "connected",
        "needs_auth",
        "blocked",
        "disabled",
      ],
      integrity_severity: ["info", "warning", "blocking"],
      job_status: [
        "pending",
        "scheduled",
        "in_progress",
        "completed",
        "canceled",
      ],
      knowledge_trust_tier: [
        "observed",
        "proposed",
        "trusted",
        "rejected",
        "archived",
      ],
      lead_status: [
        "new",
        "validated",
        "needs_review",
        "qualified",
        "converted",
        "lost",
        "archived",
      ],
      next_best_action_status: [
        "open",
        "accepted",
        "snoozed",
        "completed",
        "dismissed",
      ],
      nurture_enrollment_status: [
        "queued",
        "active",
        "completed",
        "suppressed",
        "failed",
        "unsubscribed",
      ],
      nurture_sequence_status: ["draft", "paused", "active", "archived"],
      opportunity_status: [
        "pending",
        "drafting",
        "drafted",
        "dismissed",
        "snoozed",
      ],
      opportunity_urgency: ["low", "medium", "high"],
      org_status: ["active", "suspended", "archived"],
      outcome_status: ["pending", "won", "lost", "paid", "written_off"],
      platform_event_status: [
        "received",
        "accepted",
        "rejected",
        "processed",
        "failed",
        "reconciled",
      ],
      restoration_focus: [
        "flood",
        "water_backup",
        "burst_pipe",
        "storm_surge",
        "standing_water",
        "mold",
        "sewage",
        "fire",
      ],
      routing_decision_kind: [
        "mitigation",
        "review",
        "out_of_scope",
        "archived",
      ],
      routing_recommendation: [
        "target",
        "elevated",
        "downgraded",
        "isolated",
        "archived",
      ],
      social_platform: [
        "facebook",
        "instagram",
        "linkedin",
        "google_my_business",
        "youtube",
        "tiktok",
        "threads",
        "other",
      ],
      social_post_status: [
        "draft",
        "pending_approval",
        "approved",
        "scheduled",
        "published",
        "failed",
        "declined",
        "archived",
      ],
      task_priority: ["low", "normal", "high", "urgent"],
      task_status: ["open", "in_progress", "completed", "canceled"],
      vault_note_status: ["draft", "needs_review", "published", "archived"],
      weather_event_status: [
        "received",
        "qualified",
        "ignored",
        "processed",
        "failed",
      ],
    },
  },
} as const
