// schema_migration_version: 20260504181000
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
          alert_sent_at: string | null
          buffer_minutes: number | null
          calendar_id: string | null
          created_at: string | null
          google_email: string
          health_check_error: string | null
          id: string
          last_health_check_at: string | null
          profile_id: string | null
          property_id: string | null
          refresh_token: string | null
          sync_enabled: boolean | null
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
          alert_sent_at?: string | null
          buffer_minutes?: number | null
          calendar_id?: string | null
          created_at?: string | null
          google_email: string
          health_check_error?: string | null
          id?: string
          last_health_check_at?: string | null
          profile_id?: string | null
          property_id?: string | null
          refresh_token?: string | null
          sync_enabled?: boolean | null
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
          alert_sent_at?: string | null
          buffer_minutes?: number | null
          calendar_id?: string | null
          created_at?: string | null
          google_email?: string
          health_check_error?: string | null
          id?: string
          last_health_check_at?: string | null
          profile_id?: string | null
          property_id?: string | null
          refresh_token?: string | null
          sync_enabled?: boolean | null
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
          org_id: string
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
          org_id: string
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
          org_id?: string
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
          sync_status: string | null
          tour_booking_id: string | null
        }
        Insert: {
          agent_calendar_id?: string | null
          created_at?: string | null
          google_event_id: string
          id?: string
          last_synced_at?: string | null
          sync_status?: string | null
          tour_booking_id?: string | null
        }
        Update: {
          agent_calendar_id?: string | null
          created_at?: string | null
          google_event_id?: string
          id?: string
          last_synced_at?: string | null
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
          community_events: string[] | null
          competitor_id: string | null
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
          community_events?: string[] | null
          competitor_id?: string | null
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
          community_events?: string[] | null
          competitor_id?: string | null
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
          chunk_index: number | null
          competitor_id: string | null
          content: string
          content_hash: string | null
          embedding: string | null
          id: string
          page_type: string | null
          page_url: string
          scraped_at: string | null
        }
        Insert: {
          chunk_index?: number | null
          competitor_id?: string | null
          content: string
          content_hash?: string | null
          embedding?: string | null
          id?: string
          page_type?: string | null
          page_url: string
          scraped_at?: string | null
        }
        Update: {
          chunk_index?: number | null
          competitor_id?: string | null
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
            foreignKeyName: "competitor_content_chunks_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_price_history: {
        Row: {
          available_count: number | null
          competitor_unit_id: string
          id: string
          recorded_at: string | null
          rent_max: number | null
          rent_min: number | null
          source: string | null
        }
        Insert: {
          available_count?: number | null
          competitor_unit_id: string
          id?: string
          recorded_at?: string | null
          rent_max?: number | null
          rent_min?: number | null
          source?: string | null
        }
        Update: {
          available_count?: number | null
          competitor_unit_id?: string
          id?: string
          recorded_at?: string | null
          rent_max?: number | null
          rent_min?: number | null
          source?: string | null
        }
        Relationships: [
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
          property_id: string | null
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
          property_id?: string | null
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
          property_id?: string | null
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
          amenities: string[] | null
          created_at: string | null
          id: string
          ils_listings: Json | null
          is_active: boolean | null
          last_scraped_at: string | null
          name: string
          notes: string | null
          phone: string | null
          photos: string[] | null
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
          amenities?: string[] | null
          created_at?: string | null
          id?: string
          ils_listings?: Json | null
          is_active?: boolean | null
          last_scraped_at?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          photos?: string[] | null
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
          amenities?: string[] | null
          created_at?: string | null
          id?: string
          ils_listings?: Json | null
          is_active?: boolean | null
          last_scraped_at?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          photos?: string[] | null
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
          dimensions: Json | null
          file_size: number | null
          file_url: string
          generation_params: Json | null
          generation_prompt: string | null
          generation_provider: string | null
          id: string
          is_ai_generated: boolean | null
          name: string
          property_id: string | null
          tags: string[] | null
          thumbnail_url: string | null
        }
        Insert: {
          asset_type: string
          created_at?: string | null
          description?: string | null
          dimensions?: Json | null
          file_size?: number | null
          file_url: string
          generation_params?: Json | null
          generation_prompt?: string | null
          generation_provider?: string | null
          id?: string
          is_ai_generated?: boolean | null
          name: string
          property_id?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
        }
        Update: {
          asset_type?: string
          created_at?: string | null
          description?: string | null
          dimensions?: Json | null
          file_size?: number | null
          file_url?: string
          generation_params?: Json | null
          generation_prompt?: string | null
          generation_provider?: string | null
          id?: string
          is_ai_generated?: boolean | null
          name?: string
          property_id?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
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
          generation_params: Json | null
          generation_prompt: string | null
          hashtags: string[] | null
          id: string
          media_type: string | null
          media_urls: string[] | null
          platform: string | null
          property_id: string | null
          published_at: string | null
          rejection_reason: string | null
          scheduled_for: string | null
          status: string | null
          template_id: string | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string | null
          variations: string[] | null
        }
        Insert: {
          ai_model?: string | null
          approved_at?: string | null
          approved_by?: string | null
          call_to_action?: string | null
          caption?: string | null
          content_type: string
          created_at?: string | null
          generation_params?: Json | null
          generation_prompt?: string | null
          hashtags?: string[] | null
          id?: string
          media_type?: string | null
          media_urls?: string[] | null
          platform?: string | null
          property_id?: string | null
          published_at?: string | null
          rejection_reason?: string | null
          scheduled_for?: string | null
          status?: string | null
          template_id?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string | null
          variations?: string[] | null
        }
        Update: {
          ai_model?: string | null
          approved_at?: string | null
          approved_by?: string | null
          call_to_action?: string | null
          caption?: string | null
          content_type?: string
          created_at?: string | null
          generation_params?: Json | null
          generation_prompt?: string | null
          hashtags?: string[] | null
          id?: string
          media_type?: string | null
          media_urls?: string[] | null
          platform?: string | null
          property_id?: string | null
          published_at?: string | null
          rejection_reason?: string | null
          scheduled_for?: string | null
          status?: string | null
          template_id?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string | null
          variations?: string[] | null
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
          is_default: boolean | null
          name: string
          platform: string[] | null
          prompt_template: string
          property_id: string | null
          updated_at: string | null
          variables: Json | null
        }
        Insert: {
          content_type: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          platform?: string[] | null
          prompt_template: string
          property_id?: string | null
          updated_at?: string | null
          variables?: Json | null
        }
        Update: {
          content_type?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          platform?: string[] | null
          prompt_template?: string
          property_id?: string | null
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
          id: string
          is_human_mode: boolean | null
          lead_id: string | null
          property_id: string | null
          widget_session_id: string | null
        }
        Insert: {
          channel?: string | null
          created_at?: string | null
          id?: string
          is_human_mode?: boolean | null
          lead_id?: string | null
          property_id?: string | null
          widget_session_id?: string | null
        }
        Update: {
          channel?: string | null
          created_at?: string | null
          id?: string
          is_human_mode?: boolean | null
          lead_id?: string | null
          property_id?: string | null
          widget_session_id?: string | null
        }
        Relationships: [
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
          auto_reply_enabled: boolean | null
          created_at: string | null
          google_email: string
          health_check_error: string | null
          history_id: string | null
          id: string
          last_health_check_at: string | null
          last_sync_at: string | null
          profile_id: string | null
          property_id: string | null
          refresh_token: string | null
          signature_template: string | null
          sync_enabled: boolean | null
          token_expires_at: string | null
          token_status: string | null
          updated_at: string | null
          watch_expiration: string | null
        }
        Insert: {
          access_token?: string | null
          auto_reply_enabled?: boolean | null
          created_at?: string | null
          google_email: string
          health_check_error?: string | null
          history_id?: string | null
          id?: string
          last_health_check_at?: string | null
          last_sync_at?: string | null
          profile_id?: string | null
          property_id?: string | null
          refresh_token?: string | null
          signature_template?: string | null
          sync_enabled?: boolean | null
          token_expires_at?: string | null
          token_status?: string | null
          updated_at?: string | null
          watch_expiration?: string | null
        }
        Update: {
          access_token?: string | null
          auto_reply_enabled?: boolean | null
          created_at?: string | null
          google_email?: string
          health_check_error?: string | null
          history_id?: string | null
          id?: string
          last_health_check_at?: string | null
          last_sync_at?: string | null
          profile_id?: string | null
          property_id?: string | null
          refresh_token?: string | null
          signature_template?: string | null
          sync_enabled?: boolean | null
          token_expires_at?: string | null
          token_status?: string | null
          updated_at?: string | null
          watch_expiration?: string | null
        }
        Relationships: [
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
          date_range_end: string | null
          date_range_start: string | null
          dimension_key: string
          dimension_value: string
          id: string
          metrics: Json
          property_id: string
          raw_source: string | null
          report_type: string
        }
        Insert: {
          campaign_name?: string | null
          channel_id: string
          created_at?: string | null
          date_range_end?: string | null
          date_range_start?: string | null
          dimension_key: string
          dimension_value: string
          id?: string
          metrics?: Json
          property_id: string
          raw_source?: string | null
          report_type: string
        }
        Update: {
          campaign_name?: string | null
          channel_id?: string
          created_at?: string | null
          date_range_end?: string | null
          date_range_start?: string | null
          dimension_key?: string
          dimension_value?: string
          id?: string
          metrics?: Json
          property_id?: string
          raw_source?: string | null
          report_type?: string
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
          auto_approve: boolean | null
          brand_voice: string | null
          created_at: string | null
          creativity_level: number | null
          default_hashtags: string[] | null
          id: string
          key_amenities: string[] | null
          nanobanana_default_style: string | null
          nanobanana_quality: string | null
          property_id: string | null
          target_audience: string | null
          updated_at: string | null
        }
        Insert: {
          auto_approve?: boolean | null
          brand_voice?: string | null
          created_at?: string | null
          creativity_level?: number | null
          default_hashtags?: string[] | null
          id?: string
          key_amenities?: string[] | null
          nanobanana_default_style?: string | null
          nanobanana_quality?: string | null
          property_id?: string | null
          target_audience?: string | null
          updated_at?: string | null
        }
        Update: {
          auto_approve?: boolean | null
          brand_voice?: string | null
          created_at?: string | null
          creativity_level?: number | null
          default_hashtags?: string[] | null
          id?: string
          key_amenities?: string[] | null
          nanobanana_default_style?: string | null
          nanobanana_quality?: string | null
          property_id?: string | null
          target_audience?: string | null
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
      geo_property_config: {
        Row: {
          competitor_domains: string[] | null
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
      geo_runs: {
        Row: {
          access_mode: string
          batch_id: string | null
          created_at: string | null
          cross_model_analysis: Json | null
          current_query_index: number | null
          error_message: string | null
          execution_count: number
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
          created_at?: string | null
          cross_model_analysis?: Json | null
          current_query_index?: number | null
          error_message?: string | null
          execution_count?: number
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
          created_at?: string | null
          cross_model_analysis?: Json | null
          current_query_index?: number | null
          error_message?: string | null
          execution_count?: number
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
          property_id: string
          records_imported: number | null
          started_at: string | null
          status: string | null
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
          property_id: string
          records_imported?: number | null
          started_at?: string | null
          status?: string | null
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
          property_id?: string
          records_imported?: number | null
          started_at?: string | null
          status?: string | null
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
          description: string
          id: string
          lead_id: string | null
          metadata: Json | null
          type: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description: string
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          type: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string
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
          event_source: string | null
          event_type: string
          id: string
          lead_id: string | null
          metadata: Json | null
          property_id: string | null
          score_weight: number | null
        }
        Insert: {
          created_at?: string | null
          event_source?: string | null
          event_type: string
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          property_id?: string | null
          score_weight?: number | null
        }
        Update: {
          created_at?: string | null
          event_source?: string | null
          event_type?: string
          id?: string
          lead_id?: string | null
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
          lead_id: string | null
          model_version: string | null
          score_bucket: string
          scored_at: string | null
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
          lead_id?: string | null
          model_version?: string | null
          score_bucket: string
          scored_at?: string | null
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
          lead_id?: string | null
          model_version?: string | null
          score_bucket?: string
          scored_at?: string | null
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
          next_action_at: string | null
          processing_expires_at: string | null
          processing_started_at: string | null
          status: string | null
          updated_at: string | null
          workflow_id: string | null
        }
        Insert: {
          created_at?: string | null
          current_step?: number | null
          id?: string
          last_action_at?: string | null
          lead_id?: string | null
          next_action_at?: string | null
          processing_expires_at?: string | null
          processing_started_at?: string | null
          status?: string | null
          updated_at?: string | null
          workflow_id?: string | null
        }
        Update: {
          created_at?: string | null
          current_step?: number | null
          id?: string
          last_action_at?: string | null
          lead_id?: string | null
          next_action_at?: string | null
          processing_expires_at?: string | null
          processing_started_at?: string | null
          status?: string | null
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
          bedrooms: number | null
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
          phone: string | null
          property_id: string | null
          score: number | null
          score_bucket: string | null
          source: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          bedrooms?: number | null
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
          phone?: string | null
          property_id?: string | null
          score?: number | null
          score_bucket?: string | null
          source?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          bedrooms?: number | null
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
          api_key: string
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
          rag_enabled: boolean | null
          require_email_before_chat: boolean | null
          secondary_color: string | null
          timezone: string | null
          tour_buffer_minutes: number | null
          tour_duration_minutes: number | null
          tours_enabled: boolean | null
          updated_at: string | null
          welcome_message: string | null
          widget_color: string | null
          widget_name: string | null
        }
        Insert: {
          api_key: string
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
          rag_enabled?: boolean | null
          require_email_before_chat?: boolean | null
          secondary_color?: string | null
          timezone?: string | null
          tour_buffer_minutes?: number | null
          tour_duration_minutes?: number | null
          tours_enabled?: boolean | null
          updated_at?: string | null
          welcome_message?: string | null
          widget_color?: string | null
          widget_name?: string | null
        }
        Update: {
          api_key?: string
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
          rag_enabled?: boolean | null
          require_email_before_chat?: boolean | null
          secondary_color?: string | null
          timezone?: string | null
          tour_buffer_minutes?: number | null
          tour_duration_minutes?: number | null
          tours_enabled?: boolean | null
          updated_at?: string | null
          welcome_message?: string | null
          widget_color?: string | null
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
          id: string
          insight_type: string
          period_end: string | null
          period_start: string | null
          property_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          data?: Json
          expires_at?: string | null
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
      marketing_data_uploads: {
        Row: {
          created_at: string | null
          date_range_end: string | null
          date_range_start: string | null
          file_name: string
          id: string
          platform: string
          property_id: string
          report_type: string
          rows_imported: number | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          date_range_end?: string | null
          date_range_start?: string | null
          file_name: string
          id?: string
          platform: string
          property_id: string
          report_type: string
          rows_imported?: number | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          date_range_end?: string | null
          date_range_start?: string | null
          file_name?: string
          id?: string
          platform?: string
          property_id?: string
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
          action_details: Json | null
          created_at: string | null
          error_message: string | null
          id: string
          operation_type: string | null
          parameters: Json | null
          platform: string | null
          property_id: string | null
          result: Json | null
          server: string | null
          success: boolean | null
          timestamp: string | null
          tool: string | null
          tool_name: string | null
        }
        Insert: {
          action_details?: Json | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          operation_type?: string | null
          parameters?: Json | null
          platform?: string | null
          property_id?: string | null
          result?: Json | null
          server?: string | null
          success?: boolean | null
          timestamp?: string | null
          tool?: string | null
          tool_name?: string | null
        }
        Update: {
          action_details?: Json | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          operation_type?: string | null
          parameters?: Json | null
          platform?: string | null
          property_id?: string | null
          result?: Json | null
          server?: string | null
          success?: boolean | null
          timestamp?: string | null
          tool?: string | null
          tool_name?: string | null
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
          alert_threshold_percent: number
          created_at: string
          created_by: string | null
          goal_type: string
          id: string
          is_active: boolean
          is_inverse: boolean
          metric_key: string
          property_id: string
          target_value: number
          updated_at: string
        }
        Insert: {
          alert_threshold_percent?: number
          created_at?: string
          created_by?: string | null
          goal_type?: string
          id?: string
          is_active?: boolean
          is_inverse?: boolean
          metric_key: string
          property_id: string
          target_value: number
          updated_at?: string
        }
        Update: {
          alert_threshold_percent?: number
          created_at?: string
          created_by?: string | null
          goal_type?: string
          id?: string
          is_active?: boolean
          is_inverse?: boolean
          metric_key?: string
          property_id?: string
          target_value?: number
          updated_at?: string
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
          conversation_summary: Json | null
          created_at: string | null
          current_step: number | null
          current_step_name: string | null
          draft_section: Json | null
          gemini_conversation_history: Json | null
          generated_by: string | null
          generation_status: string | null
          id: string
          pdf_generated_at: string | null
          property_id: string
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
          conversation_summary?: Json | null
          created_at?: string | null
          current_step?: number | null
          current_step_name?: string | null
          draft_section?: Json | null
          gemini_conversation_history?: Json | null
          generated_by?: string | null
          generation_status?: string | null
          id?: string
          pdf_generated_at?: string | null
          property_id: string
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
          conversation_summary?: Json | null
          created_at?: string | null
          current_step?: number | null
          current_step_name?: string | null
          draft_section?: Json | null
          gemini_conversation_history?: Json | null
          generated_by?: string | null
          generation_status?: string | null
          id?: string
          pdf_generated_at?: string | null
          property_id?: string
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
          property_id: string
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
          property_id: string
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
          property_id?: string
          role?: string | null
          special_instructions?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_contacts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_contacts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_contacts_property_id_fkey"
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
          site_blueprint_updated_at: string | null
          site_blueprint_version: number | null
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
          site_blueprint_updated_at?: string | null
          site_blueprint_version?: number | null
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
          site_blueprint_updated_at?: string | null
          site_blueprint_version?: number | null
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
          content_draft_id: string | null
          created_at: string | null
          engagement_metrics: Json | null
          error_message: string | null
          id: string
          platform_post_id: string | null
          platform_post_url: string | null
          published_at: string | null
          social_connection_id: string | null
          status: string | null
        }
        Insert: {
          content_draft_id?: string | null
          created_at?: string | null
          engagement_metrics?: Json | null
          error_message?: string | null
          id?: string
          platform_post_id?: string | null
          platform_post_url?: string | null
          published_at?: string | null
          social_connection_id?: string | null
          status?: string | null
        }
        Update: {
          content_draft_id?: string | null
          created_at?: string | null
          engagement_metrics?: Json | null
          error_message?: string | null
          id?: string
          platform_post_id?: string | null
          platform_post_url?: string | null
          published_at?: string | null
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
          created_at: string
          error_message: string | null
          id: string
          metrics_snapshot: Json | null
          recipients_count: number
          report_date_end: string | null
          report_date_start: string | null
          scheduled_report_id: string
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          metrics_snapshot?: Json | null
          recipients_count?: number
          report_date_end?: string | null
          report_date_start?: string | null
          scheduled_report_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          metrics_snapshot?: Json | null
          recipients_count?: number
          report_date_end?: string | null
          report_date_start?: string | null
          scheduled_report_id?: string
          status?: string
          updated_at?: string
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
          place_id: string | null
          platform: string
          property_id: string | null
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
          place_id?: string | null
          platform: string
          property_id?: string | null
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
          place_id?: string | null
          platform?: string
          property_id?: string | null
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
          generation_prompt: string | null
          id: string
          posted_at: string | null
          rejection_reason: string | null
          response_text: string
          response_type: string | null
          review_id: string | null
          status: string | null
          tone: string | null
          updated_at: string | null
        }
        Insert: {
          ai_model?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          generation_prompt?: string | null
          id?: string
          posted_at?: string | null
          rejection_reason?: string | null
          response_text: string
          response_type?: string | null
          review_id?: string | null
          status?: string | null
          tone?: string | null
          updated_at?: string | null
        }
        Update: {
          ai_model?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          generation_prompt?: string | null
          id?: string
          posted_at?: string | null
          rejection_reason?: string | null
          response_text?: string
          response_type?: string | null
          review_id?: string | null
          status?: string | null
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
            foreignKeyName: "review_responses_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      review_tickets: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          description: string | null
          id: string
          priority: string | null
          property_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          review_id: string | null
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          priority?: string | null
          property_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          review_id?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          priority?: string | null
          property_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
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
            foreignKeyName: "review_tickets_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      reviewflow_config: {
        Row: {
          auto_analyze_reviews: boolean | null
          auto_generate_responses: boolean | null
          auto_respond_min_rating: number | null
          auto_respond_positive: boolean | null
          auto_respond_threshold: number | null
          created_at: string | null
          default_signature: string | null
          default_tone: string | null
          escalation_threshold: number | null
          id: string
          is_active: boolean | null
          notification_email: string | null
          notification_slack_webhook: string | null
          notify_on_negative: boolean | null
          notify_on_urgent: boolean | null
          poll_frequency_hours: number | null
          preferred_sync_method: string | null
          property_id: string | null
          property_personality: string | null
          response_delay_minutes: number | null
          response_templates: Json | null
          response_tone: string | null
          slack_webhook_url: string | null
          sync_schedule: string | null
          updated_at: string | null
        }
        Insert: {
          auto_analyze_reviews?: boolean | null
          auto_generate_responses?: boolean | null
          auto_respond_min_rating?: number | null
          auto_respond_positive?: boolean | null
          auto_respond_threshold?: number | null
          created_at?: string | null
          default_signature?: string | null
          default_tone?: string | null
          escalation_threshold?: number | null
          id?: string
          is_active?: boolean | null
          notification_email?: string | null
          notification_slack_webhook?: string | null
          notify_on_negative?: boolean | null
          notify_on_urgent?: boolean | null
          poll_frequency_hours?: number | null
          preferred_sync_method?: string | null
          property_id?: string | null
          property_personality?: string | null
          response_delay_minutes?: number | null
          response_templates?: Json | null
          response_tone?: string | null
          slack_webhook_url?: string | null
          sync_schedule?: string | null
          updated_at?: string | null
        }
        Update: {
          auto_analyze_reviews?: boolean | null
          auto_generate_responses?: boolean | null
          auto_respond_min_rating?: number | null
          auto_respond_positive?: boolean | null
          auto_respond_threshold?: number | null
          created_at?: string | null
          default_signature?: string | null
          default_tone?: string | null
          escalation_threshold?: number | null
          id?: string
          is_active?: boolean | null
          notification_email?: string | null
          notification_slack_webhook?: string | null
          notify_on_negative?: boolean | null
          notify_on_urgent?: boolean | null
          poll_frequency_hours?: number | null
          preferred_sync_method?: string | null
          property_id?: string | null
          property_personality?: string | null
          response_delay_minutes?: number | null
          response_templates?: Json | null
          response_tone?: string | null
          slack_webhook_url?: string | null
          sync_schedule?: string | null
          updated_at?: string | null
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
          created_at: string | null
          id: string
          is_urgent: boolean | null
          platform: string
          platform_review_id: string | null
          property_id: string | null
          rating: number | null
          raw_data: Json | null
          response_status: string | null
          review_date: string | null
          review_text: string
          reviewer_avatar_url: string | null
          reviewer_name: string | null
          sentiment: string | null
          sentiment_score: number | null
          topics: string[] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_urgent?: boolean | null
          platform: string
          platform_review_id?: string | null
          property_id?: string | null
          rating?: number | null
          raw_data?: Json | null
          response_status?: string | null
          review_date?: string | null
          review_text: string
          reviewer_avatar_url?: string | null
          reviewer_name?: string | null
          sentiment?: string | null
          sentiment_score?: number | null
          topics?: string[] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_urgent?: boolean | null
          platform?: string
          platform_review_id?: string | null
          property_id?: string | null
          rating?: number | null
          raw_data?: Json | null
          response_status?: string | null
          review_date?: string | null
          review_text?: string
          reviewer_avatar_url?: string | null
          reviewer_name?: string | null
          sentiment?: string | null
          sentiment_score?: number | null
          topics?: string[] | null
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
          created_at: string
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
          recipients: string[]
          report_type: string
          schedule_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
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
          recipients?: string[]
          report_type?: string
          schedule_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
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
          recipients?: string[]
          report_type?: string
          schedule_type?: string
          updated_at?: string
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
          property_id: string
          radius_miles: number | null
          scrape_frequency: string | null
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
          property_id: string
          radius_miles?: number | null
          scrape_frequency?: string | null
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
          property_id?: string
          radius_miles?: number | null
          scrape_frequency?: string | null
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
          context_snapshot_id: string | null
          created_at: string
          dedupe_key: string | null
          domain: string
          error_message: string | null
          finished_at: string | null
          id: string
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
          context_snapshot_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          domain: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
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
          context_snapshot_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          domain?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
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
          changes_summary: string | null
          created_at: string | null
          created_by: string | null
          edit_intent: string | null
          id: string
          patches_applied: Json | null
          quality_score: number | null
          version: number
          website_id: string
        }
        Insert: {
          blueprint: Json
          changes_summary?: string | null
          created_at?: string | null
          created_by?: string | null
          edit_intent?: string | null
          id?: string
          patches_applied?: Json | null
          quality_score?: number | null
          version: number
          website_id: string
        }
        Update: {
          blueprint?: Json
          changes_summary?: string | null
          created_at?: string | null
          created_by?: string | null
          edit_intent?: string | null
          id?: string
          patches_applied?: Json | null
          quality_score?: number | null
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
          agent_logs: Json | null
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
          agent_logs?: Json | null
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
          agent_logs?: Json | null
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
      social_app_credentials: {
        Row: {
          app_id: string
          app_secret: string
          created_at: string | null
          id: string
          is_active: boolean
          metadata: Json | null
          platform: string
          property_id: string
          updated_at: string | null
        }
        Insert: {
          app_id: string
          app_secret: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json | null
          platform: string
          property_id: string
          updated_at?: string | null
        }
        Update: {
          app_id?: string
          app_secret?: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json | null
          platform?: string
          property_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_app_credentials_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_app_credentials_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_import_status"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "social_app_credentials_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "vw_property_marketing_setup"
            referencedColumns: ["property_id"]
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
          access_token: string | null
          account_avatar_url: string | null
          account_id: string | null
          account_name: string | null
          account_username: string | null
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
          scopes: string[] | null
          token_expires_at: string | null
          updated_at: string | null
          user_access_token: string | null
        }
        Insert: {
          access_token?: string | null
          account_avatar_url?: string | null
          account_id?: string | null
          account_name?: string | null
          account_username?: string | null
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
          scopes?: string[] | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_access_token?: string | null
        }
        Update: {
          access_token?: string | null
          account_avatar_url?: string | null
          account_id?: string | null
          account_name?: string | null
          account_username?: string | null
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
          scopes?: string[] | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_access_token?: string | null
        }
        Relationships: [
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
      tour_bookings: {
        Row: {
          booked_via_conversation_id: string | null
          completed_at: string | null
          completion_notes: string | null
          created_at: string | null
          duration_minutes: number | null
          id: string
          lead_id: string | null
          property_id: string | null
          reminder_1h_sent_at: string | null
          reminder_24h_sent_at: string | null
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
          created_at?: string | null
          duration_minutes?: number | null
          id?: string
          lead_id?: string | null
          property_id?: string | null
          reminder_1h_sent_at?: string | null
          reminder_24h_sent_at?: string | null
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
          created_at?: string | null
          duration_minutes?: number | null
          id?: string
          lead_id?: string | null
          property_id?: string | null
          reminder_1h_sent_at?: string | null
          reminder_24h_sent_at?: string | null
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
          status: string | null
          tour_date: string
          tour_time: string
          tour_type: string | null
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
          status?: string | null
          tour_date: string
          tour_time: string
          tour_type?: string | null
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
          status?: string | null
          tour_date?: string
          tour_time?: string
          tour_type?: string | null
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
          brand_alignment_score: number | null
          caption: string | null
          created_at: string | null
          file_size_bytes: number | null
          file_url: string
          generation_prompt: string | null
          id: string
          mime_type: string | null
          optimized: boolean | null
          original_url: string | null
          quality_score: number | null
          source: string
          usage_context: Json | null
          website_id: string
          wp_media_id: number | null
        }
        Insert: {
          alt_text?: string | null
          asset_type: string
          brand_alignment_score?: number | null
          caption?: string | null
          created_at?: string | null
          file_size_bytes?: number | null
          file_url: string
          generation_prompt?: string | null
          id?: string
          mime_type?: string | null
          optimized?: boolean | null
          original_url?: string | null
          quality_score?: number | null
          source: string
          usage_context?: Json | null
          website_id: string
          wp_media_id?: number | null
        }
        Update: {
          alt_text?: string | null
          asset_type?: string
          brand_alignment_score?: number | null
          caption?: string | null
          created_at?: string | null
          file_size_bytes?: number | null
          file_url?: string
          generation_prompt?: string | null
          id?: string
          mime_type?: string | null
          optimized?: boolean | null
          original_url?: string | null
          quality_score?: number | null
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
          created_at: string | null
          id: string
          last_activity_at: string | null
          lead_id: string | null
          message_count: number | null
          metadata: Json | null
          property_id: string | null
          referrer_url: string | null
          session_end: string | null
          session_start: string | null
          user_agent: string | null
          visitor_id: string | null
        }
        Insert: {
          converted_at?: string | null
          created_at?: string | null
          id?: string
          last_activity_at?: string | null
          lead_id?: string | null
          message_count?: number | null
          metadata?: Json | null
          property_id?: string | null
          referrer_url?: string | null
          session_end?: string | null
          session_start?: string | null
          user_agent?: string | null
          visitor_id?: string | null
        }
        Update: {
          converted_at?: string | null
          created_at?: string | null
          id?: string
          last_activity_at?: string | null
          lead_id?: string | null
          message_count?: number | null
          metadata?: Json | null
          property_id?: string | null
          referrer_url?: string | null
          session_end?: string | null
          session_start?: string | null
          user_agent?: string | null
          visitor_id?: string | null
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
          status: string | null
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
          status?: string | null
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
          status?: string | null
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
          trigger_on: string
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
      create_default_onboarding_tasks: {
        Args: { p_property_id: string }
        Returns: undefined
      }
      execute_readonly_query: { Args: { query_text: string }; Returns: Json }
      get_onboarding_progress: {
        Args: { p_property_id: string }
        Returns: {
          completed_tasks: number
          progress_percentage: number
          total_tasks: number
        }[]
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

