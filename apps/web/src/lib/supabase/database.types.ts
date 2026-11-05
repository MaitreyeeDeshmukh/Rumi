export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      core_consents: {
        Row: {
          granted: boolean
          granted_at: string | null
          kind: string
          owner_id: string
          policy_version: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          granted?: boolean
          granted_at?: string | null
          kind: string
          owner_id?: string
          policy_version: string
          updated_at?: string
        }
        Update: {
          granted?: boolean
          granted_at?: string | null
          kind?: string
          owner_id?: string
          policy_version?: string
          updated_at?: string
        }
        Relationships: []
      }
      core_profiles: {
        Row: {
          companion_name: string
          created_at: string
          display_name: string | null
          owner_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          companion_name?: string
          created_at?: string
          display_name?: string | null
          owner_id?: string
          updated_at?: string
        }
        Update: {
          companion_name?: string
          created_at?: string
          display_name?: string | null
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      core_settings: {
        Row: {
          detail: string
          finish_sound: boolean
          output_mode: string
          owner_id: string
          reduced_motion: boolean
          speech_rate: number
          text_scale: number
          theme: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          detail?: string
          finish_sound?: boolean
          output_mode?: string
          owner_id?: string
          reduced_motion?: boolean
          speech_rate?: number
          text_scale?: number
          theme?: string
          updated_at?: string
        }
        Update: {
          detail?: string
          finish_sound?: boolean
          output_mode?: string
          owner_id?: string
          reduced_motion?: boolean
          speech_rate?: number
          text_scale?: number
          theme?: string
          updated_at?: string
        }
        Relationships: []
      }
      ops_ai_events: {
        Row: {
          attempts: number | null
          bucket: string | null
          cache_status: string | null
          cached_tokens: number | null
          cost_micro_usd: number | null
          created_at: string
          guard_codes: string[]
          id: number
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          outcome: string
          output_tokens: number | null
          prompt_version: string | null
          task: string
          tier: string | null
        }
        ComputedFields: never
        Insert: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome: string
          output_tokens?: number | null
          prompt_version?: string | null
          task: string
          tier?: string | null
        }
        Update: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome?: string
          output_tokens?: number | null
          prompt_version?: string | null
          task?: string
          tier?: string | null
        }
        Relationships: []
      }
      ops_ai_events_2026_11: {
        Row: {
          attempts: number | null
          bucket: string | null
          cache_status: string | null
          cached_tokens: number | null
          cost_micro_usd: number | null
          created_at: string
          guard_codes: string[]
          id: number
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          outcome: string
          output_tokens: number | null
          prompt_version: string | null
          task: string
          tier: string | null
        }
        ComputedFields: never
        Insert: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome: string
          output_tokens?: number | null
          prompt_version?: string | null
          task: string
          tier?: string | null
        }
        Update: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome?: string
          output_tokens?: number | null
          prompt_version?: string | null
          task?: string
          tier?: string | null
        }
        Relationships: []
      }
      ops_ai_events_2026_12: {
        Row: {
          attempts: number | null
          bucket: string | null
          cache_status: string | null
          cached_tokens: number | null
          cost_micro_usd: number | null
          created_at: string
          guard_codes: string[]
          id: number
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          outcome: string
          output_tokens: number | null
          prompt_version: string | null
          task: string
          tier: string | null
        }
        ComputedFields: never
        Insert: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome: string
          output_tokens?: number | null
          prompt_version?: string | null
          task: string
          tier?: string | null
        }
        Update: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome?: string
          output_tokens?: number | null
          prompt_version?: string | null
          task?: string
          tier?: string | null
        }
        Relationships: []
      }
      ops_ai_events_2027_01: {
        Row: {
          attempts: number | null
          bucket: string | null
          cache_status: string | null
          cached_tokens: number | null
          cost_micro_usd: number | null
          created_at: string
          guard_codes: string[]
          id: number
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          outcome: string
          output_tokens: number | null
          prompt_version: string | null
          task: string
          tier: string | null
        }
        ComputedFields: never
        Insert: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome: string
          output_tokens?: number | null
          prompt_version?: string | null
          task: string
          tier?: string | null
        }
        Update: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome?: string
          output_tokens?: number | null
          prompt_version?: string | null
          task?: string
          tier?: string | null
        }
        Relationships: []
      }
      ops_ai_events_2027_02: {
        Row: {
          attempts: number | null
          bucket: string | null
          cache_status: string | null
          cached_tokens: number | null
          cost_micro_usd: number | null
          created_at: string
          guard_codes: string[]
          id: number
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          outcome: string
          output_tokens: number | null
          prompt_version: string | null
          task: string
          tier: string | null
        }
        ComputedFields: never
        Insert: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome: string
          output_tokens?: number | null
          prompt_version?: string | null
          task: string
          tier?: string | null
        }
        Update: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome?: string
          output_tokens?: number | null
          prompt_version?: string | null
          task?: string
          tier?: string | null
        }
        Relationships: []
      }
      ops_ai_events_2027_03: {
        Row: {
          attempts: number | null
          bucket: string | null
          cache_status: string | null
          cached_tokens: number | null
          cost_micro_usd: number | null
          created_at: string
          guard_codes: string[]
          id: number
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          outcome: string
          output_tokens: number | null
          prompt_version: string | null
          task: string
          tier: string | null
        }
        ComputedFields: never
        Insert: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome: string
          output_tokens?: number | null
          prompt_version?: string | null
          task: string
          tier?: string | null
        }
        Update: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome?: string
          output_tokens?: number | null
          prompt_version?: string | null
          task?: string
          tier?: string | null
        }
        Relationships: []
      }
      ops_ai_events_2027_04: {
        Row: {
          attempts: number | null
          bucket: string | null
          cache_status: string | null
          cached_tokens: number | null
          cost_micro_usd: number | null
          created_at: string
          guard_codes: string[]
          id: number
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          outcome: string
          output_tokens: number | null
          prompt_version: string | null
          task: string
          tier: string | null
        }
        ComputedFields: never
        Insert: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome: string
          output_tokens?: number | null
          prompt_version?: string | null
          task: string
          tier?: string | null
        }
        Update: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome?: string
          output_tokens?: number | null
          prompt_version?: string | null
          task?: string
          tier?: string | null
        }
        Relationships: []
      }
      ops_ai_events_default: {
        Row: {
          attempts: number | null
          bucket: string | null
          cache_status: string | null
          cached_tokens: number | null
          cost_micro_usd: number | null
          created_at: string
          guard_codes: string[]
          id: number
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          outcome: string
          output_tokens: number | null
          prompt_version: string | null
          task: string
          tier: string | null
        }
        ComputedFields: never
        Insert: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome: string
          output_tokens?: number | null
          prompt_version?: string | null
          task: string
          tier?: string | null
        }
        Update: {
          attempts?: number | null
          bucket?: string | null
          cache_status?: string | null
          cached_tokens?: number | null
          cost_micro_usd?: number | null
          created_at?: string
          guard_codes?: string[]
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          outcome?: string
          output_tokens?: number | null
          prompt_version?: string | null
          task?: string
          tier?: string | null
        }
        Relationships: []
      }
      ops_ai_usage_daily: {
        Row: {
          bucket: string
          calls: number
          cost_micro_usd: number
          day: string
          shard: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          bucket: string
          calls?: number
          cost_micro_usd?: number
          day: string
          shard: number
          updated_at?: string
        }
        Update: {
          bucket?: string
          calls?: number
          cost_micro_usd?: number
          day?: string
          shard?: number
          updated_at?: string
        }
        Relationships: []
      }
      ops_app_events: {
        Row: {
          area: string
          code: string
          created_at: string
          fingerprint: string | null
          id: number
          release: string | null
          route: string | null
          source: string
          status: number | null
        }
        ComputedFields: never
        Insert: {
          area: string
          code: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source: string
          status?: number | null
        }
        Update: {
          area?: string
          code?: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source?: string
          status?: number | null
        }
        Relationships: []
      }
      ops_app_events_2026_11: {
        Row: {
          area: string
          code: string
          created_at: string
          fingerprint: string | null
          id: number
          release: string | null
          route: string | null
          source: string
          status: number | null
        }
        ComputedFields: never
        Insert: {
          area: string
          code: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source: string
          status?: number | null
        }
        Update: {
          area?: string
          code?: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source?: string
          status?: number | null
        }
        Relationships: []
      }
      ops_app_events_2026_12: {
        Row: {
          area: string
          code: string
          created_at: string
          fingerprint: string | null
          id: number
          release: string | null
          route: string | null
          source: string
          status: number | null
        }
        ComputedFields: never
        Insert: {
          area: string
          code: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source: string
          status?: number | null
        }
        Update: {
          area?: string
          code?: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source?: string
          status?: number | null
        }
        Relationships: []
      }
      ops_app_events_2027_01: {
        Row: {
          area: string
          code: string
          created_at: string
          fingerprint: string | null
          id: number
          release: string | null
          route: string | null
          source: string
          status: number | null
        }
        ComputedFields: never
        Insert: {
          area: string
          code: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source: string
          status?: number | null
        }
        Update: {
          area?: string
          code?: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source?: string
          status?: number | null
        }
        Relationships: []
      }
      ops_app_events_2027_02: {
        Row: {
          area: string
          code: string
          created_at: string
          fingerprint: string | null
          id: number
          release: string | null
          route: string | null
          source: string
          status: number | null
        }
        ComputedFields: never
        Insert: {
          area: string
          code: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source: string
          status?: number | null
        }
        Update: {
          area?: string
          code?: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source?: string
          status?: number | null
        }
        Relationships: []
      }
      ops_app_events_2027_03: {
        Row: {
          area: string
          code: string
          created_at: string
          fingerprint: string | null
          id: number
          release: string | null
          route: string | null
          source: string
          status: number | null
        }
        ComputedFields: never
        Insert: {
          area: string
          code: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source: string
          status?: number | null
        }
        Update: {
          area?: string
          code?: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source?: string
          status?: number | null
        }
        Relationships: []
      }
      ops_app_events_2027_04: {
        Row: {
          area: string
          code: string
          created_at: string
          fingerprint: string | null
          id: number
          release: string | null
          route: string | null
          source: string
          status: number | null
        }
        ComputedFields: never
        Insert: {
          area: string
          code: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source: string
          status?: number | null
        }
        Update: {
          area?: string
          code?: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source?: string
          status?: number | null
        }
        Relationships: []
      }
      ops_app_events_default: {
        Row: {
          area: string
          code: string
          created_at: string
          fingerprint: string | null
          id: number
          release: string | null
          route: string | null
          source: string
          status: number | null
        }
        ComputedFields: never
        Insert: {
          area: string
          code: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source: string
          status?: number | null
        }
        Update: {
          area?: string
          code?: string
          created_at?: string
          fingerprint?: string | null
          id?: number
          release?: string | null
          route?: string | null
          source?: string
          status?: number | null
        }
        Relationships: []
      }
      ops_feature_flags: {
        Row: {
          enabled: boolean
          key: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          enabled: boolean
          key: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      persona_facts: {
        Row: {
          client_updated_at: string
          created_at: string
          id: number
          key: string
          kind: string
          level: number | null
          owner_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          client_updated_at?: string
          created_at?: string
          id?: never
          key: string
          kind: string
          level?: number | null
          owner_id?: string
          updated_at?: string
        }
        Update: {
          client_updated_at?: string
          created_at?: string
          id?: never
          key?: string
          kind?: string
          level?: number | null
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      persona_removed: {
        Row: {
          key: string
          kind: string
          owner_id: string
          removed_at: string
        }
        ComputedFields: never
        Insert: {
          key: string
          kind: string
          owner_id?: string
          removed_at?: string
        }
        Update: {
          key?: string
          kind?: string
          owner_id?: string
          removed_at?: string
        }
        Relationships: []
      }
      plan_items: {
        Row: {
          created_at: string
          enabled: boolean
          id: number
          kind: string
          local_id: string
          owner_id: string
          plan_id: string
          position: number
          source: string
          text: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: never
          kind: string
          local_id: string
          owner_id?: string
          plan_id: string
          position: number
          source: string
          text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: never
          kind?: string
          local_id?: string
          owner_id?: string
          plan_id?: string
          position?: number
          source?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_items_plan_id_owner_id_fkey"
            columns: ["plan_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "plan_visit_plans"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      plan_support_cards: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          plan_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          owner_id?: string
          plan_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_support_cards_plan_id_owner_id_fkey"
            columns: ["plan_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "plan_visit_plans"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      plan_support_items: {
        Row: {
          card_id: string
          created_at: string
          enabled: boolean
          id: number
          owner_id: string
          position: number
          preset_key: string | null
          source: string
          text: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          card_id: string
          created_at?: string
          enabled?: boolean
          id?: never
          owner_id?: string
          position: number
          preset_key?: string | null
          source: string
          text: string
          updated_at?: string
        }
        Update: {
          card_id?: string
          created_at?: string
          enabled?: boolean
          id?: never
          owner_id?: string
          position?: number
          preset_key?: string | null
          source?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_support_items_card_id_owner_id_fkey"
            columns: ["card_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "plan_support_cards"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      plan_support_top_questions: {
        Row: {
          card_id: string
          owner_id: string
          plan_item_id: number
          position: number
        }
        ComputedFields: never
        Insert: {
          card_id: string
          owner_id?: string
          plan_item_id: number
          position: number
        }
        Update: {
          card_id?: string
          owner_id?: string
          plan_item_id?: number
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "plan_support_top_questions_card_id_owner_id_fkey"
            columns: ["card_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "plan_support_cards"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "plan_support_top_questions_plan_item_id_owner_id_fkey"
            columns: ["plan_item_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "plan_items"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      plan_visit_plans: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          main_concern: string
          owner_id: string
          symptoms_in_my_words: string[]
          title: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          main_concern?: string
          owner_id?: string
          symptoms_in_my_words?: string[]
          title?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          main_concern?: string
          owner_id?: string
          symptoms_in_my_words?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      practice_item_outcomes: {
        Row: {
          covered: boolean
          help_level_used: number
          owner_id: string
          plan_item_id: number
          session_id: string
        }
        ComputedFields: never
        Insert: {
          covered?: boolean
          help_level_used?: number
          owner_id?: string
          plan_item_id: number
          session_id: string
        }
        Update: {
          covered?: boolean
          help_level_used?: number
          owner_id?: string
          plan_item_id?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_item_outcomes_plan_item_id_owner_id_fkey"
            columns: ["plan_item_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "plan_items"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "practice_item_outcomes_session_id_owner_id_fkey"
            columns: ["session_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "practice_sessions"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      practice_sessions: {
        Row: {
          created_at: string
          ended_at: string | null
          focus: string
          help_count: number
          id: string
          owner_id: string
          plan_id: string
          ready_after: number | null
          ready_before: number | null
          started_at: string
          status: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          ended_at?: string | null
          focus: string
          help_count?: number
          id?: string
          owner_id?: string
          plan_id: string
          ready_after?: number | null
          ready_before?: number | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          focus?: string
          help_count?: number
          id?: string
          owner_id?: string
          plan_id?: string
          ready_after?: number | null
          ready_before?: number | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_sessions_plan_id_owner_id_fkey"
            columns: ["plan_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "plan_visit_plans"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      practice_turns: {
        Row: {
          created_at: string
          id: number
          owner_id: string
          role: string
          session_id: string
          text: string
          turn_index: number
          used_help: boolean
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: never
          owner_id?: string
          role: string
          session_id: string
          text: string
          turn_index: number
          used_help?: boolean
        }
        Update: {
          created_at?: string
          id?: never
          owner_id?: string
          role?: string
          session_id?: string
          text?: string
          turn_index?: number
          used_help?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "practice_turns_session_id_owner_id_fkey"
            columns: ["session_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "practice_sessions"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      recap_items: {
        Row: {
          evidence_line_nos: number[]
          id: number
          owner_id: string
          position: number
          recap_id: string
          section: string
          text: string
        }
        ComputedFields: never
        Insert: {
          evidence_line_nos: number[]
          id?: never
          owner_id?: string
          position: number
          recap_id: string
          section: string
          text: string
        }
        Update: {
          evidence_line_nos?: number[]
          id?: never
          owner_id?: string
          position?: number
          recap_id?: string
          section?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "recap_items_recap_id_owner_id_fkey"
            columns: ["recap_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "recap_recaps"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      recap_plan_status: {
        Row: {
          evidence_line_nos: number[]
          owner_id: string
          plan_item_id: number
          recap_id: string
          status: string
        }
        ComputedFields: never
        Insert: {
          evidence_line_nos?: number[]
          owner_id?: string
          plan_item_id: number
          recap_id: string
          status: string
        }
        Update: {
          evidence_line_nos?: number[]
          owner_id?: string
          plan_item_id?: number
          recap_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "recap_plan_status_plan_item_id_owner_id_fkey"
            columns: ["plan_item_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "plan_items"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "recap_plan_status_recap_id_owner_id_fkey"
            columns: ["recap_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "recap_recaps"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      recap_recaps: {
        Row: {
          created_at: string
          id: string
          is_sample: boolean
          is_saved_fallback: boolean
          my_speaker: string
          owner_id: string
          plan_id: string | null
          prompt_version: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          is_sample?: boolean
          is_saved_fallback?: boolean
          my_speaker: string
          owner_id?: string
          plan_id?: string | null
          prompt_version?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_sample?: boolean
          is_saved_fallback?: boolean
          my_speaker?: string
          owner_id?: string
          plan_id?: string | null
          prompt_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recap_recaps_plan_id_owner_id_fkey"
            columns: ["plan_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "plan_visit_plans"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      recap_transcript_lines: {
        Row: {
          id: number
          line_no: number
          local_id: string
          owner_id: string
          recap_id: string
          speaker: string
          text: string
        }
        ComputedFields: never
        Insert: {
          id?: never
          line_no: number
          local_id: string
          owner_id?: string
          recap_id: string
          speaker: string
          text: string
        }
        Update: {
          id?: never
          line_no?: number
          local_id?: string
          owner_id?: string
          recap_id?: string
          speaker?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "recap_transcript_lines_recap_id_owner_id_fkey"
            columns: ["recap_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "recap_recaps"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      recap_unconfirmed_items: {
        Row: {
          id: number
          owner_id: string
          position: number
          recap_id: string
          text: string
        }
        ComputedFields: never
        Insert: {
          id?: never
          owner_id?: string
          position: number
          recap_id: string
          text: string
        }
        Update: {
          id?: never
          owner_id?: string
          position?: number
          recap_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "recap_unconfirmed_items_recap_id_owner_id_fkey"
            columns: ["recap_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "recap_recaps"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      research_tester_sessions: {
        Row: {
          change_suggestion: string | null
          confusion_note: string | null
          created_at: string
          id: string
          items_total: number
          items_unaided: number
          items_with_help: number
          participant_code: string
          ready_after: number | null
          ready_before: number | null
          session_date: string
          setting: string | null
        }
        ComputedFields: never
        Insert: {
          change_suggestion?: string | null
          confusion_note?: string | null
          created_at?: string
          id?: string
          items_total: number
          items_unaided: number
          items_with_help: number
          participant_code: string
          ready_after?: number | null
          ready_before?: number | null
          session_date?: string
          setting?: string | null
        }
        Update: {
          change_suggestion?: string | null
          confusion_note?: string | null
          created_at?: string
          id?: string
          items_total?: number
          items_unaided?: number
          items_with_help?: number
          participant_code?: string
          ready_after?: number | null
          ready_before?: number | null
          session_date?: string
          setting?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      ops_v_ai_daily: {
        Row: {
          cached_tokens: number | null
          calls: number | null
          cost_usd: number | null
          day: string | null
          degraded_rate: number | null
          error_rate: number | null
          input_tokens: number | null
          output_tokens: number | null
          p50_ms: number | null
          p95_ms: number | null
          provider_calls: number | null
          task: string
        }
        ComputedFields: never
        Relationships: []
      }
      ops_v_ai_recent_30m: {
        Row: {
          calls: number | null
          degraded_calls: number | null
          error_calls: number | null
        }
        ComputedFields: never
        Relationships: []
      }
      ops_v_app_errors_daily: {
        Row: {
          area: string
          code: string
          day: string | null
          events: number | null
          fingerprints: number | null
          last_seen: string | null
          release: string | null
          source: string
        }
        ComputedFields: never
        Relationships: []
      }
      ops_v_usage_today: {
        Row: {
          buckets: number | null
          calls: number | null
          cost_usd: number | null
          max_calls_per_bucket: number | null
          scope: string | null
        }
        ComputedFields: never
        Relationships: []
      }
    }
    Functions: {
      core_delete_my_data: { Args: Record<PropertyKey, never>; Returns: undefined }
      core_ensure_my_rows: { Args: Record<PropertyKey, never>; Returns: undefined }
      core_export_my_data: { Args: Record<PropertyKey, never>; Returns: Json }
      ops_ai_usage_total: {
        Args: { p_bucket: string; p_day: string }
        Returns: {
          calls: number
          cost_micro_usd: number
        }[]
      }
      ops_alert_snapshot: { Args: Record<PropertyKey, never>; Returns: Json }
      ops_bump_ai_usage: {
        Args: { p_bucket: string; p_calls?: number; p_cost_micro_usd?: number }
        Returns: undefined
      }
      ops_create_ai_event_partition: { Args: { p_month: string }; Returns: undefined }
      ops_create_app_event_partition: { Args: { p_month: string }; Returns: undefined }
      ops_create_month_partition: {
        Args: { p_month: string; p_parent: string }
        Returns: undefined
      }
      ops_log_app_event: {
        Args: {
          p_area: string
          p_code: string
          p_fingerprint: string
          p_release: string
          p_route: string
          p_source: string
          p_status: number
        }
        Returns: undefined
      }
      ops_maintenance_daily: { Args: Record<PropertyKey, never>; Returns: Json }
      ops_prune_ai_usage: { Args: { p_keep_days?: number }; Returns: number }
      ops_take_ai_quota: { Args: { p_buckets: string[]; p_limits: number[] }; Returns: boolean }
      persona_forget_all: { Args: Record<PropertyKey, never>; Returns: number }
      persona_upsert_facts: { Args: { p_facts: Json }; Returns: number }
    }
    Enums: {
      [_ in never]: never
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
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
