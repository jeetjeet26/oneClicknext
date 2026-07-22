// schema_migration_version: 20260721200000
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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ad_account_connections: {
        Row: {
          account_id: string
          account_name: string | null
          account_timezone: string | null
          connected_at: string | null
          connected_by: string | null
          created_at: string | null
          currency: string | null
          error_count: number | null
          id: string
          is_active: boolean | null
          last_error: string | null
          last_imported_at: string | null
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          last_synced_at: string | null
          manager_account_id: string | null
          metadata: Json | null
          org_id: string | null
          platform: string
          platform_metadata: Json | null
          property_id: string | null
          updated_at: string | null
        }
        Insert: {
          account_id: string
          account_name?: string | null
          account_timezone?: string | null
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string | null
          currency?: string | null
          error_count?: number | null
          id?: string
          is_active?: boolean | null
          last_error?: string | null
          last_imported_at?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          manager_account_id?: string | null
          metadata?: Json | null
          org_id?: string | null
          platform: string
          platform_metadata?: Json | null
          property_id?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          account_name?: string | null
          account_timezone?: string | null
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string | null
          currency?: string | null
          error_count?: number | null
          id?: string
          is_active?: boolean | null
          last_error?: string | null
          last_imported_at?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          manager_account_id?: string | null
          metadata?: Json | null
          org_id?: string | null
          platform?: string
          platform_metadata?: Json | null
          property_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_account_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_account_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_account_connections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_account_connections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "ad_account_connections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      agent_calendars: {
        Row: {
          access_token: string | null
          account_email: string
          alert_sent_at: string | null
          auth_source: string
          authorized_by_profile_id: string | null
          buffer_minutes: number | null
          calendar_id: string | null
          created_at: string | null
          external_invite_id: string | null
          google_email: string | null
          health_check_error: string | null
          id: string
          last_health_check_at: string | null
          profile_id: string | null
          property_id: string | null
          provider: string
          provider_metadata: Json
          provider_subject: string | null
          refresh_token: string | null
          scopes: string[]
          sync_enabled: boolean | null
          tenant_id: string | null
          timezone: string | null
          token_expires_at: string | null
          token_status: string | null
          tour_duration_minutes: number | null
          updated_at: string | null
          watch_channel_id: string | null
          watch_expiration: string | null
          watch_last_message_number: number | null
          watch_resource_id: string | null
          working_hours: Json | null
        }
        Insert: {
          access_token?: string | null
          account_email: string
          alert_sent_at?: string | null
          auth_source?: string
          authorized_by_profile_id?: string | null
          buffer_minutes?: number | null
          calendar_id?: string | null
          created_at?: string | null
          external_invite_id?: string | null
          google_email?: string | null
          health_check_error?: string | null
          id?: string
          last_health_check_at?: string | null
          profile_id?: string | null
          property_id?: string | null
          provider?: string
          provider_metadata?: Json
          provider_subject?: string | null
          refresh_token?: string | null
          scopes?: string[]
          sync_enabled?: boolean | null
          tenant_id?: string | null
          timezone?: string | null
          token_expires_at?: string | null
          token_status?: string | null
          tour_duration_minutes?: number | null
          updated_at?: string | null
          watch_channel_id?: string | null
          watch_expiration?: string | null
          watch_last_message_number?: number | null
          watch_resource_id?: string | null
          working_hours?: Json | null
        }
        Update: {
          access_token?: string | null
          account_email?: string
          alert_sent_at?: string | null
          auth_source?: string
          authorized_by_profile_id?: string | null
          buffer_minutes?: number | null
          calendar_id?: string | null
          created_at?: string | null
          external_invite_id?: string | null
          google_email?: string | null
          health_check_error?: string | null
          id?: string
          last_health_check_at?: string | null
          profile_id?: string | null
          property_id?: string | null
          provider?: string
          provider_metadata?: Json
          provider_subject?: string | null
          refresh_token?: string | null
          scopes?: string[]
          sync_enabled?: boolean | null
          tenant_id?: string | null
          timezone?: string | null
          token_expires_at?: string | null
          token_status?: string | null
          tour_duration_minutes?: number | null
          updated_at?: string | null
          watch_channel_id?: string | null
          watch_expiration?: string | null
          watch_last_message_number?: number | null
          watch_resource_id?: string | null
          working_hours?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_calendars_authorized_by_profile_id_fkey"
            columns: ["authorized_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_calendars_external_invite_id_fkey"
            columns: ["external_invite_id"]
            isOneToOne: false
            referencedRelation: "integration_auth_invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_calendars_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_calendars_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_calendars_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "agent_calendars_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          entity_id: string | null
          entity_name: string | null
          entity_type: string
          id: string
          ip_address: string | null
          org_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          org_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          org_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          agent_calendar_id: string | null
          created_at: string | null
          google_event_id: string
          id: string
          last_synced_at: string | null
          provider_event_id: string
          provider_event_link: string | null
          sync_status: string | null
          tour_booking_id: string | null
        }
        Insert: {
          agent_calendar_id?: string | null
          created_at?: string | null
          google_event_id: string
          id?: string
          last_synced_at?: string | null
          provider_event_id: string
          provider_event_link?: string | null
          sync_status?: string | null
          tour_booking_id?: string | null
        }
        Update: {
          agent_calendar_id?: string | null
          created_at?: string | null
          google_event_id?: string
          id?: string
          last_synced_at?: string | null
          provider_event_id?: string
          provider_event_link?: string | null
          sync_status?: string | null
          tour_booking_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_agent_calendar_id_fkey"
            columns: ["agent_calendar_id"]
            isOneToOne: false
            referencedRelation: "agent_calendars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_tour_booking_id_fkey"
            columns: ["tour_booking_id"]
            isOneToOne: true
            referencedRelation: "tour_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_token_refreshes: {
        Row: {
          agent_calendar_id: string | null
          created_at: string | null
          error_message: string | null
          id: string
          new_expires_at: string | null
          old_expires_at: string | null
          refresh_status: string
        }
        Insert: {
          agent_calendar_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          new_expires_at?: string | null
          old_expires_at?: string | null
          refresh_status: string
        }
        Update: {
          agent_calendar_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          new_expires_at?: string | null
          old_expires_at?: string | null
          refresh_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_token_refreshes_agent_calendar_id_fkey"
            columns: ["agent_calendar_id"]
            isOneToOne: false
            referencedRelation: "agent_calendars"
            referencedColumns: ["id"]
          },
        ]
      }
      community_contacts: {
        Row: {
          billing_address: Json | null
          billing_method: string | null
          contact_type: string
          created_at: string | null
          email: string
          id: string
          is_primary: boolean | null
          name: string
          needs_w9: boolean | null
          phone: string | null
          property_id: string | null
          role: string | null
          special_instructions: string | null
          updated_at: string | null
        }
        Insert: {
          billing_address?: Json | null
          billing_method?: string | null
          contact_type: string
          created_at?: string | null
          email: string
          id?: string
          is_primary?: boolean | null
          name: string
          needs_w9?: boolean | null
          phone?: string | null
          property_id?: string | null
          role?: string | null
          special_instructions?: string | null
          updated_at?: string | null
        }
        Update: {
          billing_address?: Json | null
          billing_method?: string | null
          contact_type?: string
          created_at?: string | null
          email?: string
          id?: string
          is_primary?: boolean | null
          name?: string
          needs_w9?: boolean | null
          phone?: string | null
          property_id?: string | null
          role?: string | null
          special_instructions?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_contacts_property_id_fkey1"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_contacts_property_id_fkey1"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "community_contacts_property_id_fkey1"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      community_profiles: {
        Row: {
          amenities: string[] | null
          brand_voice: string | null
          community_type: string | null
          created_at: string | null
          id: string
          intake_completed_at: string | null
          legal_name: string | null
          office_hours: Json | null
          parking_info: Json | null
          pet_policy: Json | null
          property_id: string | null
          social_media: Json | null
          special_features: string[] | null
          target_audience: string | null
          unit_count: number | null
          updated_at: string | null
          website_url: string | null
          year_built: number | null
        }
        Insert: {
          amenities?: string[] | null
          brand_voice?: string | null
          community_type?: string | null
          created_at?: string | null
          id?: string
          intake_completed_at?: string | null
          legal_name?: string | null
          office_hours?: Json | null
          parking_info?: Json | null
          pet_policy?: Json | null
          property_id?: string | null
          social_media?: Json | null
          special_features?: string[] | null
          target_audience?: string | null
          unit_count?: number | null
          updated_at?: string | null
          website_url?: string | null
          year_built?: number | null
        }
        Update: {
          amenities?: string[] | null
          brand_voice?: string | null
          community_type?: string | null
          created_at?: string | null
          id?: string
          intake_completed_at?: string | null
          legal_name?: string | null
          office_hours?: Json | null
          parking_info?: Json | null
          pet_policy?: Json | null
          property_id?: string | null
          social_media?: Json | null
          special_features?: string[] | null
          target_audience?: string | null
          unit_count?: number | null
          updated_at?: string | null
          website_url?: string | null
          year_built?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "community_profiles_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_profiles_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "community_profiles_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      competitor_brand_intelligence: {
        Row: {
          active_specials: string[] | null
          analysis_version: string | null
          brand_personality: string | null
          brand_voice: string | null
          call_to_action_patterns: string[] | null
          capture_id: string | null
          community_events: string[] | null
          competitor_id: string
          confidence_score: number | null
          created_at: string | null
          highlighted_amenities: string[] | null
          id: string
          key_messaging_themes: string[] | null
          last_analyzed_at: string | null
          lifestyle_focus: string[] | null
          pages_analyzed: number | null
          positioning_statement: string | null
          promotional_messaging: string | null
          raw_extraction: Json | null
          sentiment_score: number | null
          service_offerings: string[] | null
          target_audience: string | null
          unique_selling_points: string[] | null
          updated_at: string | null
          urgency_tactics: string[] | null
          website_tone: string | null
        }
        Insert: {
          active_specials?: string[] | null
          analysis_version?: string | null
          brand_personality?: string | null
          brand_voice?: string | null
          call_to_action_patterns?: string[] | null
          capture_id?: string | null
          community_events?: string[] | null
          competitor_id: string
          confidence_score?: number | null
          created_at?: string | null
          highlighted_amenities?: string[] | null
          id?: string
          key_messaging_themes?: string[] | null
          last_analyzed_at?: string | null
          lifestyle_focus?: string[] | null
          pages_analyzed?: number | null
          positioning_statement?: string | null
          promotional_messaging?: string | null
          raw_extraction?: Json | null
          sentiment_score?: number | null
          service_offerings?: string[] | null
          target_audience?: string | null
          unique_selling_points?: string[] | null
          updated_at?: string | null
          urgency_tactics?: string[] | null
          website_tone?: string | null
        }
        Update: {
          active_specials?: string[] | null
          analysis_version?: string | null
          brand_personality?: string | null
          brand_voice?: string | null
          call_to_action_patterns?: string[] | null
          capture_id?: string | null
          community_events?: string[] | null
          competitor_id?: string
          confidence_score?: number | null
          created_at?: string | null
          highlighted_amenities?: string[] | null
          id?: string
          key_messaging_themes?: string[] | null
          last_analyzed_at?: string | null
          lifestyle_focus?: string[] | null
          pages_analyzed?: number | null
          positioning_statement?: string | null
          promotional_messaging?: string | null
          raw_extraction?: Json | null
          sentiment_score?: number | null
          service_offerings?: string[] | null
          target_audience?: string | null
          unique_selling_points?: string[] | null
          updated_at?: string | null
          urgency_tactics?: string[] | null
          website_tone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_brand_intelligence_capture_id_fkey"
            columns: ["capture_id"]
            isOneToOne: false
            referencedRelation: "market_source_captures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_brand_intelligence_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: true
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_content_chunks: {
        Row: {
          capture_id: string | null
          chunk_index: number | null
          competitor_id: string
          content: string
          content_hash: string | null
          embedding: string | null
          id: string
          page_type: string | null
          page_url: string
          scraped_at: string | null
        }
        Insert: {
          capture_id?: string | null
          chunk_index?: number | null
          competitor_id: string
          content: string
          content_hash?: string | null
          embedding?: string | null
          id?: string
          page_type?: string | null
          page_url: string
          scraped_at?: string | null
        }
        Update: {
          capture_id?: string | null
          chunk_index?: number | null
          competitor_id?: string
          content?: string
          content_hash?: string | null
          embedding?: string | null
          id?: string
          page_type?: string | null
          page_url?: string
          scraped_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_content_chunks_capture_id_fkey"
            columns: ["capture_id"]
            isOneToOne: false
            referencedRelation: "market_source_captures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_content_chunks_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_intake_batches: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          property_id: string
          raw_text: string
          status: string
          submitted_by: string | null
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          property_id: string
          raw_text: string
          status?: string
          submitted_by?: string | null
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          property_id?: string
          raw_text?: string
          status?: string
          submitted_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_intake_batches_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_intake_batches_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "competitor_intake_batches_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "competitor_intake_batches_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_intake_candidates: {
        Row: {
          batch_id: string
          competitor_id: string | null
          created_at: string | null
          enrichment_status: string
          error_message: string | null
          evidence_summary: Json
          id: string
          property_id: string
          seed_claims: Json
          seed_location: string | null
          seed_name: string
          seed_snippet: string
          seed_url: string | null
          updated_at: string | null
        }
        Insert: {
          batch_id: string
          competitor_id?: string | null
          created_at?: string | null
          enrichment_status?: string
          error_message?: string | null
          evidence_summary?: Json
          id?: string
          property_id: string
          seed_claims?: Json
          seed_location?: string | null
          seed_name: string
          seed_snippet: string
          seed_url?: string | null
          updated_at?: string | null
        }
        Update: {
          batch_id?: string
          competitor_id?: string | null
          created_at?: string | null
          enrichment_status?: string
          error_message?: string | null
          evidence_summary?: Json
          id?: string
          property_id?: string
          seed_claims?: Json
          seed_location?: string | null
          seed_name?: string
          seed_snippet?: string
          seed_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_intake_candidates_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "competitor_intake_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_intake_candidates_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_intake_candidates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_intake_candidates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "competitor_intake_candidates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      competitor_price_history: {
        Row: {
          available_count: number | null
          capture_id: string | null
          competitor_unit_id: string
          id: string
          recorded_at: string | null
          rent_max: number | null
          rent_min: number | null
          source: string | null
        }
        Insert: {
          available_count?: number | null
          capture_id?: string | null
          competitor_unit_id: string
          id?: string
          recorded_at?: string | null
          rent_max?: number | null
          rent_min?: number | null
          source?: string | null
        }
        Update: {
          available_count?: number | null
          capture_id?: string | null
          competitor_unit_id?: string
          id?: string
          recorded_at?: string | null
          rent_max?: number | null
          rent_min?: number | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_price_history_capture_id_fkey"
            columns: ["capture_id"]
            isOneToOne: false
            referencedRelation: "market_source_captures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_price_history_competitor_unit_id_fkey"
            columns: ["competitor_unit_id"]
            isOneToOne: false
            referencedRelation: "competitor_units"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_scrape_jobs: {
        Row: {
          batch_size: number | null
          competitor_ids: string[] | null
          completed_at: string | null
          created_at: string | null
          current_batch: number | null
          error_message: string | null
          errors: Json | null
          estimated_completion_at: string | null
          failed_competitor_ids: string[] | null
          failed_count: number | null
          id: string
          job_type: string | null
          processed_competitor_ids: string[] | null
          processed_count: number | null
          property_id: string
          started_at: string | null
          status: string | null
          total_batches: number | null
          total_competitors: number | null
          updated_at: string | null
        }
        Insert: {
          batch_size?: number | null
          competitor_ids?: string[] | null
          completed_at?: string | null
          created_at?: string | null
          current_batch?: number | null
          error_message?: string | null
          errors?: Json | null
          estimated_completion_at?: string | null
          failed_competitor_ids?: string[] | null
          failed_count?: number | null
          id?: string
          job_type?: string | null
          processed_competitor_ids?: string[] | null
          processed_count?: number | null
          property_id: string
          started_at?: string | null
          status?: string | null
          total_batches?: number | null
          total_competitors?: number | null
          updated_at?: string | null
        }
        Update: {
          batch_size?: number | null
          competitor_ids?: string[] | null
          completed_at?: string | null
          created_at?: string | null
          current_batch?: number | null
          error_message?: string | null
          errors?: Json | null
          estimated_completion_at?: string | null
          failed_competitor_ids?: string[] | null
          failed_count?: number | null
          id?: string
          job_type?: string | null
          processed_competitor_ids?: string[] | null
          processed_count?: number | null
          property_id?: string
          started_at?: string | null
          status?: string | null
          total_batches?: number | null
          total_competitors?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_scrape_jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_scrape_jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "competitor_scrape_jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      competitor_snapshots: {
        Row: {
          competitor_id: string | null
          competitor_name: string | null
          created_at: string | null
          id: string
          property_id: string
          scraped_at: string | null
          snapshot_data: Json
          source_url: string | null
        }
        Insert: {
          competitor_id?: string | null
          competitor_name?: string | null
          created_at?: string | null
          id?: string
          property_id: string
          scraped_at?: string | null
          snapshot_data?: Json
          source_url?: string | null
        }
        Update: {
          competitor_id?: string | null
          competitor_name?: string | null
          created_at?: string | null
          id?: string
          property_id?: string
          scraped_at?: string | null
          snapshot_data?: Json
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_snapshots_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_snapshots_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_snapshots_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "competitor_snapshots_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      competitor_units: {
        Row: {
          available_count: number | null
          bathrooms: number | null
          bedrooms: number
          capture_id: string | null
          competitor_id: string
          created_at: string | null
          deposit: number | null
          id: string
          last_updated_at: string | null
          move_in_specials: string | null
          rent_max: number | null
          rent_min: number | null
          sqft_max: number | null
          sqft_min: number | null
          unit_type: string
        }
        Insert: {
          available_count?: number | null
          bathrooms?: number | null
          bedrooms?: number
          capture_id?: string | null
          competitor_id: string
          created_at?: string | null
          deposit?: number | null
          id?: string
          last_updated_at?: string | null
          move_in_specials?: string | null
          rent_max?: number | null
          rent_min?: number | null
          sqft_max?: number | null
          sqft_min?: number | null
          unit_type: string
        }
        Update: {
          available_count?: number | null
          bathrooms?: number | null
          bedrooms?: number
          capture_id?: string | null
          competitor_id?: string
          created_at?: string | null
          deposit?: number | null
          id?: string
          last_updated_at?: string | null
          move_in_specials?: string | null
          rent_max?: number | null
          rent_min?: number | null
          sqft_max?: number | null
          sqft_min?: number | null
          unit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_units_capture_id_fkey"
            columns: ["capture_id"]
            isOneToOne: false
            referencedRelation: "market_source_captures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_units_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          address: string | null
          address_json: Json | null
          amenities: Json | null
          created_at: string | null
          id: string
          ils_listings: Json | null
          is_active: boolean | null
          last_scraped_at: string | null
          name: string
          notes: string | null
          phone: string | null
          photos: Json | null
          property_id: string
          property_type: string | null
          units_count: number | null
          updated_at: string | null
          website_url: string | null
          year_built: number | null
        }
        Insert: {
          address?: string | null
          address_json?: Json | null
          amenities?: Json | null
          created_at?: string | null
          id?: string
          ils_listings?: Json | null
          is_active?: boolean | null
          last_scraped_at?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          photos?: Json | null
          property_id: string
          property_type?: string | null
          units_count?: number | null
          updated_at?: string | null
          website_url?: string | null
          year_built?: number | null
        }
        Update: {
          address?: string | null
          address_json?: Json | null
          amenities?: Json | null
          created_at?: string | null
          id?: string
          ils_listings?: Json | null
          is_active?: boolean | null
          last_scraped_at?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          photos?: Json | null
          property_id?: string
          property_type?: string | null
          units_count?: number | null
          updated_at?: string | null
          website_url?: string | null
          year_built?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "competitors_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitors_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "competitors_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      content_assets: {
        Row: {
          asset_type: string
          created_at: string | null
          description: string | null
          duration_seconds: number | null
          embedding: string | null
          file_size_bytes: number | null
          file_url: string
          folder: string | null
          format: string | null
          generation_params: Json | null
          generation_prompt: string | null
          generation_provider: string | null
          height: number | null
          id: string
          is_ai_generated: boolean | null
          is_favorite: boolean | null
          last_used_at: string | null
          name: string
          property_id: string | null
          source_asset_id: string | null
          storage_bucket: string | null
          storage_path: string | null
          tags: string[] | null
          thumbnail_url: string | null
          updated_at: string | null
          uploaded_by: string | null
          usage_count: number | null
          width: number | null
        }
        Insert: {
          asset_type: string
          created_at?: string | null
          description?: string | null
          duration_seconds?: number | null
          embedding?: string | null
          file_size_bytes?: number | null
          file_url: string
          folder?: string | null
          format?: string | null
          generation_params?: Json | null
          generation_prompt?: string | null
          generation_provider?: string | null
          height?: number | null
          id?: string
          is_ai_generated?: boolean | null
          is_favorite?: boolean | null
          last_used_at?: string | null
          name: string
          property_id?: string | null
          source_asset_id?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
          usage_count?: number | null
          width?: number | null
        }
        Update: {
          asset_type?: string
          created_at?: string | null
          description?: string | null
          duration_seconds?: number | null
          embedding?: string | null
          file_size_bytes?: number | null
          file_url?: string
          folder?: string | null
          format?: string | null
          generation_params?: Json | null
          generation_prompt?: string | null
          generation_provider?: string | null
          height?: number | null
          id?: string
          is_ai_generated?: boolean | null
          is_favorite?: boolean | null
          last_used_at?: string | null
          name?: string
          property_id?: string | null
          source_asset_id?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
          usage_count?: number | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_assets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_assets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "content_assets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "content_assets_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_assets_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_calendar: {
        Row: {
          account_id: string | null
          content_draft_id: string | null
          created_at: string | null
          created_by: string | null
          error_message: string | null
          id: string
          notes: string | null
          platform: string
          platform_post_id: string | null
          property_id: string | null
          published_at: string | null
          scheduled_date: string
          scheduled_time: string | null
          status: string | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          content_draft_id?: string | null
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          id?: string
          notes?: string | null
          platform: string
          platform_post_id?: string | null
          property_id?: string | null
          published_at?: string | null
          scheduled_date: string
          scheduled_time?: string | null
          status?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          content_draft_id?: string | null
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          id?: string
          notes?: string | null
          platform?: string
          platform_post_id?: string | null
          property_id?: string | null
          published_at?: string | null
          scheduled_date?: string
          scheduled_time?: string | null
          status?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_calendar_content_draft_id_fkey"
            columns: ["content_draft_id"]
            isOneToOne: false
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_calendar_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_calendar_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_calendar_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "content_calendar_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      content_drafts: {
        Row: {
          ai_model: string | null
          approved_at: string | null
          approved_by: string | null
          call_to_action: string | null
          caption: string | null
          content_type: string
          created_at: string | null
          created_by: string | null
          generation_params: Json | null
          generation_prompt: string | null
          hashtags: string[] | null
          id: string
          media_type: string | null
          media_urls: string[] | null
          performance_metrics: Json | null
          platform: string | null
          platform_post_id: string | null
          property_id: string | null
          published_at: string | null
          rejection_reason: string | null
          scheduled_for: string | null
          status: string | null
          template_id: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string | null
          variations: Json | null
        }
        Insert: {
          ai_model?: string | null
          approved_at?: string | null
          approved_by?: string | null
          call_to_action?: string | null
          caption?: string | null
          content_type: string
          created_at?: string | null
          created_by?: string | null
          generation_params?: Json | null
          generation_prompt?: string | null
          hashtags?: string[] | null
          id?: string
          media_type?: string | null
          media_urls?: string[] | null
          performance_metrics?: Json | null
          platform?: string | null
          platform_post_id?: string | null
          property_id?: string | null
          published_at?: string | null
          rejection_reason?: string | null
          scheduled_for?: string | null
          status?: string | null
          template_id?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string | null
          variations?: Json | null
        }
        Update: {
          ai_model?: string | null
          approved_at?: string | null
          approved_by?: string | null
          call_to_action?: string | null
          caption?: string | null
          content_type?: string
          created_at?: string | null
          created_by?: string | null
          generation_params?: Json | null
          generation_prompt?: string | null
          hashtags?: string[] | null
          id?: string
          media_type?: string | null
          media_urls?: string[] | null
          performance_metrics?: Json | null
          platform?: string | null
          platform_post_id?: string | null
          property_id?: string | null
          published_at?: string | null
          rejection_reason?: string | null
          scheduled_for?: string | null
          status?: string | null
          template_id?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string | null
          variations?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "content_drafts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_drafts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_drafts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "content_drafts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "content_drafts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "content_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      content_templates: {
        Row: {
          content_type: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          platform: string[] | null
          prompt_template: string
          property_id: string | null
          sample_output: string | null
          updated_at: string | null
          variables: Json | null
        }
        Insert: {
          content_type: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          platform?: string[] | null
          prompt_template: string
          property_id?: string | null
          sample_output?: string | null
          updated_at?: string | null
          variables?: Json | null
        }
        Update: {
          content_type?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          platform?: string[] | null
          prompt_template?: string
          property_id?: string | null
          sample_output?: string | null
          updated_at?: string | null
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "content_templates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_templates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "content_templates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      conversation_analytics: {
        Row: {
          ai_messages: number | null
          avg_response_ms: number | null
          conversation_id: string | null
          created_at: string | null
          first_response_ms: number | null
          human_messages: number | null
          human_takeover: boolean | null
          id: string
          lead_captured: boolean | null
          property_id: string | null
          sentiment_score: number | null
          total_duration_seconds: number | null
          total_messages: number | null
          tour_booked: boolean | null
          user_messages: number | null
        }
        Insert: {
          ai_messages?: number | null
          avg_response_ms?: number | null
          conversation_id?: string | null
          created_at?: string | null
          first_response_ms?: number | null
          human_messages?: number | null
          human_takeover?: boolean | null
          id?: string
          lead_captured?: boolean | null
          property_id?: string | null
          sentiment_score?: number | null
          total_duration_seconds?: number | null
          total_messages?: number | null
          tour_booked?: boolean | null
          user_messages?: number | null
        }
        Update: {
          ai_messages?: number | null
          avg_response_ms?: number | null
          conversation_id?: string | null
          created_at?: string | null
          first_response_ms?: number | null
          human_messages?: number | null
          human_takeover?: boolean | null
          id?: string
          lead_captured?: boolean | null
          property_id?: string | null
          sentiment_score?: number | null
          total_duration_seconds?: number | null
          total_messages?: number | null
          tour_booked?: boolean | null
          user_messages?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_analytics_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_analytics_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_analytics_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "conversation_analytics_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      conversations: {
        Row: {
          channel: string | null
          created_at: string | null
          human_agent_id: string | null
          human_ended_at: string | null
          human_started_at: string | null
          human_takeover_at: string | null
          id: string
          is_human_mode: boolean | null
          lead_id: string | null
          property_id: string | null
          widget_session_id: string | null
        }
        Insert: {
          channel?: string | null
          created_at?: string | null
          human_agent_id?: string | null
          human_ended_at?: string | null
          human_started_at?: string | null
          human_takeover_at?: string | null
          id?: string
          is_human_mode?: boolean | null
          lead_id?: string | null
          property_id?: string | null
          widget_session_id?: string | null
        }
        Update: {
          channel?: string | null
          created_at?: string | null
          human_agent_id?: string | null
          human_ended_at?: string | null
          human_started_at?: string | null
          human_takeover_at?: string | null
          id?: string
          is_human_mode?: boolean | null
          lead_id?: string | null
          property_id?: string | null
          widget_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_human_agent_id_fkey"
            columns: ["human_agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "conversations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "conversations_widget_session_id_fkey"
            columns: ["widget_session_id"]
            isOneToOne: false
            referencedRelation: "widget_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_job_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          job_name: string
          request_id: string | null
          started_at: string
          status: string
          summary: Json | null
          trigger_source: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          job_name: string
          request_id?: string | null
          started_at?: string
          status: string
          summary?: Json | null
          trigger_source?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          job_name?: string
          request_id?: string | null
          started_at?: string
          status?: string
          summary?: Json | null
          trigger_source?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          content: string
          created_at: string | null
          embedding: string | null
          id: string
          metadata: Json | null
          original_file_name: string | null
          original_file_path: string | null
          original_file_size: number | null
          original_file_type: string | null
          original_file_url: string | null
          property_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json | null
          original_file_name?: string | null
          original_file_path?: string | null
          original_file_size?: number | null
          original_file_type?: string | null
          original_file_url?: string | null
          property_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json | null
          original_file_name?: string | null
          original_file_path?: string | null
          original_file_size?: number | null
          original_file_type?: string | null
          original_file_url?: string | null
          property_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "documents_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      email_configurations: {
        Row: {
          access_token: string | null
          account_email: string
          auth_source: string
          authorized_by_profile_id: string | null
          auto_reply_enabled: boolean | null
          created_at: string | null
          external_invite_id: string | null
          google_email: string | null
          health_check_error: string | null
          history_id: string | null
          id: string
          last_health_check_at: string | null
          last_sync_at: string | null
          profile_id: string | null
          property_id: string | null
          provider: string
          provider_metadata: Json
          provider_subject: string | null
          refresh_token: string | null
          scopes: string[]
          signature_template: string | null
          sync_enabled: boolean | null
          tenant_id: string | null
          token_expires_at: string | null
          token_status: string | null
          updated_at: string | null
          watch_expiration: string | null
        }
        Insert: {
          access_token?: string | null
          account_email: string
          auth_source?: string
          authorized_by_profile_id?: string | null
          auto_reply_enabled?: boolean | null
          created_at?: string | null
          external_invite_id?: string | null
          google_email?: string | null
          health_check_error?: string | null
          history_id?: string | null
          id?: string
          last_health_check_at?: string | null
          last_sync_at?: string | null
          profile_id?: string | null
          property_id?: string | null
          provider?: string
          provider_metadata?: Json
          provider_subject?: string | null
          refresh_token?: string | null
          scopes?: string[]
          signature_template?: string | null
          sync_enabled?: boolean | null
          tenant_id?: string | null
          token_expires_at?: string | null
          token_status?: string | null
          updated_at?: string | null
          watch_expiration?: string | null
        }
        Update: {
          access_token?: string | null
          account_email?: string
          auth_source?: string
          authorized_by_profile_id?: string | null
          auto_reply_enabled?: boolean | null
          created_at?: string | null
          external_invite_id?: string | null
          google_email?: string | null
          health_check_error?: string | null
          history_id?: string | null
          id?: string
          last_health_check_at?: string | null
          last_sync_at?: string | null
          profile_id?: string | null
          property_id?: string | null
          provider?: string
          provider_metadata?: Json
          provider_subject?: string | null
          refresh_token?: string | null
          scopes?: string[]
          signature_template?: string | null
          sync_enabled?: boolean | null
          tenant_id?: string | null
          token_expires_at?: string | null
          token_status?: string | null
          updated_at?: string | null
          watch_expiration?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_configurations_authorized_by_profile_id_fkey"
            columns: ["authorized_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_configurations_external_invite_id_fkey"
            columns: ["external_invite_id"]
            isOneToOne: false
            referencedRelation: "integration_auth_invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_configurations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_configurations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_configurations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "email_configurations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      email_messages: {
        Row: {
          ai_draft_approved: boolean | null
          ai_generated: boolean | null
          attachments: Json | null
          bcc_emails: string[] | null
          body_html: string | null
          body_text: string | null
          cc_emails: string[] | null
          created_at: string | null
          direction: string
          email_thread_id: string | null
          from_email: string
          from_name: string | null
          gmail_message_id: string
          has_attachments: boolean | null
          id: string
          internal_date: string | null
          labels: string[] | null
          provider_message_id: string
          snippet: string | null
          subject: string | null
          to_emails: string[]
        }
        Insert: {
          ai_draft_approved?: boolean | null
          ai_generated?: boolean | null
          attachments?: Json | null
          bcc_emails?: string[] | null
          body_html?: string | null
          body_text?: string | null
          cc_emails?: string[] | null
          created_at?: string | null
          direction: string
          email_thread_id?: string | null
          from_email: string
          from_name?: string | null
          gmail_message_id: string
          has_attachments?: boolean | null
          id?: string
          internal_date?: string | null
          labels?: string[] | null
          provider_message_id: string
          snippet?: string | null
          subject?: string | null
          to_emails: string[]
        }
        Update: {
          ai_draft_approved?: boolean | null
          ai_generated?: boolean | null
          attachments?: Json | null
          bcc_emails?: string[] | null
          body_html?: string | null
          body_text?: string | null
          cc_emails?: string[] | null
          created_at?: string | null
          direction?: string
          email_thread_id?: string | null
          from_email?: string
          from_name?: string | null
          gmail_message_id?: string
          has_attachments?: boolean | null
          id?: string
          internal_date?: string | null
          labels?: string[] | null
          provider_message_id?: string
          snippet?: string | null
          subject?: string | null
          to_emails?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_email_thread_id_fkey"
            columns: ["email_thread_id"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      email_threads: {
        Row: {
          conversation_id: string | null
          created_at: string | null
          direction: string | null
          email_configuration_id: string | null
          gmail_thread_id: string
          id: string
          last_message_at: string | null
          lead_id: string | null
          message_count: number | null
          property_id: string | null
          provider_thread_id: string
          status: string | null
          subject: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string | null
          direction?: string | null
          email_configuration_id?: string | null
          gmail_thread_id: string
          id?: string
          last_message_at?: string | null
          lead_id?: string | null
          message_count?: number | null
          property_id?: string | null
          provider_thread_id: string
          status?: string | null
          subject?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string | null
          direction?: string | null
          email_configuration_id?: string | null
          gmail_thread_id?: string
          id?: string
          last_message_at?: string | null
          lead_id?: string | null
          message_count?: number | null
          property_id?: string | null
          provider_thread_id?: string
          status?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_threads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_email_configuration_id_fkey"
            columns: ["email_configuration_id"]
            isOneToOne: false
            referencedRelation: "email_configurations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "email_threads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      email_token_refreshes: {
        Row: {
          created_at: string | null
          email_configuration_id: string | null
          error_message: string | null
          id: string
          new_expires_at: string | null
          old_expires_at: string | null
          refresh_status: string
        }
        Insert: {
          created_at?: string | null
          email_configuration_id?: string | null
          error_message?: string | null
          id?: string
          new_expires_at?: string | null
          old_expires_at?: string | null
          refresh_status: string
        }
        Update: {
          created_at?: string | null
          email_configuration_id?: string | null
          error_message?: string | null
          id?: string
          new_expires_at?: string | null
          old_expires_at?: string | null
          refresh_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_token_refreshes_email_configuration_id_fkey"
            columns: ["email_configuration_id"]
            isOneToOne: false
            referencedRelation: "email_configurations"
            referencedColumns: ["id"]
          },
        ]
      }
      fact_marketing_extended: {
        Row: {
          campaign_name: string | null
          channel_id: string
          created_at: string | null
          date_range_end: string
          date_range_start: string
          dimension_key: string
          dimension_value: string
          id: string
          metrics: Json
          property_id: string | null
          raw_source: string | null
          report_type: string
          updated_at: string | null
        }
        Insert: {
          campaign_name?: string | null
          channel_id: string
          created_at?: string | null
          date_range_end: string
          date_range_start: string
          dimension_key: string
          dimension_value: string
          id?: string
          metrics?: Json
          property_id?: string | null
          raw_source?: string | null
          report_type: string
          updated_at?: string | null
        }
        Update: {
          campaign_name?: string | null
          channel_id?: string
          created_at?: string | null
          date_range_end?: string
          date_range_start?: string
          dimension_key?: string
          dimension_value?: string
          id?: string
          metrics?: Json
          property_id?: string | null
          raw_source?: string | null
          report_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fact_marketing_extended_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fact_marketing_extended_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "fact_marketing_extended_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      fact_marketing_performance: {
        Row: {
          campaign_id: string
          campaign_name: string | null
          channel_id: string | null
          clicks: number | null
          conversions: number | null
          created_at: string | null
          date: string
          impressions: number | null
          property_id: string
          raw_source: string | null
          spend: number | null
        }
        Insert: {
          campaign_id: string
          campaign_name?: string | null
          channel_id?: string | null
          clicks?: number | null
          conversions?: number | null
          created_at?: string | null
          date: string
          impressions?: number | null
          property_id: string
          raw_source?: string | null
          spend?: number | null
        }
        Update: {
          campaign_id?: string
          campaign_name?: string | null
          channel_id?: string | null
          clicks?: number | null
          conversions?: number | null
          created_at?: string | null
          date?: string
          impressions?: number | null
          property_id?: string
          raw_source?: string | null
          spend?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fact_marketing_performance_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fact_marketing_performance_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "fact_marketing_performance_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      field_mapping_suggestions: {
        Row: {
          created_at: string | null
          crm_type: string
          final_crm_field: string | null
          id: string
          suggested_crm_field: string
          times_accepted: number | null
          times_corrected: number | null
          times_suggested: number | null
          tourspark_field: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          crm_type: string
          final_crm_field?: string | null
          id?: string
          suggested_crm_field: string
          times_accepted?: number | null
          times_corrected?: number | null
          times_suggested?: number | null
          tourspark_field: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          crm_type?: string
          final_crm_field?: string | null
          id?: string
          suggested_crm_field?: string
          times_accepted?: number | null
          times_corrected?: number | null
          times_suggested?: number | null
          tourspark_field?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      floorplans: {
        Row: {
          bathrooms: number | null
          bedrooms: number | null
          created_at: string | null
          id: string
          is_available: boolean | null
          metadata: Json | null
          name: string | null
          property_id: string
          rent_max: number | null
          rent_min: number | null
          sqft: number | null
          updated_at: string | null
        }
        Insert: {
          bathrooms?: number | null
          bedrooms?: number | null
          created_at?: string | null
          id?: string
          is_available?: boolean | null
          metadata?: Json | null
          name?: string | null
          property_id: string
          rent_max?: number | null
          rent_min?: number | null
          sqft?: number | null
          updated_at?: string | null
        }
        Update: {
          bathrooms?: number | null
          bedrooms?: number | null
          created_at?: string | null
          id?: string
          is_available?: boolean | null
          metadata?: Json | null
          name?: string | null
          property_id?: string
          rent_max?: number | null
          rent_min?: number | null
          sqft?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "floorplans_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplans_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "floorplans_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      follow_up_templates: {
        Row: {
          body: string
          channel: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          property_id: string | null
          slug: string
          subject: string | null
          updated_at: string | null
          variables: Json | null
        }
        Insert: {
          body: string
          channel: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          property_id?: string | null
          slug: string
          subject?: string | null
          updated_at?: string | null
          variables?: Json | null
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          property_id?: string | null
          slug?: string
          subject?: string | null
          updated_at?: string | null
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_templates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_templates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "follow_up_templates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      forgestudio_config: {
        Row: {
          auto_schedule: boolean | null
          brand_colors: Json | null
          brand_fonts: Json | null
          brand_voice: string | null
          created_at: string | null
          creativity_level: number | null
          default_ai_model: string | null
          facebook_connected: boolean | null
          facebook_page_id: string | null
          id: string
          include_cta: boolean | null
          include_hashtags: boolean | null
          instagram_account_id: string | null
          instagram_connected: boolean | null
          is_active: boolean | null
          key_amenities: string[] | null
          linkedin_connected: boolean | null
          linkedin_org_id: string | null
          max_caption_length: number | null
          nanobanana_default_style: string | null
          nanobanana_enabled: boolean | null
          nanobanana_quality: string | null
          preferred_posting_times: Json | null
          property_id: string | null
          target_audience: string | null
          tiktok_account_id: string | null
          tiktok_connected: boolean | null
          updated_at: string | null
        }
        Insert: {
          auto_schedule?: boolean | null
          brand_colors?: Json | null
          brand_fonts?: Json | null
          brand_voice?: string | null
          created_at?: string | null
          creativity_level?: number | null
          default_ai_model?: string | null
          facebook_connected?: boolean | null
          facebook_page_id?: string | null
          id?: string
          include_cta?: boolean | null
          include_hashtags?: boolean | null
          instagram_account_id?: string | null
          instagram_connected?: boolean | null
          is_active?: boolean | null
          key_amenities?: string[] | null
          linkedin_connected?: boolean | null
          linkedin_org_id?: string | null
          max_caption_length?: number | null
          nanobanana_default_style?: string | null
          nanobanana_enabled?: boolean | null
          nanobanana_quality?: string | null
          preferred_posting_times?: Json | null
          property_id?: string | null
          target_audience?: string | null
          tiktok_account_id?: string | null
          tiktok_connected?: boolean | null
          updated_at?: string | null
        }
        Update: {
          auto_schedule?: boolean | null
          brand_colors?: Json | null
          brand_fonts?: Json | null
          brand_voice?: string | null
          created_at?: string | null
          creativity_level?: number | null
          default_ai_model?: string | null
          facebook_connected?: boolean | null
          facebook_page_id?: string | null
          id?: string
          include_cta?: boolean | null
          include_hashtags?: boolean | null
          instagram_account_id?: string | null
          instagram_connected?: boolean | null
          is_active?: boolean | null
          key_amenities?: string[] | null
          linkedin_connected?: boolean | null
          linkedin_org_id?: string | null
          max_caption_length?: number | null
          nanobanana_default_style?: string | null
          nanobanana_enabled?: boolean | null
          nanobanana_quality?: string | null
          preferred_posting_times?: Json | null
          property_id?: string | null
          target_audience?: string | null
          tiktok_account_id?: string | null
          tiktok_connected?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forgestudio_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forgestudio_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "forgestudio_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      geo_ai_overviews: {
        Row: {
          created_at: string | null
          id: string
          observed_at: string | null
          property_id: string
          query_id: string
          source_url: string | null
          visible: boolean
        }
        Insert: {
          created_at?: string | null
          id?: string
          observed_at?: string | null
          property_id: string
          query_id: string
          source_url?: string | null
          visible?: boolean
        }
        Update: {
          created_at?: string | null
          id?: string
          observed_at?: string | null
          property_id?: string
          query_id?: string
          source_url?: string | null
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "geo_ai_overviews_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geo_ai_overviews_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "geo_ai_overviews_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "geo_ai_overviews_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "geo_queries"
            referencedColumns: ["id"]
          },
        ]
      }
      geo_answers: {
        Row: {
          analysis_method: string | null
          answer_summary: string | null
          created_at: string | null
          flags: Json | null
          id: string
          link_rank: number | null
          llm_rank: number | null
          natural_response: string | null
          ordered_entities: Json | null
          presence: boolean
          query_id: string
          raw_json: Json | null
          run_id: string
          sov: number | null
        }
        Insert: {
          analysis_method?: string | null
          answer_summary?: string | null
          created_at?: string | null
          flags?: Json | null
          id?: string
          link_rank?: number | null
          llm_rank?: number | null
          natural_response?: string | null
          ordered_entities?: Json | null
          presence: boolean
          query_id: string
          raw_json?: Json | null
          run_id: string
          sov?: number | null
        }
        Update: {
          analysis_method?: string | null
          answer_summary?: string | null
          created_at?: string | null
          flags?: Json | null
          id?: string
          link_rank?: number | null
          llm_rank?: number | null
          natural_response?: string | null
          ordered_entities?: Json | null
          presence?: boolean
          query_id?: string
          raw_json?: Json | null
          run_id?: string
          sov?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "geo_answers_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "geo_queries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geo_answers_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "geo_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      geo_citations: {
        Row: {
          answer_id: string
          created_at: string | null
          domain: string
          entity_ref: string | null
          id: string
          is_brand_domain: boolean | null
          url: string
        }
        Insert: {
          answer_id: string
          created_at?: string | null
          domain: string
          entity_ref?: string | null
          id?: string
          is_brand_domain?: boolean | null
          url: string
        }
        Update: {
          answer_id?: string
          created_at?: string | null
          domain?: string
          entity_ref?: string | null
          id?: string
          is_brand_domain?: boolean | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "geo_citations_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "geo_answers"
            referencedColumns: ["id"]
          },
        ]
      }
      geo_crawl_pages: {
        Row: {
          blocked_by_robots: boolean | null
          blocked_resources: Json | null
          canonical_url: string | null
          content_type: string | null
          crawl_depth: number | null
          crawl_id: string
          created_at: string | null
          external_links: Json | null
          fetch_error: string | null
          final_url: string | null
          h1s: Json | null
          h2s: Json | null
          html_bytes: number | null
          id: string
          images: Json | null
          in_sitemap: boolean | null
          inlink_count: number | null
          internal_links: Json | null
          meta_description: string | null
          meta_robots: string | null
          mixed_content: Json | null
          page_type: string | null
          redirect_chain: Json | null
          response_headers: Json | null
          status_code: number | null
          structured_data: Json | null
          text_html_ratio: number | null
          title: string | null
          url: string
          word_count: number | null
        }
        Insert: {
          blocked_by_robots?: boolean | null
          blocked_resources?: Json | null
          canonical_url?: string | null
          content_type?: string | null
          crawl_depth?: number | null
          crawl_id: string
          created_at?: string | null
          external_links?: Json | null
          fetch_error?: string | null
          final_url?: string | null
          h1s?: Json | null
          h2s?: Json | null
          html_bytes?: number | null
          id?: string
          images?: Json | null
          in_sitemap?: boolean | null
          inlink_count?: number | null
          internal_links?: Json | null
          meta_description?: string | null
          meta_robots?: string | null
          mixed_content?: Json | null
          page_type?: string | null
          redirect_chain?: Json | null
          response_headers?: Json | null
          status_code?: number | null
          structured_data?: Json | null
          text_html_ratio?: number | null
          title?: string | null
          url: string
          word_count?: number | null
        }
        Update: {
          blocked_by_robots?: boolean | null
          blocked_resources?: Json | null
          canonical_url?: string | null
          content_type?: string | null
          crawl_depth?: number | null
          crawl_id?: string
          created_at?: string | null
          external_links?: Json | null
          fetch_error?: string | null
          final_url?: string | null
          h1s?: Json | null
          h2s?: Json | null
          html_bytes?: number | null
          id?: string
          images?: Json | null
          in_sitemap?: boolean | null
          inlink_count?: number | null
          internal_links?: Json | null
          meta_description?: string | null
          meta_robots?: string | null
          mixed_content?: Json | null
          page_type?: string | null
          redirect_chain?: Json | null
          response_headers?: Json | null
          status_code?: number | null
          structured_data?: Json | null
          text_html_ratio?: number | null
          title?: string | null
          url?: string
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "geo_crawl_pages_crawl_id_fkey"
            columns: ["crawl_id"]
            isOneToOne: false
            referencedRelation: "geo_site_crawls"
            referencedColumns: ["id"]
          },
        ]
      }
      geo_property_config: {
        Row: {
          competitor_domains: string[] | null
          crawl_page_cap: number | null
          created_at: string | null
          domains: string[] | null
          id: string
          is_active: boolean | null
          last_run_at: string | null
          primary_geo: string | null
          property_id: string
          run_frequency: string | null
          updated_at: string | null
          visibility_target: number | null
        }
        Insert: {
          competitor_domains?: string[] | null
          crawl_page_cap?: number | null
          created_at?: string | null
          domains?: string[] | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          primary_geo?: string | null
          property_id: string
          run_frequency?: string | null
          updated_at?: string | null
          visibility_target?: number | null
        }
        Update: {
          competitor_domains?: string[] | null
          crawl_page_cap?: number | null
          created_at?: string | null
          domains?: string[] | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          primary_geo?: string | null
          property_id?: string
          run_frequency?: string | null
          updated_at?: string | null
          visibility_target?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "geo_property_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geo_property_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "geo_property_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      geo_queries: {
        Row: {
          created_at: string | null
          geo: string | null
          id: string
          is_active: boolean | null
          property_id: string
          run_count: number | null
          text: string
          type: Database["public"]["Enums"]["geo_query_type_enum"]
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          created_at?: string | null
          geo?: string | null
          id?: string
          is_active?: boolean | null
          property_id: string
          run_count?: number | null
          text: string
          type: Database["public"]["Enums"]["geo_query_type_enum"]
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          created_at?: string | null
          geo?: string | null
          id?: string
          is_active?: boolean | null
          property_id?: string
          run_count?: number | null
          text?: string
          type?: Database["public"]["Enums"]["geo_query_type_enum"]
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "geo_queries_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geo_queries_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "geo_queries_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      geo_recommendations: {
        Row: {
          batch_id: string | null
          crawl_id: string | null
          created_at: string | null
          generation_id: string
          grounding: Json | null
          id: string
          is_current: boolean
          model_used: string | null
          narrative: string
          owner: string | null
          priority: string
          property_id: string
          proposed_changes: Json | null
          status: Database["public"]["Enums"]["geo_finding_status_enum"]
          title: string
          type: string
          updated_at: string | null
        }
        Insert: {
          batch_id?: string | null
          crawl_id?: string | null
          created_at?: string | null
          generation_id?: string
          grounding?: Json | null
          id?: string
          is_current?: boolean
          model_used?: string | null
          narrative: string
          owner?: string | null
          priority?: string
          property_id: string
          proposed_changes?: Json | null
          status?: Database["public"]["Enums"]["geo_finding_status_enum"]
          title: string
          type: string
          updated_at?: string | null
        }
        Update: {
          batch_id?: string | null
          crawl_id?: string | null
          created_at?: string | null
          generation_id?: string
          grounding?: Json | null
          id?: string
          is_current?: boolean
          model_used?: string | null
          narrative?: string
          owner?: string | null
          priority?: string
          property_id?: string
          proposed_changes?: Json | null
          status?: Database["public"]["Enums"]["geo_finding_status_enum"]
          title?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "geo_recommendations_crawl_id_fkey"
            columns: ["crawl_id"]
            isOneToOne: false
            referencedRelation: "geo_site_crawls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geo_recommendations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geo_recommendations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "geo_recommendations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      geo_runs: {
        Row: {
          access_mode: string
          batch_id: string | null
          batch_size: number | null
          created_at: string | null
          cross_model_analysis: Json | null
          current_query_index: number | null
          error_message: string | null
          execution_count: number | null
          finished_at: string | null
          id: string
          last_updated_at: string | null
          measurement_mode: string
          model_name: string
          progress_pct: number | null
          prompt_source: string
          property_id: string
          provider_failure_reason: string | null
          query_count: number | null
          run_metadata: Json
          started_at: string | null
          status: Database["public"]["Enums"]["geo_run_status_enum"] | null
          surface: Database["public"]["Enums"]["geo_surface_enum"]
          uses_web_search: boolean | null
        }
        Insert: {
          access_mode?: string
          batch_id?: string | null
          batch_size?: number | null
          created_at?: string | null
          cross_model_analysis?: Json | null
          current_query_index?: number | null
          error_message?: string | null
          execution_count?: number | null
          finished_at?: string | null
          id?: string
          last_updated_at?: string | null
          measurement_mode?: string
          model_name: string
          progress_pct?: number | null
          prompt_source?: string
          property_id: string
          provider_failure_reason?: string | null
          query_count?: number | null
          run_metadata?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["geo_run_status_enum"] | null
          surface: Database["public"]["Enums"]["geo_surface_enum"]
          uses_web_search?: boolean | null
        }
        Update: {
          access_mode?: string
          batch_id?: string | null
          batch_size?: number | null
          created_at?: string | null
          cross_model_analysis?: Json | null
          current_query_index?: number | null
          error_message?: string | null
          execution_count?: number | null
          finished_at?: string | null
          id?: string
          last_updated_at?: string | null
          measurement_mode?: string
          model_name?: string
          progress_pct?: number | null
          prompt_source?: string
          property_id?: string
          provider_failure_reason?: string | null
          query_count?: number | null
          run_metadata?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["geo_run_status_enum"] | null
          surface?: Database["public"]["Enums"]["geo_surface_enum"]
          uses_web_search?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "geo_runs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geo_runs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "geo_runs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      geo_scores: {
        Row: {
          avg_link_rank: number | null
          avg_llm_rank: number | null
          avg_sov: number | null
          breakdown: Json | null
          created_at: string | null
          id: string
          overall_score: number
          query_scores: Json | null
          run_id: string
          visibility_pct: number
        }
        Insert: {
          avg_link_rank?: number | null
          avg_llm_rank?: number | null
          avg_sov?: number | null
          breakdown?: Json | null
          created_at?: string | null
          id?: string
          overall_score: number
          query_scores?: Json | null
          run_id: string
          visibility_pct: number
        }
        Update: {
          avg_link_rank?: number | null
          avg_llm_rank?: number | null
          avg_sov?: number | null
          breakdown?: Json | null
          created_at?: string | null
          id?: string
          overall_score?: number
          query_scores?: Json | null
          run_id?: string
          visibility_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "geo_scores_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "geo_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      geo_site_crawls: {
        Row: {
          batch_id: string | null
          crawl_state: Json | null
          created_at: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          last_updated_at: string | null
          llms_txt_summary: Json | null
          page_cap: number
          pages_crawled: number
          pages_discovered: number
          property_id: string
          robots_summary: Json | null
          seed_url: string
          sitemap_summary: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["geo_crawl_status_enum"]
        }
        Insert: {
          batch_id?: string | null
          crawl_state?: Json | null
          created_at?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          last_updated_at?: string | null
          llms_txt_summary?: Json | null
          page_cap?: number
          pages_crawled?: number
          pages_discovered?: number
          property_id: string
          robots_summary?: Json | null
          seed_url: string
          sitemap_summary?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["geo_crawl_status_enum"]
        }
        Update: {
          batch_id?: string | null
          crawl_state?: Json | null
          created_at?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          last_updated_at?: string | null
          llms_txt_summary?: Json | null
          page_cap?: number
          pages_crawled?: number
          pages_discovered?: number
          property_id?: string
          robots_summary?: Json | null
          seed_url?: string
          sitemap_summary?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["geo_crawl_status_enum"]
        }
        Relationships: [
          {
            foreignKeyName: "geo_site_crawls_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geo_site_crawls_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "geo_site_crawls_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      geo_site_findings: {
        Row: {
          affected_url_count: number
          affected_urls: Json | null
          category: string
          created_at: string | null
          description: string
          detector: string
          evidence: Json | null
          fingerprint: string
          first_detected_at: string
          fixed_at: string | null
          id: string
          last_seen_at: string
          notes: string | null
          occurrences: number
          owner: string | null
          property_id: string
          severity: Database["public"]["Enums"]["geo_finding_severity_enum"]
          source_crawl_id: string | null
          status: Database["public"]["Enums"]["geo_finding_status_enum"]
          title: string
          updated_at: string | null
        }
        Insert: {
          affected_url_count?: number
          affected_urls?: Json | null
          category: string
          created_at?: string | null
          description: string
          detector: string
          evidence?: Json | null
          fingerprint: string
          first_detected_at?: string
          fixed_at?: string | null
          id?: string
          last_seen_at?: string
          notes?: string | null
          occurrences?: number
          owner?: string | null
          property_id: string
          severity?: Database["public"]["Enums"]["geo_finding_severity_enum"]
          source_crawl_id?: string | null
          status?: Database["public"]["Enums"]["geo_finding_status_enum"]
          title: string
          updated_at?: string | null
        }
        Update: {
          affected_url_count?: number
          affected_urls?: Json | null
          category?: string
          created_at?: string | null
          description?: string
          detector?: string
          evidence?: Json | null
          fingerprint?: string
          first_detected_at?: string
          fixed_at?: string | null
          id?: string
          last_seen_at?: string
          notes?: string | null
          occurrences?: number
          owner?: string | null
          property_id?: string
          severity?: Database["public"]["Enums"]["geo_finding_severity_enum"]
          source_crawl_id?: string | null
          status?: Database["public"]["Enums"]["geo_finding_status_enum"]
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "geo_site_findings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geo_site_findings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "geo_site_findings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "geo_site_findings_source_crawl_id_fkey"
            columns: ["source_crawl_id"]
            isOneToOne: false
            referencedRelation: "geo_site_crawls"
            referencedColumns: ["id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          campaigns_found: number | null
          channels: string[] | null
          completed_at: string | null
          created_at: string | null
          current_step: string | null
          date_range: string | null
          error_message: string | null
          id: string
          progress_pct: number | null
          property_id: string | null
          records_imported: number | null
          started_at: string | null
          status: string | null
          triggered_by: string | null
        }
        Insert: {
          campaigns_found?: number | null
          channels?: string[] | null
          completed_at?: string | null
          created_at?: string | null
          current_step?: string | null
          date_range?: string | null
          error_message?: string | null
          id?: string
          progress_pct?: number | null
          property_id?: string | null
          records_imported?: number | null
          started_at?: string | null
          status?: string | null
          triggered_by?: string | null
        }
        Update: {
          campaigns_found?: number | null
          channels?: string[] | null
          completed_at?: string | null
          created_at?: string | null
          current_step?: string | null
          date_range?: string | null
          error_message?: string | null
          id?: string
          progress_pct?: number | null
          property_id?: string | null
          records_imported?: number | null
          started_at?: string | null
          status?: string | null
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "import_jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      integration_auth_invites: {
        Row: {
          consumed_at: string | null
          consumed_calendar_id: string | null
          consumed_email_configuration_id: string | null
          created_at: string
          created_by_profile_id: string | null
          expires_at: string
          id: string
          last_error: string | null
          metadata: Json
          property_id: string
          provider: string
          requested_capabilities: string[]
          revoked_at: string | null
          token_hash: string
          token_preview: string | null
          updated_at: string
        }
        Insert: {
          consumed_at?: string | null
          consumed_calendar_id?: string | null
          consumed_email_configuration_id?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          expires_at: string
          id?: string
          last_error?: string | null
          metadata?: Json
          property_id: string
          provider: string
          requested_capabilities?: string[]
          revoked_at?: string | null
          token_hash: string
          token_preview?: string | null
          updated_at?: string
        }
        Update: {
          consumed_at?: string | null
          consumed_calendar_id?: string | null
          consumed_email_configuration_id?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          expires_at?: string
          id?: string
          last_error?: string | null
          metadata?: Json
          property_id?: string
          provider?: string
          requested_capabilities?: string[]
          revoked_at?: string | null
          token_hash?: string
          token_preview?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_auth_invites_consumed_calendar_id_fkey"
            columns: ["consumed_calendar_id"]
            isOneToOne: false
            referencedRelation: "agent_calendars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_auth_invites_consumed_email_configuration_id_fkey"
            columns: ["consumed_email_configuration_id"]
            isOneToOne: false
            referencedRelation: "email_configurations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_auth_invites_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_auth_invites_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_auth_invites_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "integration_auth_invites_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      integration_credentials: {
        Row: {
          access_type: string | null
          account_id: string | null
          account_name: string | null
          created_at: string | null
          credentials: Json | null
          field_mapping: Json | null
          id: string
          last_error: string | null
          last_sync_at: string | null
          mapping_validated: boolean | null
          mapping_validated_at: string | null
          notes: string | null
          platform: string
          property_id: string | null
          status: string | null
          updated_at: string | null
          verification_method: string | null
          verified_at: string | null
        }
        Insert: {
          access_type?: string | null
          account_id?: string | null
          account_name?: string | null
          created_at?: string | null
          credentials?: Json | null
          field_mapping?: Json | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          mapping_validated?: boolean | null
          mapping_validated_at?: string | null
          notes?: string | null
          platform: string
          property_id?: string | null
          status?: string | null
          updated_at?: string | null
          verification_method?: string | null
          verified_at?: string | null
        }
        Update: {
          access_type?: string | null
          account_id?: string | null
          account_name?: string | null
          created_at?: string | null
          credentials?: Json | null
          field_mapping?: Json | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          mapping_validated?: boolean | null
          mapping_validated_at?: string | null
          notes?: string | null
          platform?: string
          property_id?: string | null
          status?: string | null
          updated_at?: string | null
          verification_method?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_credentials_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_credentials_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "integration_credentials_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      knowledge_sources: {
        Row: {
          created_at: string | null
          documents_created: number | null
          error_message: string | null
          extracted_data: Json | null
          file_name: string | null
          file_size: number | null
          file_type: string | null
          id: string
          last_synced_at: string | null
          processing_notes: string | null
          property_id: string | null
          source_name: string
          source_type: string
          source_url: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          documents_created?: number | null
          error_message?: string | null
          extracted_data?: Json | null
          file_name?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          last_synced_at?: string | null
          processing_notes?: string | null
          property_id?: string | null
          source_name: string
          source_type: string
          source_url?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          documents_created?: number | null
          error_message?: string | null
          extracted_data?: Json | null
          file_name?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          last_synced_at?: string | null
          processing_notes?: string | null
          property_id?: string | null
          source_name?: string
          source_type?: string
          source_url?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_sources_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_sources_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "knowledge_sources_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      lead_activities: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          lead_id: string | null
          metadata: Json | null
          type: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          type: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_engagement_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          lead_id: string
          metadata: Json | null
          property_id: string | null
          score_weight: number | null
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          lead_id: string
          metadata?: Json | null
          property_id?: string | null
          score_weight?: number | null
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          lead_id?: string
          metadata?: Json | null
          property_id?: string | null
          score_weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_engagement_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_engagement_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_engagement_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "lead_engagement_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      lead_scores: {
        Row: {
          behavior_score: number | null
          completeness_score: number | null
          created_at: string | null
          engagement_score: number | null
          expires_at: string | null
          factors: Json | null
          id: string
          lead_id: string
          model_version: string | null
          score_bucket: string
          scored_at: string
          source_score: number | null
          timing_score: number | null
          total_score: number
        }
        Insert: {
          behavior_score?: number | null
          completeness_score?: number | null
          created_at?: string | null
          engagement_score?: number | null
          expires_at?: string | null
          factors?: Json | null
          id?: string
          lead_id: string
          model_version?: string | null
          score_bucket: string
          scored_at?: string
          source_score?: number | null
          timing_score?: number | null
          total_score: number
        }
        Update: {
          behavior_score?: number | null
          completeness_score?: number | null
          created_at?: string | null
          engagement_score?: number | null
          expires_at?: string | null
          factors?: Json | null
          id?: string
          lead_id?: string
          model_version?: string | null
          score_bucket?: string
          scored_at?: string
          source_score?: number | null
          timing_score?: number | null
          total_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_scores_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_workflows: {
        Row: {
          created_at: string | null
          current_step: number | null
          id: string
          last_action_at: string | null
          lead_id: string | null
          metadata: Json | null
          next_action_at: string | null
          status: string
          updated_at: string | null
          workflow_id: string | null
        }
        Insert: {
          created_at?: string | null
          current_step?: number | null
          id?: string
          last_action_at?: string | null
          lead_id?: string | null
          metadata?: Json | null
          next_action_at?: string | null
          status?: string
          updated_at?: string | null
          workflow_id?: string | null
        }
        Update: {
          created_at?: string | null
          current_step?: number | null
          id?: string
          last_action_at?: string | null
          lead_id?: string | null
          metadata?: Json | null
          next_action_at?: string | null
          status?: string
          updated_at?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_workflows_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_workflows_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflow_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          bedrooms: string | null
          created_at: string | null
          crm_dead_lettered_at: string | null
          crm_sync_error: string | null
          crm_sync_next_retry_at: string | null
          crm_sync_retry_count: number
          crm_sync_status: string | null
          crm_synced_at: string | null
          email: string | null
          external_crm_id: string | null
          first_name: string | null
          id: string
          last_contacted_at: string | null
          last_name: string | null
          move_in_date: string | null
          notes: string | null
          opted_out: boolean | null
          phone: string | null
          property_id: string | null
          score: number | null
          score_bucket: string | null
          source: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          bedrooms?: string | null
          created_at?: string | null
          crm_dead_lettered_at?: string | null
          crm_sync_error?: string | null
          crm_sync_next_retry_at?: string | null
          crm_sync_retry_count?: number
          crm_sync_status?: string | null
          crm_synced_at?: string | null
          email?: string | null
          external_crm_id?: string | null
          first_name?: string | null
          id?: string
          last_contacted_at?: string | null
          last_name?: string | null
          move_in_date?: string | null
          notes?: string | null
          opted_out?: boolean | null
          phone?: string | null
          property_id?: string | null
          score?: number | null
          score_bucket?: string | null
          source?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          bedrooms?: string | null
          created_at?: string | null
          crm_dead_lettered_at?: string | null
          crm_sync_error?: string | null
          crm_sync_next_retry_at?: string | null
          crm_sync_retry_count?: number
          crm_sync_status?: string | null
          crm_synced_at?: string | null
          email?: string | null
          external_crm_id?: string | null
          first_name?: string | null
          id?: string
          last_contacted_at?: string | null
          last_name?: string | null
          move_in_date?: string | null
          notes?: string | null
          opted_out?: boolean | null
          phone?: string | null
          property_id?: string | null
          score?: number | null
          score_bucket?: string | null
          source?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "leads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      lumaleasing_config: {
        Row: {
          api_key: string | null
          auto_popup_delay_seconds: number | null
          business_hours: Json | null
          collect_email: boolean | null
          collect_name: boolean | null
          collect_phone: boolean | null
          created_at: string | null
          email_configuration_id: string | null
          email_enabled: boolean | null
          id: string
          is_active: boolean | null
          lead_capture_prompt: string | null
          logo_url: string | null
          offline_message: string | null
          primary_color: string | null
          property_id: string | null
          require_email_before_chat: boolean | null
          secondary_color: string | null
          timezone: string | null
          tour_buffer_minutes: number | null
          tour_duration_minutes: number | null
          tours_enabled: boolean | null
          updated_at: string | null
          welcome_message: string | null
          widget_name: string | null
        }
        Insert: {
          api_key?: string | null
          auto_popup_delay_seconds?: number | null
          business_hours?: Json | null
          collect_email?: boolean | null
          collect_name?: boolean | null
          collect_phone?: boolean | null
          created_at?: string | null
          email_configuration_id?: string | null
          email_enabled?: boolean | null
          id?: string
          is_active?: boolean | null
          lead_capture_prompt?: string | null
          logo_url?: string | null
          offline_message?: string | null
          primary_color?: string | null
          property_id?: string | null
          require_email_before_chat?: boolean | null
          secondary_color?: string | null
          timezone?: string | null
          tour_buffer_minutes?: number | null
          tour_duration_minutes?: number | null
          tours_enabled?: boolean | null
          updated_at?: string | null
          welcome_message?: string | null
          widget_name?: string | null
        }
        Update: {
          api_key?: string | null
          auto_popup_delay_seconds?: number | null
          business_hours?: Json | null
          collect_email?: boolean | null
          collect_name?: boolean | null
          collect_phone?: boolean | null
          created_at?: string | null
          email_configuration_id?: string | null
          email_enabled?: boolean | null
          id?: string
          is_active?: boolean | null
          lead_capture_prompt?: string | null
          logo_url?: string | null
          offline_message?: string | null
          primary_color?: string | null
          property_id?: string | null
          require_email_before_chat?: boolean | null
          secondary_color?: string | null
          timezone?: string | null
          tour_buffer_minutes?: number | null
          tour_duration_minutes?: number | null
          tours_enabled?: boolean | null
          updated_at?: string | null
          welcome_message?: string | null
          widget_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lumaleasing_config_email_configuration_id_fkey"
            columns: ["email_configuration_id"]
            isOneToOne: false
            referencedRelation: "email_configurations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lumaleasing_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lumaleasing_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "lumaleasing_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      market_alerts: {
        Row: {
          alert_type: string
          competitor_id: string | null
          created_at: string | null
          data: Json | null
          description: string | null
          id: string
          is_dismissed: boolean | null
          is_read: boolean | null
          property_id: string
          read_at: string | null
          severity: string | null
          title: string
        }
        Insert: {
          alert_type: string
          competitor_id?: string | null
          created_at?: string | null
          data?: Json | null
          description?: string | null
          id?: string
          is_dismissed?: boolean | null
          is_read?: boolean | null
          property_id: string
          read_at?: string | null
          severity?: string | null
          title: string
        }
        Update: {
          alert_type?: string
          competitor_id?: string | null
          created_at?: string | null
          data?: Json | null
          description?: string | null
          id?: string
          is_dismissed?: boolean | null
          is_read?: boolean | null
          property_id?: string
          read_at?: string | null
          severity?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_alerts_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_alerts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_alerts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "market_alerts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      market_insights: {
        Row: {
          created_at: string | null
          data: Json
          expires_at: string | null
          generated_at: string | null
          id: string
          insight_type: string
          period_end: string | null
          period_start: string | null
          property_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          data: Json
          expires_at?: string | null
          generated_at?: string | null
          id?: string
          insight_type: string
          period_end?: string | null
          period_start?: string | null
          property_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          data?: Json
          expires_at?: string | null
          generated_at?: string | null
          id?: string
          insight_type?: string
          period_end?: string | null
          period_start?: string | null
          property_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "market_insights_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_insights_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "market_insights_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      market_observations: {
        Row: {
          capture_id: string | null
          competitor_id: string | null
          confidence: number | null
          created_at: string | null
          entity_key: string | null
          id: string
          observation_type: string
          observed_at: string
          property_id: string
          superseded_by: string | null
          value: Json
        }
        Insert: {
          capture_id?: string | null
          competitor_id?: string | null
          confidence?: number | null
          created_at?: string | null
          entity_key?: string | null
          id?: string
          observation_type: string
          observed_at?: string
          property_id: string
          superseded_by?: string | null
          value?: Json
        }
        Update: {
          capture_id?: string | null
          competitor_id?: string | null
          confidence?: number | null
          created_at?: string | null
          entity_key?: string | null
          id?: string
          observation_type?: string
          observed_at?: string
          property_id?: string
          superseded_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "market_observations_capture_id_fkey"
            columns: ["capture_id"]
            isOneToOne: false
            referencedRelation: "market_source_captures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_observations_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_observations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_observations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "market_observations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "market_observations_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "market_observations"
            referencedColumns: ["id"]
          },
        ]
      }
      market_source_captures: {
        Row: {
          captured_at: string
          competitor_id: string | null
          content_hash: string | null
          created_at: string | null
          effective_at: string | null
          error_message: string | null
          id: string
          property_id: string
          raw_ref: string | null
          source_type: string
          source_url: string | null
          status: string
        }
        Insert: {
          captured_at?: string
          competitor_id?: string | null
          content_hash?: string | null
          created_at?: string | null
          effective_at?: string | null
          error_message?: string | null
          id?: string
          property_id: string
          raw_ref?: string | null
          source_type: string
          source_url?: string | null
          status?: string
        }
        Update: {
          captured_at?: string
          competitor_id?: string | null
          content_hash?: string | null
          created_at?: string | null
          effective_at?: string | null
          error_message?: string | null
          id?: string
          property_id?: string
          raw_ref?: string | null
          source_type?: string
          source_url?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_source_captures_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_source_captures_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_source_captures_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "market_source_captures_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      marketing_data_uploads: {
        Row: {
          created_at: string | null
          date_range_end: string | null
          date_range_start: string | null
          file_name: string | null
          id: string
          platform: string
          property_id: string | null
          report_type: string
          rows_imported: number | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          date_range_end?: string | null
          date_range_start?: string | null
          file_name?: string | null
          id?: string
          platform: string
          property_id?: string | null
          report_type: string
          rows_imported?: number | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          date_range_end?: string | null
          date_range_start?: string | null
          file_name?: string | null
          id?: string
          platform?: string
          property_id?: string | null
          report_type?: string
          rows_imported?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_data_uploads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_data_uploads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "marketing_data_uploads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      mcp_audit_log: {
        Row: {
          created_at: string | null
          error_message: string | null
          execution_time_ms: number | null
          id: string
          operation_type: string
          parameters: Json | null
          platform: string
          property_id: string | null
          result: Json | null
          success: boolean | null
          tool_name: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          operation_type?: string
          parameters?: Json | null
          platform: string
          property_id?: string | null
          result?: Json | null
          success?: boolean | null
          tool_name: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          operation_type?: string
          parameters?: Json | null
          platform?: string
          property_id?: string | null
          result?: Json | null
          success?: boolean | null
          tool_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_audit_log_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_audit_log_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "mcp_audit_log_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string | null
          conversation_id: string | null
          created_at: string | null
          id: string
          role: string | null
        }
        Insert: {
          content?: string | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          role?: string | null
        }
        Update: {
          content?: string | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_goals: {
        Row: {
          alert_threshold_percent: number | null
          created_at: string | null
          created_by: string | null
          goal_type: string
          id: string
          is_active: boolean
          is_inverse: boolean
          metric_key: string
          property_id: string
          target_value: number
          updated_at: string | null
        }
        Insert: {
          alert_threshold_percent?: number | null
          created_at?: string | null
          created_by?: string | null
          goal_type?: string
          id?: string
          is_active?: boolean
          is_inverse?: boolean
          metric_key: string
          property_id: string
          target_value: number
          updated_at?: string | null
        }
        Update: {
          alert_threshold_percent?: number | null
          created_at?: string | null
          created_by?: string | null
          goal_type?: string
          id?: string
          is_active?: boolean
          is_inverse?: boolean
          metric_key?: string
          property_id?: string
          target_value?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metric_goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_goals_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_goals_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "metric_goals_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      onboarding_tasks: {
        Row: {
          assigned_to: string | null
          blocked_reason: string | null
          category: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          description: string | null
          due_date: string | null
          id: string
          metadata: Json | null
          notes: string | null
          priority: number | null
          property_id: string | null
          status: string | null
          task_name: string
          task_type: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          blocked_reason?: string | null
          category?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          priority?: number | null
          property_id?: string | null
          status?: string | null
          task_name: string
          task_type: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          blocked_reason?: string | null
          category?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          priority?: number | null
          property_id?: string | null
          status?: string | null
          task_name?: string
          task_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "onboarding_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          id: string
          name: string
          settings: Json | null
          subscription_tier: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          settings?: Json | null
          subscription_tier?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          settings?: Json | null
          subscription_tier?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          full_name: string | null
          id: string
          org_id: string | null
          preferences: Json | null
          role: string | null
        }
        Insert: {
          created_at?: string | null
          full_name?: string | null
          id: string
          org_id?: string | null
          preferences?: Json | null
          role?: string | null
        }
        Update: {
          created_at?: string | null
          full_name?: string | null
          id?: string
          org_id?: string | null
          preferences?: Json | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: Json | null
          amenities: string[] | null
          brand_voice: string | null
          created_at: string | null
          id: string
          name: string
          office_hours: Json | null
          onboarding_completed_at: string | null
          org_id: string | null
          parking_info: Json | null
          pet_policy: Json | null
          property_type: string | null
          settings: Json | null
          social_media: Json | null
          special_features: string[] | null
          target_audience: string | null
          unit_count: number | null
          updated_at: string | null
          website_url: string | null
          year_built: number | null
        }
        Insert: {
          address?: Json | null
          amenities?: string[] | null
          brand_voice?: string | null
          created_at?: string | null
          id?: string
          name: string
          office_hours?: Json | null
          onboarding_completed_at?: string | null
          org_id?: string | null
          parking_info?: Json | null
          pet_policy?: Json | null
          property_type?: string | null
          settings?: Json | null
          social_media?: Json | null
          special_features?: string[] | null
          target_audience?: string | null
          unit_count?: number | null
          updated_at?: string | null
          website_url?: string | null
          year_built?: number | null
        }
        Update: {
          address?: Json | null
          amenities?: string[] | null
          brand_voice?: string | null
          created_at?: string | null
          id?: string
          name?: string
          office_hours?: Json | null
          onboarding_completed_at?: string | null
          org_id?: string | null
          parking_info?: Json | null
          pet_policy?: Json | null
          property_type?: string | null
          settings?: Json | null
          social_media?: Json | null
          special_features?: string[] | null
          target_audience?: string | null
          unit_count?: number | null
          updated_at?: string | null
          website_url?: string | null
          year_built?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      property_brand_assets: {
        Row: {
          brand_book_pdf_url: string | null
          competitive_analysis: Json | null
          competitor_ids: string[] | null
          conversation_summary: Json | null
          created_at: string | null
          current_step: number | null
          current_step_name: string | null
          draft_section: Json | null
          gemini_conversation_history: Json | null
          generated_by: string | null
          generation_status: string | null
          id: string
          model_version: string | null
          pdf_generated_at: string | null
          property_id: string | null
          section_1_introduction: Json | null
          section_10_photo_yep: Json | null
          section_11_photo_nope: Json | null
          section_12_implementation: Json | null
          section_2_positioning: Json | null
          section_3_target_audience: Json | null
          section_4_personas: Json | null
          section_5_name_story: Json | null
          section_6_logo: Json | null
          section_7_typography: Json | null
          section_8_colors: Json | null
          section_9_design_elements: Json | null
          updated_at: string | null
          vision_board_url: string | null
        }
        Insert: {
          brand_book_pdf_url?: string | null
          competitive_analysis?: Json | null
          competitor_ids?: string[] | null
          conversation_summary?: Json | null
          created_at?: string | null
          current_step?: number | null
          current_step_name?: string | null
          draft_section?: Json | null
          gemini_conversation_history?: Json | null
          generated_by?: string | null
          generation_status?: string | null
          id?: string
          model_version?: string | null
          pdf_generated_at?: string | null
          property_id?: string | null
          section_1_introduction?: Json | null
          section_10_photo_yep?: Json | null
          section_11_photo_nope?: Json | null
          section_12_implementation?: Json | null
          section_2_positioning?: Json | null
          section_3_target_audience?: Json | null
          section_4_personas?: Json | null
          section_5_name_story?: Json | null
          section_6_logo?: Json | null
          section_7_typography?: Json | null
          section_8_colors?: Json | null
          section_9_design_elements?: Json | null
          updated_at?: string | null
          vision_board_url?: string | null
        }
        Update: {
          brand_book_pdf_url?: string | null
          competitive_analysis?: Json | null
          competitor_ids?: string[] | null
          conversation_summary?: Json | null
          created_at?: string | null
          current_step?: number | null
          current_step_name?: string | null
          draft_section?: Json | null
          gemini_conversation_history?: Json | null
          generated_by?: string | null
          generation_status?: string | null
          id?: string
          model_version?: string | null
          pdf_generated_at?: string | null
          property_id?: string | null
          section_1_introduction?: Json | null
          section_10_photo_yep?: Json | null
          section_11_photo_nope?: Json | null
          section_12_implementation?: Json | null
          section_2_positioning?: Json | null
          section_3_target_audience?: Json | null
          section_4_personas?: Json | null
          section_5_name_story?: Json | null
          section_6_logo?: Json | null
          section_7_typography?: Json | null
          section_8_colors?: Json | null
          section_9_design_elements?: Json | null
          updated_at?: string | null
          vision_board_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_brand_assets_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_brand_assets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_brand_assets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_brand_assets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      property_chatbot_context_revisions: {
        Row: {
          change_summary: string | null
          changed_source_ids: string[]
          context_id: string | null
          created_at: string
          id: string
          model: string | null
          next_context_json: Json
          previous_context_json: Json | null
          property_id: string
          removed_source_ids: string[]
        }
        Insert: {
          change_summary?: string | null
          changed_source_ids?: string[]
          context_id?: string | null
          created_at?: string
          id?: string
          model?: string | null
          next_context_json?: Json
          previous_context_json?: Json | null
          property_id: string
          removed_source_ids?: string[]
        }
        Update: {
          change_summary?: string | null
          changed_source_ids?: string[]
          context_id?: string | null
          created_at?: string
          id?: string
          model?: string | null
          next_context_json?: Json
          previous_context_json?: Json | null
          property_id?: string
          removed_source_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "property_chatbot_context_revisions_context_id_fkey"
            columns: ["context_id"]
            isOneToOne: false
            referencedRelation: "property_chatbot_contexts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_chatbot_context_revisions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_chatbot_context_revisions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_chatbot_context_revisions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      property_chatbot_contexts: {
        Row: {
          context_json: Json
          context_markdown: string
          created_at: string
          error_message: string | null
          id: string
          last_change_summary: string | null
          last_generated_at: string | null
          model: string | null
          property_id: string
          requires_review: boolean
          source_ids: string[]
          source_snapshot: Json
          stale_at: string | null
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          context_json?: Json
          context_markdown?: string
          created_at?: string
          error_message?: string | null
          id?: string
          last_change_summary?: string | null
          last_generated_at?: string | null
          model?: string | null
          property_id: string
          requires_review?: boolean
          source_ids?: string[]
          source_snapshot?: Json
          stale_at?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          context_json?: Json
          context_markdown?: string
          created_at?: string
          error_message?: string | null
          id?: string
          last_change_summary?: string | null
          last_generated_at?: string | null
          model?: string | null
          property_id?: string
          requires_review?: boolean
          source_ids?: string[]
          source_snapshot?: Json
          stale_at?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "property_chatbot_contexts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_chatbot_contexts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_chatbot_contexts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      property_contacts: {
        Row: {
          billing_address: Json | null
          billing_method: string | null
          contact_type: string
          created_at: string | null
          email: string
          id: string
          is_primary: boolean | null
          name: string
          needs_w9: boolean | null
          phone: string | null
          property_id: string | null
          role: string | null
          special_instructions: string | null
          updated_at: string | null
        }
        Insert: {
          billing_address?: Json | null
          billing_method?: string | null
          contact_type: string
          created_at?: string | null
          email: string
          id?: string
          is_primary?: boolean | null
          name: string
          needs_w9?: boolean | null
          phone?: string | null
          property_id?: string | null
          role?: string | null
          special_instructions?: string | null
          updated_at?: string | null
        }
        Update: {
          billing_address?: Json | null
          billing_method?: string | null
          contact_type?: string
          created_at?: string | null
          email?: string
          id?: string
          is_primary?: boolean | null
          name?: string
          needs_w9?: boolean | null
          phone?: string | null
          property_id?: string | null
          role?: string | null
          special_instructions?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_contacts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_contacts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "community_contacts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      property_photos: {
        Row: {
          alt_text: string | null
          category: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          property_id: string
          sort_order: number | null
          updated_at: string | null
          url: string
        }
        Insert: {
          alt_text?: string | null
          category?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          property_id: string
          sort_order?: number | null
          updated_at?: string | null
          url: string
        }
        Update: {
          alt_text?: string | null
          category?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          property_id?: string
          sort_order?: number | null
          updated_at?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_photos_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_photos_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_photos_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      property_price_history: {
        Row: {
          available_count: number | null
          id: string
          property_unit_id: string | null
          recorded_at: string | null
          rent_max: number | null
          rent_min: number | null
          source: string | null
        }
        Insert: {
          available_count?: number | null
          id?: string
          property_unit_id?: string | null
          recorded_at?: string | null
          rent_max?: number | null
          rent_min?: number | null
          source?: string | null
        }
        Update: {
          available_count?: number | null
          id?: string
          property_unit_id?: string | null
          recorded_at?: string | null
          rent_max?: number | null
          rent_min?: number | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_price_history_property_unit_id_fkey"
            columns: ["property_unit_id"]
            isOneToOne: false
            referencedRelation: "property_units"
            referencedColumns: ["id"]
          },
        ]
      }
      property_units: {
        Row: {
          available_count: number | null
          bathrooms: number | null
          bedrooms: number
          created_at: string | null
          deposit: number | null
          id: string
          last_updated_at: string | null
          move_in_specials: string | null
          property_id: string
          rent_max: number | null
          rent_min: number | null
          source: string | null
          source_url: string | null
          sqft_max: number | null
          sqft_min: number | null
          unit_type: string
        }
        Insert: {
          available_count?: number | null
          bathrooms?: number | null
          bedrooms?: number
          created_at?: string | null
          deposit?: number | null
          id?: string
          last_updated_at?: string | null
          move_in_specials?: string | null
          property_id: string
          rent_max?: number | null
          rent_min?: number | null
          source?: string | null
          source_url?: string | null
          sqft_max?: number | null
          sqft_min?: number | null
          unit_type: string
        }
        Update: {
          available_count?: number | null
          bathrooms?: number | null
          bedrooms?: number
          created_at?: string | null
          deposit?: number | null
          id?: string
          last_updated_at?: string | null
          move_in_specials?: string | null
          property_id?: string
          rent_max?: number | null
          rent_min?: number | null
          source?: string | null
          source_url?: string | null
          sqft_max?: number | null
          sqft_min?: number | null
          unit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      property_websites: {
        Row: {
          assets_manifest: Json | null
          blueprint: Json | null
          brand_confidence: number | null
          brand_source: string | null
          conversion_rate: number | null
          created_at: string | null
          current_step: string | null
          deployed_at: string | null
          error_message: string | null
          generation_completed_at: string | null
          generation_duration_seconds: number | null
          generation_input: Json | null
          generation_progress: number | null
          generation_started_at: string | null
          generation_status: string | null
          id: string
          org_id: string | null
          page_views: number | null
          pages_generated: Json | null
          previous_version_id: string | null
          property_id: string
          site_architecture: Json | null
          site_blueprint: Json | null
          site_blueprint_updated_at: string | null
          site_blueprint_version: number
          tour_requests: number | null
          updated_at: string | null
          user_preferences: Json | null
          version: number | null
          wp_admin_url: string | null
          wp_credentials: Json | null
          wp_instance_id: string | null
          wp_url: string | null
        }
        Insert: {
          assets_manifest?: Json | null
          blueprint?: Json | null
          brand_confidence?: number | null
          brand_source?: string | null
          conversion_rate?: number | null
          created_at?: string | null
          current_step?: string | null
          deployed_at?: string | null
          error_message?: string | null
          generation_completed_at?: string | null
          generation_duration_seconds?: number | null
          generation_input?: Json | null
          generation_progress?: number | null
          generation_started_at?: string | null
          generation_status?: string | null
          id?: string
          org_id?: string | null
          page_views?: number | null
          pages_generated?: Json | null
          previous_version_id?: string | null
          property_id: string
          site_architecture?: Json | null
          site_blueprint?: Json | null
          site_blueprint_updated_at?: string | null
          site_blueprint_version?: number
          tour_requests?: number | null
          updated_at?: string | null
          user_preferences?: Json | null
          version?: number | null
          wp_admin_url?: string | null
          wp_credentials?: Json | null
          wp_instance_id?: string | null
          wp_url?: string | null
        }
        Update: {
          assets_manifest?: Json | null
          blueprint?: Json | null
          brand_confidence?: number | null
          brand_source?: string | null
          conversion_rate?: number | null
          created_at?: string | null
          current_step?: string | null
          deployed_at?: string | null
          error_message?: string | null
          generation_completed_at?: string | null
          generation_duration_seconds?: number | null
          generation_input?: Json | null
          generation_progress?: number | null
          generation_started_at?: string | null
          generation_status?: string | null
          id?: string
          org_id?: string | null
          page_views?: number | null
          pages_generated?: Json | null
          previous_version_id?: string | null
          property_id?: string
          site_architecture?: Json | null
          site_blueprint?: Json | null
          site_blueprint_updated_at?: string | null
          site_blueprint_version?: number
          tour_requests?: number | null
          updated_at?: string | null
          user_preferences?: Json | null
          version?: number | null
          wp_admin_url?: string | null
          wp_credentials?: Json | null
          wp_instance_id?: string | null
          wp_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_websites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_websites_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "property_websites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_websites_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "website_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_websites_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_websites_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_websites_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      published_posts: {
        Row: {
          comments_count: number | null
          content_draft_id: string | null
          created_at: string | null
          engagement_metrics: Json | null
          error_message: string | null
          id: string
          impressions: number | null
          likes_count: number | null
          metrics_updated_at: string | null
          platform_post_id: string | null
          platform_post_url: string | null
          published_at: string | null
          reach: number | null
          shares_count: number | null
          social_connection_id: string | null
          status: string | null
        }
        Insert: {
          comments_count?: number | null
          content_draft_id?: string | null
          created_at?: string | null
          engagement_metrics?: Json | null
          error_message?: string | null
          id?: string
          impressions?: number | null
          likes_count?: number | null
          metrics_updated_at?: string | null
          platform_post_id?: string | null
          platform_post_url?: string | null
          published_at?: string | null
          reach?: number | null
          shares_count?: number | null
          social_connection_id?: string | null
          status?: string | null
        }
        Update: {
          comments_count?: number | null
          content_draft_id?: string | null
          created_at?: string | null
          engagement_metrics?: Json | null
          error_message?: string | null
          id?: string
          impressions?: number | null
          likes_count?: number | null
          metrics_updated_at?: string | null
          platform_post_id?: string | null
          platform_post_url?: string | null
          published_at?: string | null
          reach?: number | null
          shares_count?: number | null
          social_connection_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "published_posts_content_draft_id_fkey"
            columns: ["content_draft_id"]
            isOneToOne: false
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_posts_social_connection_id_fkey"
            columns: ["social_connection_id"]
            isOneToOne: false
            referencedRelation: "social_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      report_send_history: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          metrics_snapshot: Json | null
          recipients_count: number
          report_date_end: string | null
          report_date_start: string | null
          scheduled_report_id: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          metrics_snapshot?: Json | null
          recipients_count?: number
          report_date_end?: string | null
          report_date_start?: string | null
          scheduled_report_id: string
          status: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          metrics_snapshot?: Json | null
          recipients_count?: number
          report_date_end?: string | null
          report_date_start?: string | null
          scheduled_report_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_send_history_scheduled_report_id_fkey"
            columns: ["scheduled_report_id"]
            isOneToOne: false
            referencedRelation: "scheduled_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      reputation_case_events: {
        Row: {
          actor_label: string | null
          actor_profile_id: string | null
          case_id: string
          created_at: string
          event_type: string
          id: string
          payload: Json
          property_id: string | null
        }
        Insert: {
          actor_label?: string | null
          actor_profile_id?: string | null
          case_id: string
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          property_id?: string | null
        }
        Update: {
          actor_label?: string | null
          actor_profile_id?: string | null
          case_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          property_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reputation_case_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reputation_case_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "reputation_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reputation_case_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reputation_case_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "reputation_case_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      reputation_cases: {
        Row: {
          created_at: string
          id: string
          issue_domains: Json
          journey_stage: string | null
          last_activity_at: string
          owner_profile_id: string | null
          policy_class: string | null
          priority: string
          property_id: string
          remediation_state: string
          reopened_count: number
          resolution_notes: string | null
          resolved_at: string | null
          review_id: string
          risk_class: string | null
          root_cause: string | null
          sla_due_at: string | null
          source_ticket_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          issue_domains?: Json
          journey_stage?: string | null
          last_activity_at?: string
          owner_profile_id?: string | null
          policy_class?: string | null
          priority?: string
          property_id: string
          remediation_state?: string
          reopened_count?: number
          resolution_notes?: string | null
          resolved_at?: string | null
          review_id: string
          risk_class?: string | null
          root_cause?: string | null
          sla_due_at?: string | null
          source_ticket_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          issue_domains?: Json
          journey_stage?: string | null
          last_activity_at?: string
          owner_profile_id?: string | null
          policy_class?: string | null
          priority?: string
          property_id?: string
          remediation_state?: string
          reopened_count?: number
          resolution_notes?: string | null
          resolved_at?: string | null
          review_id?: string
          risk_class?: string | null
          root_cause?: string | null
          sla_due_at?: string | null
          source_ticket_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reputation_cases_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reputation_cases_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reputation_cases_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "reputation_cases_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "reputation_cases_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: true
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reputation_cases_source_ticket_id_fkey"
            columns: ["source_ticket_id"]
            isOneToOne: false
            referencedRelation: "review_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      review_analyses: {
        Row: {
          analysis_version: number
          confidence: number | null
          created_at: string
          error_message: string | null
          evidence: Json
          id: string
          is_urgent: boolean
          issue_domains: Json
          journey_stage: string | null
          model: string
          policy_class: string | null
          policy_flags: Json
          prompt_version: string
          property_id: string | null
          recommended_action: string | null
          review_id: string
          risk_class: string | null
          sentiment: string | null
          sentiment_score: number | null
          severity: string | null
          status: string
          summary: string | null
          taxonomy_version: string
          topics: Json
          usage: Json | null
        }
        Insert: {
          analysis_version?: number
          confidence?: number | null
          created_at?: string
          error_message?: string | null
          evidence?: Json
          id?: string
          is_urgent?: boolean
          issue_domains?: Json
          journey_stage?: string | null
          model: string
          policy_class?: string | null
          policy_flags?: Json
          prompt_version: string
          property_id?: string | null
          recommended_action?: string | null
          review_id: string
          risk_class?: string | null
          sentiment?: string | null
          sentiment_score?: number | null
          severity?: string | null
          status?: string
          summary?: string | null
          taxonomy_version: string
          topics?: Json
          usage?: Json | null
        }
        Update: {
          analysis_version?: number
          confidence?: number | null
          created_at?: string
          error_message?: string | null
          evidence?: Json
          id?: string
          is_urgent?: boolean
          issue_domains?: Json
          journey_stage?: string | null
          model?: string
          policy_class?: string | null
          policy_flags?: Json
          prompt_version?: string
          property_id?: string | null
          recommended_action?: string | null
          review_id?: string
          risk_class?: string | null
          sentiment?: string | null
          sentiment_score?: number | null
          severity?: string | null
          status?: string
          summary?: string | null
          taxonomy_version?: string
          topics?: Json
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "review_analyses_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_analyses_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "review_analyses_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "review_analyses_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      review_platform_connections: {
        Row: {
          access_token: string | null
          account_id: string | null
          api_key: string | null
          connection_type: string | null
          created_at: string | null
          error_count: number | null
          google_maps_url: string | null
          id: string
          is_active: boolean | null
          last_error: string | null
          last_review_date: string | null
          last_sync_at: string | null
          limitation_note: string | null
          next_sync_at: string | null
          place_id: string | null
          platform: string
          property_id: string | null
          refresh_token: string | null
          scraping_config: Json | null
          sync_frequency: string | null
          token_expires_at: string | null
          total_reviews_synced: number | null
          updated_at: string | null
          yelp_business_id: string | null
          yelp_business_url: string | null
        }
        Insert: {
          access_token?: string | null
          account_id?: string | null
          api_key?: string | null
          connection_type?: string | null
          created_at?: string | null
          error_count?: number | null
          google_maps_url?: string | null
          id?: string
          is_active?: boolean | null
          last_error?: string | null
          last_review_date?: string | null
          last_sync_at?: string | null
          limitation_note?: string | null
          next_sync_at?: string | null
          place_id?: string | null
          platform: string
          property_id?: string | null
          refresh_token?: string | null
          scraping_config?: Json | null
          sync_frequency?: string | null
          token_expires_at?: string | null
          total_reviews_synced?: number | null
          updated_at?: string | null
          yelp_business_id?: string | null
          yelp_business_url?: string | null
        }
        Update: {
          access_token?: string | null
          account_id?: string | null
          api_key?: string | null
          connection_type?: string | null
          created_at?: string | null
          error_count?: number | null
          google_maps_url?: string | null
          id?: string
          is_active?: boolean | null
          last_error?: string | null
          last_review_date?: string | null
          last_sync_at?: string | null
          limitation_note?: string | null
          next_sync_at?: string | null
          place_id?: string | null
          platform?: string
          property_id?: string | null
          refresh_token?: string | null
          scraping_config?: Json | null
          sync_frequency?: string | null
          token_expires_at?: string | null
          total_reviews_synced?: number | null
          updated_at?: string | null
          yelp_business_id?: string | null
          yelp_business_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_platform_connections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_platform_connections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "review_platform_connections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      review_responses: {
        Row: {
          ai_model: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          decision_reason: string | null
          generation_prompt: string | null
          id: string
          platform_response_id: string | null
          posted_at: string | null
          posted_by: string | null
          posting_mode: string | null
          provider_notes: string | null
          provider_post_url: string | null
          rejected_reason: string | null
          response_text: string
          response_type: string | null
          review_id: string | null
          shared_action_attempt_id: string | null
          status: string | null
          superseded_at: string | null
          tone: string | null
          updated_at: string | null
        }
        Insert: {
          ai_model?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          decision_reason?: string | null
          generation_prompt?: string | null
          id?: string
          platform_response_id?: string | null
          posted_at?: string | null
          posted_by?: string | null
          posting_mode?: string | null
          provider_notes?: string | null
          provider_post_url?: string | null
          rejected_reason?: string | null
          response_text: string
          response_type?: string | null
          review_id?: string | null
          shared_action_attempt_id?: string | null
          status?: string | null
          superseded_at?: string | null
          tone?: string | null
          updated_at?: string | null
        }
        Update: {
          ai_model?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          decision_reason?: string | null
          generation_prompt?: string | null
          id?: string
          platform_response_id?: string | null
          posted_at?: string | null
          posted_by?: string | null
          posting_mode?: string | null
          provider_notes?: string | null
          provider_post_url?: string | null
          rejected_reason?: string | null
          response_text?: string
          response_type?: string | null
          review_id?: string | null
          shared_action_attempt_id?: string | null
          status?: string | null
          superseded_at?: string | null
          tone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_responses_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_responses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_responses_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_responses_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_responses_shared_action_attempt_id_fkey"
            columns: ["shared_action_attempt_id"]
            isOneToOne: false
            referencedRelation: "shared_action_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      review_tickets: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          created_at: string | null
          description: string | null
          id: string
          notification_channel: string | null
          notification_sent_at: string | null
          priority: string | null
          property_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          review_id: string | null
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          notification_channel?: string | null
          notification_sent_at?: string | null
          priority?: string | null
          property_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_id?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          notification_channel?: string | null
          notification_sent_at?: string | null
          priority?: string | null
          property_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_id?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_tickets_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_tickets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_tickets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "review_tickets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "review_tickets_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_tickets_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: true
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      reviewflow_config: {
        Row: {
          apartments_com_connected: boolean | null
          apartments_com_property_url: string | null
          auto_analyze_reviews: boolean | null
          auto_generate_responses: boolean | null
          auto_respond_min_rating: number | null
          auto_respond_positive: boolean | null
          auto_respond_threshold: number | null
          created_at: string | null
          default_tone: string | null
          facebook_connected: boolean | null
          facebook_page_id: string | null
          google_business_id: string | null
          google_connected: boolean | null
          id: string
          is_active: boolean | null
          last_polled_at: string | null
          notification_email: string | null
          notify_on_negative: boolean | null
          notify_on_urgent: boolean | null
          poll_frequency_hours: number | null
          preferred_sync_method: string | null
          property_id: string | null
          property_personality: string | null
          response_delay_minutes: number | null
          slack_webhook_url: string | null
          sync_schedule: string | null
          updated_at: string | null
          yelp_business_id: string | null
          yelp_connected: boolean | null
        }
        Insert: {
          apartments_com_connected?: boolean | null
          apartments_com_property_url?: string | null
          auto_analyze_reviews?: boolean | null
          auto_generate_responses?: boolean | null
          auto_respond_min_rating?: number | null
          auto_respond_positive?: boolean | null
          auto_respond_threshold?: number | null
          created_at?: string | null
          default_tone?: string | null
          facebook_connected?: boolean | null
          facebook_page_id?: string | null
          google_business_id?: string | null
          google_connected?: boolean | null
          id?: string
          is_active?: boolean | null
          last_polled_at?: string | null
          notification_email?: string | null
          notify_on_negative?: boolean | null
          notify_on_urgent?: boolean | null
          poll_frequency_hours?: number | null
          preferred_sync_method?: string | null
          property_id?: string | null
          property_personality?: string | null
          response_delay_minutes?: number | null
          slack_webhook_url?: string | null
          sync_schedule?: string | null
          updated_at?: string | null
          yelp_business_id?: string | null
          yelp_connected?: boolean | null
        }
        Update: {
          apartments_com_connected?: boolean | null
          apartments_com_property_url?: string | null
          auto_analyze_reviews?: boolean | null
          auto_generate_responses?: boolean | null
          auto_respond_min_rating?: number | null
          auto_respond_positive?: boolean | null
          auto_respond_threshold?: number | null
          created_at?: string | null
          default_tone?: string | null
          facebook_connected?: boolean | null
          facebook_page_id?: string | null
          google_business_id?: string | null
          google_connected?: boolean | null
          id?: string
          is_active?: boolean | null
          last_polled_at?: string | null
          notification_email?: string | null
          notify_on_negative?: boolean | null
          notify_on_urgent?: boolean | null
          poll_frequency_hours?: number | null
          preferred_sync_method?: string | null
          property_id?: string | null
          property_personality?: string | null
          response_delay_minutes?: number | null
          slack_webhook_url?: string | null
          sync_schedule?: string | null
          updated_at?: string | null
          yelp_business_id?: string | null
          yelp_connected?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "reviewflow_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviewflow_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "reviewflow_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      reviews: {
        Row: {
          auto_respond_eligible: boolean | null
          content_fingerprint: string | null
          created_at: string | null
          id: string
          is_urgent: boolean | null
          last_observed_at: string | null
          platform: string
          platform_review_id: string | null
          property_id: string | null
          rating: number | null
          raw_data: Json | null
          response_status: string | null
          retrieval_method: string | null
          review_date: string | null
          review_text: string | null
          reviewer_avatar_url: string | null
          reviewer_name: string | null
          sentiment: string | null
          sentiment_score: number | null
          source_completeness: string | null
          topics: Json | null
          updated_at: string | null
        }
        Insert: {
          auto_respond_eligible?: boolean | null
          content_fingerprint?: string | null
          created_at?: string | null
          id?: string
          is_urgent?: boolean | null
          last_observed_at?: string | null
          platform: string
          platform_review_id?: string | null
          property_id?: string | null
          rating?: number | null
          raw_data?: Json | null
          response_status?: string | null
          retrieval_method?: string | null
          review_date?: string | null
          review_text?: string | null
          reviewer_avatar_url?: string | null
          reviewer_name?: string | null
          sentiment?: string | null
          sentiment_score?: number | null
          source_completeness?: string | null
          topics?: Json | null
          updated_at?: string | null
        }
        Update: {
          auto_respond_eligible?: boolean | null
          content_fingerprint?: string | null
          created_at?: string | null
          id?: string
          is_urgent?: boolean | null
          last_observed_at?: string | null
          platform?: string
          platform_review_id?: string | null
          property_id?: string | null
          rating?: number | null
          raw_data?: Json | null
          response_status?: string | null
          retrieval_method?: string | null
          review_date?: string | null
          review_text?: string | null
          reviewer_avatar_url?: string | null
          reviewer_name?: string | null
          sentiment?: string | null
          sentiment_score?: number | null
          source_completeness?: string | null
          topics?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "reviews_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      scheduled_reports: {
        Row: {
          created_at: string | null
          created_by: string | null
          date_range_type: string
          day_of_month: number | null
          day_of_week: number | null
          hour_utc: number
          id: string
          include_campaigns: boolean
          include_comparison: boolean
          is_active: boolean
          last_sent_at: string | null
          name: string
          next_run_at: string | null
          org_id: string
          property_id: string | null
          recipients: Json
          report_type: string
          schedule_type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          date_range_type?: string
          day_of_month?: number | null
          day_of_week?: number | null
          hour_utc?: number
          id?: string
          include_campaigns?: boolean
          include_comparison?: boolean
          is_active?: boolean
          last_sent_at?: string | null
          name: string
          next_run_at?: string | null
          org_id: string
          property_id?: string | null
          recipients?: Json
          report_type?: string
          schedule_type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          date_range_type?: string
          day_of_month?: number | null
          day_of_week?: number | null
          hour_utc?: number
          id?: string
          include_campaigns?: boolean
          include_comparison?: boolean
          is_active?: boolean
          last_sent_at?: string | null
          name?: string
          next_run_at?: string | null
          org_id?: string
          property_id?: string | null
          recipients?: Json
          report_type?: string
          schedule_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reports_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reports_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reports_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "scheduled_reports_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      scoring_config: {
        Row: {
          active_model: string | null
          behavior_weight: number | null
          cold_threshold: number | null
          completeness_weight: number | null
          created_at: string | null
          engagement_weight: number | null
          hot_threshold: number | null
          id: string
          is_active: boolean | null
          property_id: string | null
          source_scores: Json | null
          source_weight: number | null
          timing_weight: number | null
          updated_at: string | null
          warm_threshold: number | null
        }
        Insert: {
          active_model?: string | null
          behavior_weight?: number | null
          cold_threshold?: number | null
          completeness_weight?: number | null
          created_at?: string | null
          engagement_weight?: number | null
          hot_threshold?: number | null
          id?: string
          is_active?: boolean | null
          property_id?: string | null
          source_scores?: Json | null
          source_weight?: number | null
          timing_weight?: number | null
          updated_at?: string | null
          warm_threshold?: number | null
        }
        Update: {
          active_model?: string | null
          behavior_weight?: number | null
          cold_threshold?: number | null
          completeness_weight?: number | null
          created_at?: string | null
          engagement_weight?: number | null
          hot_threshold?: number | null
          id?: string
          is_active?: boolean | null
          property_id?: string | null
          source_scores?: Json | null
          source_weight?: number | null
          timing_weight?: number | null
          updated_at?: string | null
          warm_threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scoring_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "scoring_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      scrape_config: {
        Row: {
          auto_add: boolean | null
          created_at: string | null
          error_count: number | null
          id: string
          is_enabled: boolean | null
          last_error: string | null
          last_run_at: string | null
          max_competitors: number | null
          next_run_at: string | null
          property_id: string
          proxy_enabled: boolean | null
          radius_miles: number | null
          scrape_frequency: string | null
          sources: Json | null
          updated_at: string | null
        }
        Insert: {
          auto_add?: boolean | null
          created_at?: string | null
          error_count?: number | null
          id?: string
          is_enabled?: boolean | null
          last_error?: string | null
          last_run_at?: string | null
          max_competitors?: number | null
          next_run_at?: string | null
          property_id: string
          proxy_enabled?: boolean | null
          radius_miles?: number | null
          scrape_frequency?: string | null
          sources?: Json | null
          updated_at?: string | null
        }
        Update: {
          auto_add?: boolean | null
          created_at?: string | null
          error_count?: number | null
          id?: string
          is_enabled?: boolean | null
          last_error?: string | null
          last_run_at?: string | null
          max_competitors?: number | null
          next_run_at?: string | null
          property_id?: string
          proxy_enabled?: boolean | null
          radius_miles?: number | null
          scrape_frequency?: string | null
          sources?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scrape_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrape_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "scrape_config_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      shared_action_attempts: {
        Row: {
          action_type: string
          confidence_score: number | null
          created_at: string
          decided_at: string | null
          error_message: string | null
          executed_at: string | null
          execution_payload: Json
          execution_result: Json | null
          execution_status: string
          id: string
          job_id: string
          lifecycle_status: string
          org_id: string
          policy_reason: string | null
          policy_snapshot: Json | null
          property_id: string | null
          proposal_decision_status: string
          proposed_at: string
          request_payload: Json
          requested_by: string | null
          reversed_at: string | null
          reviewed_by: string | null
          rollback_metadata: Json | null
          updated_at: string
        }
        Insert: {
          action_type: string
          confidence_score?: number | null
          created_at?: string
          decided_at?: string | null
          error_message?: string | null
          executed_at?: string | null
          execution_payload?: Json
          execution_result?: Json | null
          execution_status?: string
          id?: string
          job_id: string
          lifecycle_status?: string
          org_id: string
          policy_reason?: string | null
          policy_snapshot?: Json | null
          property_id?: string | null
          proposal_decision_status?: string
          proposed_at?: string
          request_payload?: Json
          requested_by?: string | null
          reversed_at?: string | null
          reviewed_by?: string | null
          rollback_metadata?: Json | null
          updated_at?: string
        }
        Update: {
          action_type?: string
          confidence_score?: number | null
          created_at?: string
          decided_at?: string | null
          error_message?: string | null
          executed_at?: string | null
          execution_payload?: Json
          execution_result?: Json | null
          execution_status?: string
          id?: string
          job_id?: string
          lifecycle_status?: string
          org_id?: string
          policy_reason?: string | null
          policy_snapshot?: Json | null
          property_id?: string | null
          proposal_decision_status?: string
          proposed_at?: string
          request_payload?: Json
          requested_by?: string | null
          reversed_at?: string | null
          reviewed_by?: string | null
          rollback_metadata?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_action_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "shared_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_action_attempts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_action_attempts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_action_attempts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "shared_action_attempts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "shared_action_attempts_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_action_attempts_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_approvals: {
        Row: {
          action_attempt_id: string
          created_at: string
          decision_payload: Json
          decision_reason: string
          decision_status: string
          id: string
          org_id: string
          property_id: string | null
          reviewer_profile_id: string | null
        }
        Insert: {
          action_attempt_id: string
          created_at?: string
          decision_payload?: Json
          decision_reason: string
          decision_status: string
          id?: string
          org_id: string
          property_id?: string | null
          reviewer_profile_id?: string | null
        }
        Update: {
          action_attempt_id?: string
          created_at?: string
          decision_payload?: Json
          decision_reason?: string
          decision_status?: string
          id?: string
          org_id?: string
          property_id?: string | null
          reviewer_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shared_approvals_action_attempt_id_fkey"
            columns: ["action_attempt_id"]
            isOneToOne: false
            referencedRelation: "shared_action_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_approvals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_approvals_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_approvals_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "shared_approvals_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "shared_approvals_reviewer_profile_id_fkey"
            columns: ["reviewer_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_context_snapshots: {
        Row: {
          captured_by: string
          context_hash: string | null
          context_payload: Json
          created_at: string
          id: string
          org_id: string
          property_id: string | null
          source_domain: string
          source_ref: string | null
        }
        Insert: {
          captured_by?: string
          context_hash?: string | null
          context_payload?: Json
          created_at?: string
          id?: string
          org_id: string
          property_id?: string | null
          source_domain: string
          source_ref?: string | null
        }
        Update: {
          captured_by?: string
          context_hash?: string | null
          context_payload?: Json
          created_at?: string
          id?: string
          org_id?: string
          property_id?: string | null
          source_domain?: string
          source_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shared_context_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_context_snapshots_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_context_snapshots_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "shared_context_snapshots_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      shared_experiment_outcomes: {
        Row: {
          action_attempt_id: string | null
          attribution_payload: Json
          baseline_value: number | null
          created_at: string
          delta_value: number | null
          id: string
          job_id: string | null
          kpi_name: string
          measured_at: string
          measurement_window_end: string | null
          measurement_window_start: string | null
          observed_value: number | null
          org_id: string
          outcome_status: string
          property_id: string | null
        }
        Insert: {
          action_attempt_id?: string | null
          attribution_payload?: Json
          baseline_value?: number | null
          created_at?: string
          delta_value?: number | null
          id?: string
          job_id?: string | null
          kpi_name: string
          measured_at?: string
          measurement_window_end?: string | null
          measurement_window_start?: string | null
          observed_value?: number | null
          org_id: string
          outcome_status?: string
          property_id?: string | null
        }
        Update: {
          action_attempt_id?: string | null
          attribution_payload?: Json
          baseline_value?: number | null
          created_at?: string
          delta_value?: number | null
          id?: string
          job_id?: string | null
          kpi_name?: string
          measured_at?: string
          measurement_window_end?: string | null
          measurement_window_start?: string | null
          observed_value?: number | null
          org_id?: string
          outcome_status?: string
          property_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shared_experiment_outcomes_action_attempt_id_fkey"
            columns: ["action_attempt_id"]
            isOneToOne: false
            referencedRelation: "shared_action_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_experiment_outcomes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "shared_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_experiment_outcomes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_experiment_outcomes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_experiment_outcomes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "shared_experiment_outcomes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      shared_jobs: {
        Row: {
          attempt_count: number
          available_at: string
          context_snapshot_id: string | null
          created_at: string
          dedupe_key: string | null
          domain: string
          error_message: string | null
          finished_at: string | null
          heartbeat_at: string | null
          id: string
          lease_expires_at: string | null
          lease_owner: string | null
          lifecycle_status: string
          max_attempts: number
          org_id: string
          payload: Json
          property_id: string | null
          queued_at: string
          started_at: string | null
          status_reason: string | null
          subject_id: string | null
          subject_type: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          context_snapshot_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          domain: string
          error_message?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          lifecycle_status?: string
          max_attempts?: number
          org_id: string
          payload?: Json
          property_id?: string | null
          queued_at?: string
          started_at?: string | null
          status_reason?: string | null
          subject_id?: string | null
          subject_type: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          context_snapshot_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          domain?: string
          error_message?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          lifecycle_status?: string
          max_attempts?: number
          org_id?: string
          payload?: Json
          property_id?: string | null
          queued_at?: string
          started_at?: string | null
          status_reason?: string | null
          subject_id?: string | null
          subject_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_jobs_context_snapshot_id_fkey"
            columns: ["context_snapshot_id"]
            isOneToOne: false
            referencedRelation: "shared_context_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "shared_jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      shared_policy_decisions: {
        Row: {
          action_attempt_id: string | null
          confidence_score: number | null
          created_at: string
          decision_payload: Json
          decision_reason: string
          decision_status: string
          id: string
          job_id: string | null
          org_id: string
          policy_name: string
          policy_version: string | null
          property_id: string | null
        }
        Insert: {
          action_attempt_id?: string | null
          confidence_score?: number | null
          created_at?: string
          decision_payload?: Json
          decision_reason: string
          decision_status: string
          id?: string
          job_id?: string | null
          org_id: string
          policy_name: string
          policy_version?: string | null
          property_id?: string | null
        }
        Update: {
          action_attempt_id?: string | null
          confidence_score?: number | null
          created_at?: string
          decision_payload?: Json
          decision_reason?: string
          decision_status?: string
          id?: string
          job_id?: string | null
          org_id?: string
          policy_name?: string
          policy_version?: string | null
          property_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shared_policy_decisions_action_attempt_id_fkey"
            columns: ["action_attempt_id"]
            isOneToOne: false
            referencedRelation: "shared_action_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_policy_decisions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "shared_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_policy_decisions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_policy_decisions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_policy_decisions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "shared_policy_decisions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      siteforge_blueprint_versions: {
        Row: {
          blueprint: Json
          created_at: string
          created_by: string | null
          id: string
          version: number
          website_id: string
        }
        Insert: {
          blueprint: Json
          created_at?: string
          created_by?: string | null
          id?: string
          version: number
          website_id: string
        }
        Update: {
          blueprint?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          version?: number
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "siteforge_blueprint_versions_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "property_websites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "siteforge_blueprint_versions_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "website_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      siteforge_jobs: {
        Row: {
          attempts: number | null
          completed_at: string | null
          created_at: string | null
          error_details: Json | null
          id: string
          input_params: Json | null
          job_type: string
          max_attempts: number | null
          output_data: Json | null
          started_at: string | null
          status: string | null
          website_id: string
        }
        Insert: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_details?: Json | null
          id?: string
          input_params?: Json | null
          job_type: string
          max_attempts?: number | null
          output_data?: Json | null
          started_at?: string | null
          status?: string | null
          website_id: string
        }
        Update: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_details?: Json | null
          id?: string
          input_params?: Json | null
          job_type?: string
          max_attempts?: number | null
          output_data?: Json | null
          started_at?: string | null
          status?: string | null
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "siteforge_jobs_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "property_websites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "siteforge_jobs_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "website_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      social_auth_configs: {
        Row: {
          additional_config: Json | null
          app_id: string
          app_secret_encrypted: string
          created_at: string | null
          id: string
          is_configured: boolean | null
          last_verified_at: string | null
          platform: string
          property_id: string | null
          redirect_uri: string | null
          updated_at: string | null
        }
        Insert: {
          additional_config?: Json | null
          app_id: string
          app_secret_encrypted: string
          created_at?: string | null
          id?: string
          is_configured?: boolean | null
          last_verified_at?: string | null
          platform: string
          property_id?: string | null
          redirect_uri?: string | null
          updated_at?: string | null
        }
        Update: {
          additional_config?: Json | null
          app_id?: string
          app_secret_encrypted?: string
          created_at?: string | null
          id?: string
          is_configured?: boolean | null
          last_verified_at?: string | null
          platform?: string
          property_id?: string | null
          redirect_uri?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_auth_configs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_auth_configs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "social_auth_configs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      social_connections: {
        Row: {
          access_token: string
          account_avatar_url: string | null
          account_id: string
          account_name: string | null
          account_username: string | null
          connected_by: string | null
          created_at: string | null
          error_count: number | null
          id: string
          is_active: boolean | null
          last_error: string | null
          last_used_at: string | null
          page_access_token: string | null
          page_id: string | null
          platform: string
          property_id: string | null
          raw_profile: Json | null
          refresh_token: string | null
          scopes: string[] | null
          token_expires_at: string | null
          updated_at: string | null
        }
        Insert: {
          access_token: string
          account_avatar_url?: string | null
          account_id: string
          account_name?: string | null
          account_username?: string | null
          connected_by?: string | null
          created_at?: string | null
          error_count?: number | null
          id?: string
          is_active?: boolean | null
          last_error?: string | null
          last_used_at?: string | null
          page_access_token?: string | null
          page_id?: string | null
          platform: string
          property_id?: string | null
          raw_profile?: Json | null
          refresh_token?: string | null
          scopes?: string[] | null
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          account_avatar_url?: string | null
          account_id?: string
          account_name?: string | null
          account_username?: string | null
          connected_by?: string | null
          created_at?: string | null
          error_count?: number | null
          id?: string
          is_active?: boolean | null
          last_error?: string | null
          last_used_at?: string | null
          page_access_token?: string | null
          page_id?: string | null
          platform?: string
          property_id?: string | null
          raw_profile?: Json | null
          refresh_token?: string | null
          scopes?: string[] | null
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_connections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_connections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "social_connections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      social_content_briefs: {
        Row: {
          asset_ids: string[]
          audience: string | null
          channels: string[]
          connection_ids: string[]
          constraints: Json
          created_at: string
          created_by: string | null
          id: string
          objective: string
          org_id: string
          property_id: string
          scheduling_window: Json
          source_facts: Json
          status: string
          title: string
          topic: string | null
          updated_at: string
        }
        Insert: {
          asset_ids?: string[]
          audience?: string | null
          channels?: string[]
          connection_ids?: string[]
          constraints?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          objective: string
          org_id: string
          property_id: string
          scheduling_window?: Json
          source_facts?: Json
          status?: string
          title: string
          topic?: string | null
          updated_at?: string
        }
        Update: {
          asset_ids?: string[]
          audience?: string | null
          channels?: string[]
          connection_ids?: string[]
          constraints?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          objective?: string
          org_id?: string
          property_id?: string
          scheduling_window?: Json
          source_facts?: Json
          status?: string
          title?: string
          topic?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_content_briefs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_briefs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_briefs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_briefs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "social_content_briefs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      social_content_packages: {
        Row: {
          brief_id: string | null
          concept_summary: string | null
          created_at: string
          created_by: string | null
          current_revision_id: string | null
          id: string
          org_id: string
          property_id: string
          status: string
          updated_at: string
        }
        Insert: {
          brief_id?: string | null
          concept_summary?: string | null
          created_at?: string
          created_by?: string | null
          current_revision_id?: string | null
          id?: string
          org_id: string
          property_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          brief_id?: string | null
          concept_summary?: string | null
          created_at?: string
          created_by?: string | null
          current_revision_id?: string | null
          id?: string
          org_id?: string
          property_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_content_packages_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "social_content_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_packages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_packages_current_revision_fkey"
            columns: ["current_revision_id"]
            isOneToOne: false
            referencedRelation: "social_content_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_packages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_packages_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_packages_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "social_content_packages_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      social_content_revisions: {
        Row: {
          approval_note: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          authored_by: string | null
          authored_by_kind: string
          claims: Json
          content: Json
          content_hash: string | null
          context_snapshot_id: string | null
          created_at: string
          generation_metadata: Json
          id: string
          org_id: string
          package_id: string
          property_id: string
          revision_number: number
        }
        Insert: {
          approval_note?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          authored_by?: string | null
          authored_by_kind?: string
          claims?: Json
          content?: Json
          content_hash?: string | null
          context_snapshot_id?: string | null
          created_at?: string
          generation_metadata?: Json
          id?: string
          org_id: string
          package_id: string
          property_id: string
          revision_number: number
        }
        Update: {
          approval_note?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          authored_by?: string | null
          authored_by_kind?: string
          claims?: Json
          content?: Json
          content_hash?: string | null
          context_snapshot_id?: string | null
          created_at?: string
          generation_metadata?: Json
          id?: string
          org_id?: string
          package_id?: string
          property_id?: string
          revision_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "social_content_revisions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_revisions_authored_by_fkey"
            columns: ["authored_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_revisions_context_snapshot_id_fkey"
            columns: ["context_snapshot_id"]
            isOneToOne: false
            referencedRelation: "shared_context_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_revisions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_revisions_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "social_content_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_revisions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_revisions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "social_content_revisions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      social_content_variants: {
        Row: {
          alt_text: string | null
          asset_ids: string[]
          call_to_action: string | null
          caption: string
          content_format: string
          created_at: string
          hashtags: string[]
          id: string
          link_url: string | null
          media_urls: string[]
          org_id: string
          platform: string
          platform_options: Json
          property_id: string
          revision_id: string
          validation: Json
        }
        Insert: {
          alt_text?: string | null
          asset_ids?: string[]
          call_to_action?: string | null
          caption?: string
          content_format?: string
          created_at?: string
          hashtags?: string[]
          id?: string
          link_url?: string | null
          media_urls?: string[]
          org_id: string
          platform: string
          platform_options?: Json
          property_id: string
          revision_id: string
          validation?: Json
        }
        Update: {
          alt_text?: string | null
          asset_ids?: string[]
          call_to_action?: string | null
          caption?: string
          content_format?: string
          created_at?: string
          hashtags?: string[]
          id?: string
          link_url?: string | null
          media_urls?: string[]
          org_id?: string
          platform?: string
          platform_options?: Json
          property_id?: string
          revision_id?: string
          validation?: Json
        }
        Relationships: [
          {
            foreignKeyName: "social_content_variants_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_variants_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_variants_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "social_content_variants_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "social_content_variants_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "social_content_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      social_publication_attempts: {
        Row: {
          attempt_number: number
          error_classification: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          org_id: string
          property_id: string
          provider_post_id: string | null
          provider_post_url: string | null
          publication_id: string
          request_summary: Json
          response_summary: Json
          started_at: string
          status: string
        }
        Insert: {
          attempt_number: number
          error_classification?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          org_id: string
          property_id: string
          provider_post_id?: string | null
          provider_post_url?: string | null
          publication_id: string
          request_summary?: Json
          response_summary?: Json
          started_at?: string
          status?: string
        }
        Update: {
          attempt_number?: number
          error_classification?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          org_id?: string
          property_id?: string
          provider_post_id?: string | null
          provider_post_url?: string | null
          publication_id?: string
          request_summary?: Json
          response_summary?: Json
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_publication_attempts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_publication_attempts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_publication_attempts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "social_publication_attempts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "social_publication_attempts_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "social_publications"
            referencedColumns: ["id"]
          },
        ]
      }
      social_publications: {
        Row: {
          attempt_count: number
          cancelled_at: string | null
          connection_id: string
          created_at: string
          created_by: string | null
          error_classification: string | null
          id: string
          last_error: string | null
          max_attempts: number
          org_id: string
          package_id: string
          platform: string
          property_id: string
          published_at: string | null
          remote_post_id: string | null
          remote_post_url: string | null
          revision_id: string
          scheduled_for: string
          shared_job_id: string | null
          status: string
          timezone: string
          updated_at: string
          variant_id: string
        }
        Insert: {
          attempt_count?: number
          cancelled_at?: string | null
          connection_id: string
          created_at?: string
          created_by?: string | null
          error_classification?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          org_id: string
          package_id: string
          platform: string
          property_id: string
          published_at?: string | null
          remote_post_id?: string | null
          remote_post_url?: string | null
          revision_id: string
          scheduled_for: string
          shared_job_id?: string | null
          status?: string
          timezone?: string
          updated_at?: string
          variant_id: string
        }
        Update: {
          attempt_count?: number
          cancelled_at?: string | null
          connection_id?: string
          created_at?: string
          created_by?: string | null
          error_classification?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          org_id?: string
          package_id?: string
          platform?: string
          property_id?: string
          published_at?: string | null
          remote_post_id?: string | null
          remote_post_url?: string | null
          revision_id?: string
          scheduled_for?: string
          shared_job_id?: string | null
          status?: string
          timezone?: string
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_publications_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "social_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_publications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_publications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_publications_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "social_content_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_publications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_publications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "social_publications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "social_publications_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "social_content_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_publications_shared_job_id_fkey"
            columns: ["shared_job_id"]
            isOneToOne: false
            referencedRelation: "shared_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_publications_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "social_content_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      tour_bookings: {
        Row: {
          booked_via_conversation_id: string | null
          completed_at: string | null
          completion_notes: string | null
          confirmation_sent_at: string | null
          created_at: string | null
          duration_minutes: number | null
          id: string
          internal_notes: string | null
          lead_id: string | null
          property_id: string | null
          reminder_1h_sent_at: string | null
          reminder_24h_sent_at: string | null
          reminder_sent_at: string | null
          scheduled_date: string
          scheduled_time: string
          slot_id: string | null
          source: string | null
          special_requests: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          booked_via_conversation_id?: string | null
          completed_at?: string | null
          completion_notes?: string | null
          confirmation_sent_at?: string | null
          created_at?: string | null
          duration_minutes?: number | null
          id?: string
          internal_notes?: string | null
          lead_id?: string | null
          property_id?: string | null
          reminder_1h_sent_at?: string | null
          reminder_24h_sent_at?: string | null
          reminder_sent_at?: string | null
          scheduled_date: string
          scheduled_time: string
          slot_id?: string | null
          source?: string | null
          special_requests?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          booked_via_conversation_id?: string | null
          completed_at?: string | null
          completion_notes?: string | null
          confirmation_sent_at?: string | null
          created_at?: string | null
          duration_minutes?: number | null
          id?: string
          internal_notes?: string | null
          lead_id?: string | null
          property_id?: string | null
          reminder_1h_sent_at?: string | null
          reminder_24h_sent_at?: string | null
          reminder_sent_at?: string | null
          scheduled_date?: string
          scheduled_time?: string
          slot_id?: string | null
          source?: string | null
          special_requests?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tour_bookings_booked_via_conversation_id_fkey"
            columns: ["booked_via_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tour_bookings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tour_bookings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tour_bookings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "tour_bookings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "tour_bookings_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "tour_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      tour_slots: {
        Row: {
          created_at: string | null
          current_bookings: number | null
          end_time: string
          id: string
          is_available: boolean | null
          max_bookings: number | null
          property_id: string | null
          slot_date: string
          start_time: string
        }
        Insert: {
          created_at?: string | null
          current_bookings?: number | null
          end_time: string
          id?: string
          is_available?: boolean | null
          max_bookings?: number | null
          property_id?: string | null
          slot_date: string
          start_time: string
        }
        Update: {
          created_at?: string | null
          current_bookings?: number | null
          end_time?: string
          id?: string
          is_available?: boolean | null
          max_bookings?: number | null
          property_id?: string | null
          slot_date?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "tour_slots_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tour_slots_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "tour_slots_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      tours: {
        Row: {
          assigned_agent_id: string | null
          confirmation_sent_at: string | null
          created_at: string | null
          created_by: string | null
          id: string
          lead_id: string | null
          noshow_followup_sent_at: string | null
          notes: string | null
          property_id: string | null
          reminder_24h_sent_at: string | null
          reminder_sent_at: string | null
          status: string
          tour_date: string
          tour_time: string
          tour_type: string
          updated_at: string | null
        }
        Insert: {
          assigned_agent_id?: string | null
          confirmation_sent_at?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          lead_id?: string | null
          noshow_followup_sent_at?: string | null
          notes?: string | null
          property_id?: string | null
          reminder_24h_sent_at?: string | null
          reminder_sent_at?: string | null
          status?: string
          tour_date: string
          tour_time: string
          tour_type?: string
          updated_at?: string | null
        }
        Update: {
          assigned_agent_id?: string | null
          confirmation_sent_at?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          lead_id?: string | null
          noshow_followup_sent_at?: string | null
          notes?: string | null
          property_id?: string | null
          reminder_24h_sent_at?: string | null
          reminder_sent_at?: string | null
          status?: string
          tour_date?: string
          tour_time?: string
          tour_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tours_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tours_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tours_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tours_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tours_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "tours_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      website_assets: {
        Row: {
          alt_text: string | null
          asset_type: string
          caption: string | null
          created_at: string | null
          file_size_bytes: number | null
          file_url: string
          id: string
          mime_type: string | null
          optimized: boolean | null
          original_url: string | null
          source: string
          usage_context: Json | null
          website_id: string
          wp_media_id: number | null
        }
        Insert: {
          alt_text?: string | null
          asset_type: string
          caption?: string | null
          created_at?: string | null
          file_size_bytes?: number | null
          file_url: string
          id?: string
          mime_type?: string | null
          optimized?: boolean | null
          original_url?: string | null
          source: string
          usage_context?: Json | null
          website_id: string
          wp_media_id?: number | null
        }
        Update: {
          alt_text?: string | null
          asset_type?: string
          caption?: string | null
          created_at?: string | null
          file_size_bytes?: number | null
          file_url?: string
          id?: string
          mime_type?: string | null
          optimized?: boolean | null
          original_url?: string | null
          source?: string
          usage_context?: Json | null
          website_id?: string
          wp_media_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "website_assets_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "property_websites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_assets_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "website_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      website_generations: {
        Row: {
          changes_made: Json | null
          changes_requested: string | null
          generated_at: string | null
          generated_by: string | null
          id: string
          performance_delta: Json | null
          trigger_type: string
          website_id: string
        }
        Insert: {
          changes_made?: Json | null
          changes_requested?: string | null
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          performance_delta?: Json | null
          trigger_type: string
          website_id: string
        }
        Update: {
          changes_made?: Json | null
          changes_requested?: string | null
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          performance_delta?: Json | null
          trigger_type?: string
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_generations_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "property_websites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_generations_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "website_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      widget_sessions: {
        Row: {
          converted_at: string | null
          id: string
          ip_address: unknown
          landing_page: string | null
          last_activity_at: string | null
          lead_id: string | null
          message_count: number | null
          metadata: Json | null
          property_id: string | null
          referrer_url: string | null
          started_at: string | null
          user_agent: string | null
          visitor_id: string
        }
        Insert: {
          converted_at?: string | null
          id?: string
          ip_address?: unknown
          landing_page?: string | null
          last_activity_at?: string | null
          lead_id?: string | null
          message_count?: number | null
          metadata?: Json | null
          property_id?: string | null
          referrer_url?: string | null
          started_at?: string | null
          user_agent?: string | null
          visitor_id: string
        }
        Update: {
          converted_at?: string | null
          id?: string
          ip_address?: unknown
          landing_page?: string | null
          last_activity_at?: string | null
          lead_id?: string | null
          message_count?: number | null
          metadata?: Json | null
          property_id?: string | null
          referrer_url?: string | null
          started_at?: string | null
          user_agent?: string | null
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "widget_sessions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "widget_sessions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "widget_sessions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "widget_sessions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      workflow_actions: {
        Row: {
          action_type: string
          created_at: string | null
          error_message: string | null
          external_id: string | null
          id: string
          lead_workflow_id: string | null
          status: string
          step_number: number
          template_id: string | null
        }
        Insert: {
          action_type: string
          created_at?: string | null
          error_message?: string | null
          external_id?: string | null
          id?: string
          lead_workflow_id?: string | null
          status?: string
          step_number: number
          template_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string | null
          error_message?: string | null
          external_id?: string | null
          id?: string
          lead_workflow_id?: string | null
          status?: string
          step_number?: number
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_actions_lead_workflow_id_fkey"
            columns: ["lead_workflow_id"]
            isOneToOne: false
            referencedRelation: "lead_workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_actions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "follow_up_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_definitions: {
        Row: {
          created_at: string | null
          description: string | null
          exit_conditions: Json | null
          id: string
          is_active: boolean | null
          name: string
          property_id: string | null
          steps: Json
          trigger_on: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          exit_conditions?: Json | null
          id?: string
          is_active?: boolean | null
          name: string
          property_id?: string | null
          steps?: Json
          trigger_on?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          exit_conditions?: Json | null
          id?: string
          is_active?: boolean | null
          name?: string
          property_id?: string | null
          steps?: Json
          trigger_on?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_definitions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_definitions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "workflow_definitions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
    }
    Views: {
      brand_books: {
        Row: {
          created_at: string | null
          id: string | null
          property_id: string | null
          target_audience: string | null
          unique_selling_points: string[] | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          property_id?: string | null
          target_audience?: never
          unique_selling_points?: never
        }
        Update: {
          created_at?: string | null
          id?: string | null
          property_id?: string | null
          target_audience?: never
          unique_selling_points?: never
        }
        Relationships: [
          {
            foreignKeyName: "property_brand_assets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_brand_assets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_brand_assets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
      lead_scores_latest: {
        Row: {
          behavior_score: number | null
          completeness_score: number | null
          created_at: string | null
          email: string | null
          engagement_score: number | null
          expires_at: string | null
          factors: Json | null
          first_name: string | null
          id: string | null
          last_name: string | null
          lead_created_at: string | null
          lead_id: string | null
          model_version: string | null
          phone: string | null
          score_bucket: string | null
          scored_at: string | null
          source: string | null
          source_score: number | null
          status: string | null
          timing_score: number | null
          total_score: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_scores_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_import_status: {
        Row: {
          account_id: string | null
          active_imports: number | null
          last_imported_at: string | null
          last_successful_import: string | null
          last_sync_at: string | null
          platform: string | null
          property_id: string | null
          property_name: string | null
        }
        Relationships: []
      }
      vw_property_marketing_setup: {
        Row: {
          active_connections: number | null
          ga4_property_id: string | null
          google_ads_customer_id: string | null
          last_marketing_sync: string | null
          meta_ad_account_id: string | null
          org_id: string | null
          property_id: string | null
          property_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      website_summary: {
        Row: {
          assets_count: number | null
          brand_confidence: number | null
          brand_source: string | null
          created_at: string | null
          generation_progress: number | null
          generation_status: string | null
          id: string | null
          pages_count: number | null
          property_id: string | null
          property_name: string | null
          updated_at: string | null
          version: number | null
          wp_url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_websites_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_websites_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_websites_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
          },
        ]
      }
    }
    Functions: {
      calculate_lead_score: {
        Args: { p_lead_id: string }
        Returns: {
          behavior_score: number
          completeness_score: number
          engagement_score: number
          factors: Json
          score_bucket: string
          source_score: number
          timing_score: number
          total_score: number
        }[]
      }
      calculate_next_run: {
        Args: {
          p_day_of_month: number
          p_day_of_week: number
          p_from_time?: string
          p_hour_utc: number
          p_schedule_type: string
        }
        Returns: string
      }
      claim_shared_jobs: {
        Args: {
          p_domain: string
          p_lease_seconds?: number
          p_limit?: number
          p_worker: string
        }
        Returns: {
          attempt_count: number
          available_at: string
          context_snapshot_id: string | null
          created_at: string
          dedupe_key: string | null
          domain: string
          error_message: string | null
          finished_at: string | null
          heartbeat_at: string | null
          id: string
          lease_expires_at: string | null
          lease_owner: string | null
          lifecycle_status: string
          max_attempts: number
          org_id: string
          payload: Json
          property_id: string | null
          queued_at: string
          started_at: string | null
          status_reason: string | null
          subject_id: string | null
          subject_type: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "shared_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_default_onboarding_tasks: {
        Args: { p_property_id: string }
        Returns: undefined
      }
      execute_readonly_query: { Args: { query_text: string }; Returns: Json }
      generate_tour_slots: {
        Args: {
          p_end_date: string
          p_property_id: string
          p_start_date: string
        }
        Returns: undefined
      }
      get_brand_section_column: { Args: { step_num: number }; Returns: string }
      get_market_position: {
        Args: { p_our_rent: number; p_property_id: string; p_unit_type: string }
        Returns: {
          avg_market_rent: number
          max_market_rent: number
          min_market_rent: number
          position_rank: number
          price_vs_avg_percent: number
          total_competitors: number
        }[]
      }
      get_onboarding_progress: {
        Args: { p_property_id: string }
        Returns: {
          completed_tasks: number
          progress_percentage: number
          total_tasks: number
        }[]
      }
      get_user_org_id: { Args: { user_id: string }; Returns: string }
      heartbeat_shared_job: {
        Args: { p_job_id: string; p_lease_seconds?: number; p_worker: string }
        Returns: boolean
      }
      link_property_to_google_ads: {
        Args: {
          p_google_customer_id: string
          p_manager_account_id?: string
          p_property_name: string
        }
        Returns: string
      }
      link_property_to_meta_ads: {
        Args: { p_meta_account_id: string; p_property_name: string }
        Returns: string
      }
      match_competitor_content: {
        Args: {
          filter_competitor_ids?: string[]
          filter_property_id?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          competitor_id: string
          competitor_name: string
          content: string
          id: string
          page_type: string
          page_url: string
          similarity: number
        }[]
      }
      match_documents: {
        Args: {
          filter_property: string
          match_count: number
          match_threshold: number
          query_embedding: string
        }
        Returns: {
          content: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      record_mapping_correction: {
        Args: {
          p_crm_type: string
          p_final_crm_field: string
          p_suggested_crm_field: string
          p_tourspark_field: string
        }
        Returns: undefined
      }
      score_lead: { Args: { p_lead_id: string }; Returns: string }
      update_scrape_job_progress: {
        Args: {
          error_detail?: Json
          failed_id?: string
          job_uuid: string
          new_failed_count: number
          new_processed_count: number
          processed_id?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      geo_crawl_status_enum: "queued" | "running" | "completed" | "failed"
      geo_finding_severity_enum: "critical" | "high" | "medium" | "low" | "info"
      geo_finding_status_enum: "todo" | "in_progress" | "fixed" | "wont_fix"
      geo_query_type_enum:
        | "branded"
        | "category"
        | "comparison"
        | "local"
        | "faq"
        | "voice_search"
      geo_run_status_enum: "queued" | "running" | "completed" | "failed"
      geo_surface_enum:
        | "openai"
        | "claude"
        | "chatgpt"
        | "gemini"
        | "perplexity"
        | "google_ai"
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
      geo_crawl_status_enum: ["queued", "running", "completed", "failed"],
      geo_finding_severity_enum: ["critical", "high", "medium", "low", "info"],
      geo_finding_status_enum: ["todo", "in_progress", "fixed", "wont_fix"],
      geo_query_type_enum: [
        "branded",
        "category",
        "comparison",
        "local",
        "faq",
        "voice_search",
      ],
      geo_run_status_enum: ["queued", "running", "completed", "failed"],
      geo_surface_enum: [
        "openai",
        "claude",
        "chatgpt",
        "gemini",
        "perplexity",
        "google_ai",
      ],
    },
  },
} as const
