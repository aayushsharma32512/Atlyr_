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
    PostgrestVersion: "12.2.3 (519615d)"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
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
      avatar_heads: {
        Row: {
          chin_placement: number | null
          created_at: string | null
          faceshape: string
          gender: string
          hairstyle: string
          id: string
          image_url: string
          placement_x: number | null
          placement_y: number | null
          scaling_factor: number
          skintone: string
        }
        Insert: {
          chin_placement?: number | null
          created_at?: string | null
          faceshape: string
          gender: string
          hairstyle: string
          id: string
          image_url: string
          placement_x?: number | null
          placement_y?: number | null
          scaling_factor: number
          skintone: string
        }
        Update: {
          chin_placement?: number | null
          created_at?: string | null
          faceshape?: string
          gender?: string
          hairstyle?: string
          id?: string
          image_url?: string
          placement_x?: number | null
          placement_y?: number | null
          scaling_factor?: number
          skintone?: string
        }
        Relationships: []
      }
      batch_enrichment_jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          error_message: string | null
          failed_outfits: number | null
          gemini_batch_name: string
          id: string
          outfit_ids: string[]
          processed_outfits: number | null
          status: string
          total_outfits: number
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          failed_outfits?: number | null
          gemini_batch_name: string
          id?: string
          outfit_ids: string[]
          processed_outfits?: number | null
          status?: string
          total_outfits: number
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          failed_outfits?: number | null
          gemini_batch_name?: string
          id?: string
          outfit_ids?: string[]
          processed_outfits?: number | null
          status?: string
          total_outfits?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      embedding_queue: {
        Row: {
          id: number
          needs_image_embedding: boolean | null
          needs_text_embedding: boolean | null
          product_id: string
          queued_at: string | null
        }
        Insert: {
          id?: number
          needs_image_embedding?: boolean | null
          needs_text_embedding?: boolean | null
          product_id: string
          queued_at?: string | null
        }
        Update: {
          id?: number
          needs_image_embedding?: boolean | null
          needs_text_embedding?: boolean | null
          product_id?: string
          queued_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "embedding_queue_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      global_metrics: {
        Row: {
          id: string
          last_updated: string | null
          outfit_id: string
          total_saves: number | null
          total_shares: number | null
          total_studio_opens: number | null
          total_views: number | null
        }
        Insert: {
          id?: string
          last_updated?: string | null
          outfit_id: string
          total_saves?: number | null
          total_shares?: number | null
          total_studio_opens?: number | null
          total_views?: number | null
        }
        Update: {
          id?: string
          last_updated?: string | null
          outfit_id?: string
          total_saves?: number | null
          total_shares?: number | null
          total_studio_opens?: number | null
          total_views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "global_metrics_outfit_id_fkey"
            columns: ["outfit_id"]
            isOneToOne: true
            referencedRelation: "outfits"
            referencedColumns: ["id"]
          },
        ]
      }
      ingested_product_images: {
        Row: {
          created_at: string | null
          gender: string | null
          ghost_eligible: boolean
          id: string
          is_primary: boolean
          kind: string
          product_id: string
          product_view: string | null
          sort_order: number
          summary_eligible: boolean
          updated_at: string | null
          url: string
          vto_eligible: boolean
        }
        Insert: {
          created_at?: string | null
          gender?: string | null
          ghost_eligible?: boolean
          id?: string
          is_primary?: boolean
          kind: string
          product_id: string
          product_view?: string | null
          sort_order?: number
          summary_eligible?: boolean
          updated_at?: string | null
          url: string
          vto_eligible?: boolean
        }
        Update: {
          created_at?: string | null
          gender?: string | null
          ghost_eligible?: boolean
          id?: string
          is_primary?: boolean
          kind?: string
          product_id?: string
          product_view?: string | null
          sort_order?: number
          summary_eligible?: boolean
          updated_at?: string | null
          url?: string
          vto_eligible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ingested_product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "ingested_products"
            referencedColumns: ["id"]
          },
        ]
      }
      ingested_products: {
        Row: {
          body_parts_visible: Json | null
          brand: string
          care: string | null
          category_id: string | null
          color: string
          color_group: string | null
          created_at: string
          currency: string
          description: string
          description_text: string | null
          feel: string | null
          fit: string | null
          garment_summary: Json | null
          garment_summary_back: Json | null
          garment_summary_front: Json | null
          garment_summary_version: string | null
          gender: string | null
          id: string
          image_length: number | null
          image_url: string
          material_type: string | null
          occasion: string | null
          placement_x: number | null
          placement_y: number | null
          price: number
          product_length: number | null
          product_name: string | null
          product_specifications: Json | null
          product_url: string | null
          similar_items: string | null
          size: string
          size_chart: Json | null
          type: Database["public"]["Enums"]["item_type"]
          type_category: string | null
          updated_at: string
          vector_embedding: string | null
          vibes: string | null
        }
        Insert: {
          body_parts_visible?: Json | null
          brand: string
          care?: string | null
          category_id?: string | null
          color: string
          color_group?: string | null
          created_at?: string
          currency?: string
          description: string
          description_text?: string | null
          feel?: string | null
          fit?: string | null
          garment_summary?: Json | null
          garment_summary_back?: Json | null
          garment_summary_front?: Json | null
          garment_summary_version?: string | null
          gender?: string | null
          id: string
          image_length?: number | null
          image_url: string
          material_type?: string | null
          occasion?: string | null
          placement_x?: number | null
          placement_y?: number | null
          price: number
          product_length?: number | null
          product_name?: string | null
          product_specifications?: Json | null
          product_url?: string | null
          similar_items?: string | null
          size: string
          size_chart?: Json | null
          type: Database["public"]["Enums"]["item_type"]
          type_category?: string | null
          updated_at?: string
          vector_embedding?: string | null
          vibes?: string | null
        }
        Update: {
          body_parts_visible?: Json | null
          brand?: string
          care?: string | null
          category_id?: string | null
          color?: string
          color_group?: string | null
          created_at?: string
          currency?: string
          description?: string
          description_text?: string | null
          feel?: string | null
          fit?: string | null
          garment_summary?: Json | null
          garment_summary_back?: Json | null
          garment_summary_front?: Json | null
          garment_summary_version?: string | null
          gender?: string | null
          id?: string
          image_length?: number | null
          image_url?: string
          material_type?: string | null
          occasion?: string | null
          placement_x?: number | null
          placement_y?: number | null
          price?: number
          product_length?: number | null
          product_name?: string | null
          product_specifications?: Json | null
          product_url?: string | null
          similar_items?: string | null
          size?: string
          size_chart?: Json | null
          type?: Database["public"]["Enums"]["item_type"]
          type_category?: string | null
          updated_at?: string
          vector_embedding?: string | null
          vibes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingested_products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_job_state: {
        Row: {
          checkpoint: Json | null
          currentstate: Json
          job_id: string
          updated_at: string
        }
        Insert: {
          checkpoint?: Json | null
          currentstate: Json
          job_id: string
          updated_at?: string
        }
        Update: {
          checkpoint?: Json | null
          currentstate?: Json
          job_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ingestion_jobs: {
        Row: {
          assigned_operator: string | null
          batch_id: string | null
          batch_label: string | null
          canonical_url: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          dedupe_key: string
          domain: string
          duplicate_of: string | null
          error_count: number
          job_id: string
          last_error: string | null
          last_step: string | null
          original_url: string
          path: string
          pause_reason: string | null
          phase_flags: Json | null
          phase1_completed_at: string | null
          phase2_completed_at: string | null
          promote_at: string | null
          queued_at: string | null
          stage_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["ingestion_job_status"]
          updated_at: string
        }
        Insert: {
          assigned_operator?: string | null
          batch_id?: string | null
          batch_label?: string | null
          canonical_url: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key: string
          domain: string
          duplicate_of?: string | null
          error_count?: number
          job_id: string
          last_error?: string | null
          last_step?: string | null
          original_url: string
          path: string
          pause_reason?: string | null
          phase_flags?: Json | null
          phase1_completed_at?: string | null
          phase2_completed_at?: string | null
          promote_at?: string | null
          queued_at?: string | null
          stage_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["ingestion_job_status"]
          updated_at?: string
        }
        Update: {
          assigned_operator?: string | null
          batch_id?: string | null
          batch_label?: string | null
          canonical_url?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key?: string
          domain?: string
          duplicate_of?: string | null
          error_count?: number
          job_id?: string
          last_error?: string | null
          last_step?: string | null
          original_url?: string
          path?: string
          pause_reason?: string | null
          phase_flags?: Json | null
          phase1_completed_at?: string | null
          phase2_completed_at?: string | null
          promote_at?: string | null
          queued_at?: string | null
          stage_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["ingestion_job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_jobs_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["job_id"]
          },
        ]
      }
      invite_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          current_uses: number
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number | null
          metadata: Json
          type: Database["public"]["Enums"]["invite_code_type"]
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          current_uses?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          metadata?: Json
          type?: Database["public"]["Enums"]["invite_code_type"]
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          current_uses?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          metadata?: Json
          type?: Database["public"]["Enums"]["invite_code_type"]
          updated_at?: string
        }
        Relationships: []
      }
      invite_redemptions: {
        Row: {
          code: string
          id: string
          invite_code_id: string
          metadata: Json
          redeemed_at: string
          user_id: string
        }
        Insert: {
          code: string
          id?: string
          invite_code_id: string
          metadata?: Json
          redeemed_at?: string
          user_id: string
        }
        Update: {
          code?: string
          id?: string
          invite_code_id?: string
          metadata?: Json
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_redemptions_invite_code_id_fkey"
            columns: ["invite_code_id"]
            isOneToOne: false
            referencedRelation: "invite_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      likeness_candidates: {
        Row: {
          batch_id: string
          candidate_index: number
          created_at: string
          id: string
          identity_summary: string | null
          mime_type: string
          storage_path: string
          user_id: string
        }
        Insert: {
          batch_id: string
          candidate_index: number
          created_at?: string
          id?: string
          identity_summary?: string | null
          mime_type?: string
          storage_path: string
          user_id: string
        }
        Update: {
          batch_id?: string
          candidate_index?: number
          created_at?: string
          id?: string
          identity_summary?: string | null
          mime_type?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: []
      }
      mannequin: {
        Row: {
          body_type: string
          created_at: string
          default_scale: number
          gender: string
          height_cm: number
          id: string
          is_default: boolean
          segment_config: Json
          updated_at: string
        }
        Insert: {
          body_type: string
          created_at?: string
          default_scale?: number
          gender: string
          height_cm: number
          id?: string
          is_default?: boolean
          segment_config: Json
          updated_at?: string
        }
        Update: {
          body_type?: string
          created_at?: string
          default_scale?: number
          gender?: string
          height_cm?: number
          id?: string
          is_default?: boolean
          segment_config?: Json
          updated_at?: string
        }
        Relationships: []
      }
      occasions: {
        Row: {
          background_url: string
          created_at: string
          description: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          background_url: string
          created_at?: string
          description?: string | null
          id: string
          name: string
          slug: string
        }
        Update: {
          background_url?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          outfit_id: string
          price_at_time: number
          quantity: number
          selected_sizes: Json
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          outfit_id: string
          price_at_time: number
          quantity?: number
          selected_sizes?: Json
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          outfit_id?: string
          price_at_time?: number
          quantity?: number
          selected_sizes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_outfit_id_fkey"
            columns: ["outfit_id"]
            isOneToOne: false
            referencedRelation: "outfits"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          currency: string
          delivery_address: string
          id: string
          payment_method: string
          status: Database["public"]["Enums"]["order_status"]
          total_price: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          delivery_address: string
          id?: string
          payment_method: string
          status?: Database["public"]["Enums"]["order_status"]
          total_price: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          delivery_address?: string
          id?: string
          payment_method?: string
          status?: Database["public"]["Enums"]["order_status"]
          total_price?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      outfit_enrichment_drafts: {
        Row: {
          approval_status: string
          batch_job_id: string | null
          created_at: string
          enriched_description: string | null
          enriched_feel: string[] | null
          enriched_fit: string[] | null
          enriched_vibes: string[] | null
          enriched_word_association: string | null
          id: string
          model_name: string
          model_version: string | null
          outfit_id: string
          prompt_version: string
          raw_response: Json
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          suggested_category: string | null
          suggested_name: string | null
          suggested_occasion: string | null
          updated_at: string
        }
        Insert: {
          approval_status?: string
          batch_job_id?: string | null
          created_at?: string
          enriched_description?: string | null
          enriched_feel?: string[] | null
          enriched_fit?: string[] | null
          enriched_vibes?: string[] | null
          enriched_word_association?: string | null
          id?: string
          model_name: string
          model_version?: string | null
          outfit_id: string
          prompt_version: string
          raw_response: Json
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          suggested_category?: string | null
          suggested_name?: string | null
          suggested_occasion?: string | null
          updated_at?: string
        }
        Update: {
          approval_status?: string
          batch_job_id?: string | null
          created_at?: string
          enriched_description?: string | null
          enriched_feel?: string[] | null
          enriched_fit?: string[] | null
          enriched_vibes?: string[] | null
          enriched_word_association?: string | null
          id?: string
          model_name?: string
          model_version?: string | null
          outfit_id?: string
          prompt_version?: string
          raw_response?: Json
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          suggested_category?: string | null
          suggested_name?: string | null
          suggested_occasion?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outfit_enrichment_drafts_outfit_id_fkey"
            columns: ["outfit_id"]
            isOneToOne: false
            referencedRelation: "outfits"
            referencedColumns: ["id"]
          },
        ]
      }
      outfit_hashes: {
        Row: {
          created_at: string | null
          hash_id: string
          id: string
          originating_outfit_id: string | null
          outfit_components: Json
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          hash_id: string
          id?: string
          originating_outfit_id?: string | null
          outfit_components: Json
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          hash_id?: string
          id?: string
          originating_outfit_id?: string | null
          outfit_components?: Json
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outfit_hashes_originating_outfit_id_fkey"
            columns: ["originating_outfit_id"]
            isOneToOne: false
            referencedRelation: "outfits"
            referencedColumns: ["id"]
          },
        ]
      }
      outfits: {
        Row: {
          background_id: string | null
          bottom_id: string | null
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          description_text: string | null
          enriched_category: string | null
          enriched_description: string | null
          enriched_feel: string[] | null
          enriched_fit: string[] | null
          enriched_occasion: string | null
          enriched_vibes: string[] | null
          enriched_word_association: string | null
          feel: string | null
          fit: string | null
          gender: string | null
          id: string
          is_private: boolean
          name: string
          occasion: string
          outfit_images: string | null
          outfit_match: string | null
          popularity: number
          rating: number
          shoes_id: string | null
          top_id: string | null
          updated_at: string
          user_id: string | null
          vector_embedding: string | null
          vibes: string | null
          visible_in_feed: boolean
          word_association: string | null
        }
        Insert: {
          background_id?: string | null
          bottom_id?: string | null
          category: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          description_text?: string | null
          enriched_category?: string | null
          enriched_description?: string | null
          enriched_feel?: string[] | null
          enriched_fit?: string[] | null
          enriched_occasion?: string | null
          enriched_vibes?: string[] | null
          enriched_word_association?: string | null
          feel?: string | null
          fit?: string | null
          gender?: string | null
          id: string
          is_private?: boolean
          name: string
          occasion: string
          outfit_images?: string | null
          outfit_match?: string | null
          popularity?: number
          rating?: number
          shoes_id?: string | null
          top_id?: string | null
          updated_at?: string
          user_id?: string | null
          vector_embedding?: string | null
          vibes?: string | null
          visible_in_feed?: boolean
          word_association?: string | null
        }
        Update: {
          background_id?: string | null
          bottom_id?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          description_text?: string | null
          enriched_category?: string | null
          enriched_description?: string | null
          enriched_feel?: string[] | null
          enriched_fit?: string[] | null
          enriched_occasion?: string | null
          enriched_vibes?: string[] | null
          enriched_word_association?: string | null
          feel?: string | null
          fit?: string | null
          gender?: string | null
          id?: string
          is_private?: boolean
          name?: string
          occasion?: string
          outfit_images?: string | null
          outfit_match?: string | null
          popularity?: number
          rating?: number
          shoes_id?: string | null
          top_id?: string | null
          updated_at?: string
          user_id?: string | null
          vector_embedding?: string | null
          vibes?: string | null
          visible_in_feed?: boolean
          word_association?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outfits_bottom_id_fkey"
            columns: ["bottom_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outfits_category_fkey"
            columns: ["category"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outfits_occasion_background_fkey"
            columns: ["occasion"]
            isOneToOne: false
            referencedRelation: "occasions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outfits_outfit_match_fkey"
            columns: ["outfit_match"]
            isOneToOne: false
            referencedRelation: "outfits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outfits_shoes_id_fkey"
            columns: ["shoes_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outfits_top_id_fkey"
            columns: ["top_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          created_at: string | null
          gender: string | null
          ghost_eligible: boolean
          id: string
          is_primary: boolean
          kind: string
          product_id: string
          product_view: string | null
          sort_order: number
          summary_eligible: boolean
          updated_at: string | null
          url: string
          vto_eligible: boolean
        }
        Insert: {
          created_at?: string | null
          gender?: string | null
          ghost_eligible?: boolean
          id?: string
          is_primary?: boolean
          kind: string
          product_id: string
          product_view?: string | null
          sort_order?: number
          summary_eligible?: boolean
          updated_at?: string | null
          url: string
          vto_eligible?: boolean
        }
        Update: {
          created_at?: string | null
          gender?: string | null
          ghost_eligible?: boolean
          id?: string
          is_primary?: boolean
          kind?: string
          product_id?: string
          product_view?: string | null
          sort_order?: number
          summary_eligible?: boolean
          updated_at?: string | null
          url?: string
          vto_eligible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          body_parts_visible: Json | null
          brand: string
          care: string | null
          category_id: string | null
          color: string
          color_group: string | null
          created_at: string
          currency: string
          description: string
          description_text: string | null
          embedded_at: string | null
          feel: string | null
          fit: string | null
          garment_summary: Json | null
          garment_summary_back: Json | null
          garment_summary_front: Json | null
          garment_summary_version: string | null
          gender: string | null
          id: string
          image_length: number | null
          image_url: string
          image_vector: string | null
          material_type: string | null
          occasion: string | null
          placement_x: number | null
          placement_y: number | null
          price: number
          product_length: number | null
          product_name: string | null
          product_specifications: Json | null
          product_url: string | null
          similar_items: string | null
          size: string
          size_chart: Json | null
          text_vector: string | null
          type: Database["public"]["Enums"]["item_type"]
          type_category: string | null
          updated_at: string
          vector_embedding: string | null
          vector_version: number | null
          vibes: string | null
        }
        Insert: {
          body_parts_visible?: Json | null
          brand: string
          care?: string | null
          category_id?: string | null
          color: string
          color_group?: string | null
          created_at?: string
          currency?: string
          description: string
          description_text?: string | null
          embedded_at?: string | null
          feel?: string | null
          fit?: string | null
          garment_summary?: Json | null
          garment_summary_back?: Json | null
          garment_summary_front?: Json | null
          garment_summary_version?: string | null
          gender?: string | null
          id: string
          image_length?: number | null
          image_url: string
          image_vector?: string | null
          material_type?: string | null
          occasion?: string | null
          placement_x?: number | null
          placement_y?: number | null
          price: number
          product_length?: number | null
          product_name?: string | null
          product_specifications?: Json | null
          product_url?: string | null
          similar_items?: string | null
          size: string
          size_chart?: Json | null
          text_vector?: string | null
          type: Database["public"]["Enums"]["item_type"]
          type_category?: string | null
          updated_at?: string
          vector_embedding?: string | null
          vector_version?: number | null
          vibes?: string | null
        }
        Update: {
          body_parts_visible?: Json | null
          brand?: string
          care?: string | null
          category_id?: string | null
          color?: string
          color_group?: string | null
          created_at?: string
          currency?: string
          description?: string
          description_text?: string | null
          embedded_at?: string | null
          feel?: string | null
          fit?: string | null
          garment_summary?: Json | null
          garment_summary_back?: Json | null
          garment_summary_front?: Json | null
          garment_summary_version?: string | null
          gender?: string | null
          id?: string
          image_length?: number | null
          image_url?: string
          image_vector?: string | null
          material_type?: string | null
          occasion?: string | null
          placement_x?: number | null
          placement_y?: number | null
          price?: number
          product_length?: number | null
          product_name?: string | null
          product_specifications?: Json | null
          product_url?: string | null
          similar_items?: string | null
          size?: string
          size_chart?: Json | null
          text_vector?: string | null
          type?: Database["public"]["Enums"]["item_type"]
          type_category?: string | null
          updated_at?: string
          vector_embedding?: string | null
          vector_version?: number | null
          vibes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age: number | null
          bottom_staples: string | null
          hair_color_hex: string | null
          hair_style_id: string | null
          city: string | null
          collections_meta: Json | null
          created_at: string
          date_of_birth: string | null
          gender: string | null
          head_to_body_ratio: number | null
          height_cm: number | null
          id: string
          name: string
          onboarding_complete: boolean | null
          preferred_categories: string[] | null
          role: string
          selected_avatar_id: string | null
          selected_avatar_image_url: string | null
          selected_avatar_scaling_factor: number | null
          selected_face_shape: string | null
          selected_hairstyle: string | null
          selected_silhouette: string | null
          selected_skin_tone: string | null
          shoes_staples: string | null
          social_handle: string | null
          themes: Json | null
          top_staples: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          age?: number | null
          bottom_staples?: string | null
          hair_color_hex?: string | null
          hair_style_id?: string | null
          city?: string | null
          collections_meta?: Json | null
          created_at?: string
          date_of_birth?: string | null
          gender?: string | null
          head_to_body_ratio?: number | null
          height_cm?: number | null
          id?: string
          name: string
          onboarding_complete?: boolean | null
          preferred_categories?: string[] | null
          role?: string
          selected_avatar_id?: string | null
          selected_avatar_image_url?: string | null
          selected_avatar_scaling_factor?: number | null
          selected_face_shape?: string | null
          selected_hairstyle?: string | null
          selected_silhouette?: string | null
          selected_skin_tone?: string | null
          shoes_staples?: string | null
          social_handle?: string | null
          themes?: Json | null
          top_staples?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          age?: number | null
          bottom_staples?: string | null
          hair_color_hex?: string | null
          hair_style_id?: string | null
          city?: string | null
          collections_meta?: Json | null
          created_at?: string
          date_of_birth?: string | null
          gender?: string | null
          head_to_body_ratio?: number | null
          height_cm?: number | null
          id?: string
          name?: string
          onboarding_complete?: boolean | null
          preferred_categories?: string[] | null
          role?: string
          selected_avatar_id?: string | null
          selected_avatar_image_url?: string | null
          selected_avatar_scaling_factor?: number | null
          selected_face_shape?: string | null
          selected_hairstyle?: string | null
          selected_silhouette?: string | null
          selected_skin_tone?: string | null
          shoes_staples?: string | null
          social_handle?: string | null
          themes?: Json | null
          top_staples?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_profiles_avatar_heads"
            columns: ["selected_avatar_id"]
            isOneToOne: false
            referencedRelation: "avatar_heads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_hair_style_id_fkey"
            columns: ["hair_style_id"]
            isOneToOne: false
            referencedRelation: "avatar_hair_styles"
            referencedColumns: ["id"]
          },
        ]
      }
      avatar_hair_styles: {
        Row: {
          asset_url: string
          created_at: string
          gender: string
          id: string
          is_active: boolean
          is_default: boolean
          length_pct: number
          x_offset_pct: number
          sort_order: number
          style_key: string
          updated_at: string
          y_offset_pct: number
          z_index: number
        }
        Insert: {
          asset_url: string
          created_at?: string
          gender: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          length_pct: number
          x_offset_pct?: number
          sort_order?: number
          style_key: string
          updated_at?: string
          y_offset_pct: number
          z_index: number
        }
        Update: {
          asset_url?: string
          created_at?: string
          gender?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          length_pct?: number
          x_offset_pct?: number
          sort_order?: number
          style_key?: string
          updated_at?: string
          y_offset_pct?: number
          z_index?: number
        }
        Relationships: []
      }
      silhouettes: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id: string
          image_url: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string
          name?: string
        }
        Relationships: []
      }
      user_cart: {
        Row: {
          added_at: string
          id: string
          outfit_id: string
          quantity: number
          selected_sizes: Json
          user_id: string
        }
        Insert: {
          added_at?: string
          id?: string
          outfit_id: string
          quantity?: number
          selected_sizes?: Json
          user_id: string
        }
        Update: {
          added_at?: string
          id?: string
          outfit_id?: string
          quantity?: number
          selected_sizes?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_cart_outfit_id_fkey"
            columns: ["outfit_id"]
            isOneToOne: false
            referencedRelation: "outfits"
            referencedColumns: ["id"]
          },
        ]
      }
      user_collection_stats: {
        Row: {
          collection_slug: string
          item_count: number
          preview_items: Json
          preview_outfit_ids: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          collection_slug: string
          item_count?: number
          preview_items?: Json
          preview_outfit_ids?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          collection_slug?: string
          item_count?: number
          preview_items?: Json
          preview_outfit_ids?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_collections: {
        Row: {
          created_at: string
          id: string
          label: string
          slug: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          slug: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          slug?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_favorites: {
        Row: {
          collection_label: string
          collection_slug: string
          created_at: string
          id: string
          outfit_id: string | null
          product_id: string | null
          user_id: string
        }
        Insert: {
          collection_label?: string
          collection_slug?: string
          created_at?: string
          id?: string
          outfit_id?: string | null
          product_id?: string | null
          user_id: string
        }
        Update: {
          collection_label?: string
          collection_slug?: string
          created_at?: string
          id?: string
          outfit_id?: string | null
          product_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_favorites_outfit_id_fkey"
            columns: ["outfit_id"]
            isOneToOne: false
            referencedRelation: "outfits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      user_generations: {
        Row: {
          created_at: string
          id: string
          metadata: Json | null
          neutral_pose_id: string
          outfit_id: string | null
          status: Database["public"]["Enums"]["generation_status"]
          storage_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json | null
          neutral_pose_id: string
          outfit_id?: string | null
          status?: Database["public"]["Enums"]["generation_status"]
          storage_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json | null
          neutral_pose_id?: string
          outfit_id?: string | null
          status?: Database["public"]["Enums"]["generation_status"]
          storage_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_generations_neutral_pose_id_fkey"
            columns: ["neutral_pose_id"]
            isOneToOne: false
            referencedRelation: "user_neutral_poses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_generations_outfit_id_fkey"
            columns: ["outfit_id"]
            isOneToOne: false
            referencedRelation: "outfits"
            referencedColumns: ["id"]
          },
        ]
      }
      user_interactions: {
        Row: {
          category: string
          created_at: string | null
          id: string
          interaction_type: string
          metadata: Json | null
          outfit_id: string
          user_id: string
          weight: number
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          interaction_type: string
          metadata?: Json | null
          outfit_id: string
          user_id: string
          weight: number
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          interaction_type?: string
          metadata?: Json | null
          outfit_id?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_interactions_category_fkey"
            columns: ["category"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_interactions_outfit_id_fkey"
            columns: ["outfit_id"]
            isOneToOne: false
            referencedRelation: "outfits"
            referencedColumns: ["id"]
          },
        ]
      }
      user_neutral_poses: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          metadata: Json | null
          original_fullbody_path: string
          original_selfie_path: string
          status: Database["public"]["Enums"]["neutral_pose_status"]
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json | null
          original_fullbody_path: string
          original_selfie_path: string
          status?: Database["public"]["Enums"]["neutral_pose_status"]
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json | null
          original_fullbody_path?: string
          original_selfie_path?: string
          status?: Database["public"]["Enums"]["neutral_pose_status"]
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          converted_at: string | null
          created_at: string
          email: string
          id: string
          invite_code: string | null
          invited_at: string | null
          metadata: Json
          name: string
          phone_number: string | null
          source: string | null
          status: Database["public"]["Enums"]["waitlist_status"]
        }
        Insert: {
          converted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invite_code?: string | null
          invited_at?: string | null
          metadata?: Json
          name: string
          phone_number?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["waitlist_status"]
        }
        Update: {
          converted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invite_code?: string | null
          invited_at?: string | null
          metadata?: Json
          name?: string
          phone_number?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["waitlist_status"]
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_roles: {
        Args: {
          user_ids: string[]
        }
        Returns: {
          found_user_id: string
          found_role: string
        }[]
      }
      approve_outfit_enrichment_draft: {
        Args: { draft_id: string; reviewer_id: string }
        Returns: Json
      }
      calculate_outfit_score: {
        Args: { p_days_limit?: number; p_outfit_id: string; p_user_id: string }
        Returns: number
      }
      calculate_recency_factor: {
        Args: { days_since: number }
        Returns: number
      }
      canonical_collection_slug: { Args: { p_slug: string }; Returns: string }
      get_collections_with_previews: {
        Args: { p_user_id?: string }
        Returns: {
          collection_label: string
          collection_slug: string
          is_system: boolean
          item_count: number
          preview_items: Json
          preview_outfit_ids: string[]
          preview_outfits_render: Json
        }[]
      }
      get_curated_outfit_ids_seeded: {
        Args: { p_gender: string | null; p_seed: string; p_limit?: number; p_offset?: number }
        Returns: {
          id: string
        }[]
      }
      get_moodboard_previews: {
        Args: { p_slugs: string[]; p_user_id: string }
        Returns: {
          brand: string
          collection_slug: string
          currency: string
          gender: string
          image_url: string
          item_id: string
          item_type: string
          price: number
          product_name: string
          rendered_items: Json
        }[]
      }
      get_moodboard_items_batch: {
        Args: {
          p_user_id?: string
          p_slugs?: string[]
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          collection_slug: string
          created_at: string
          item_type: string
          outfit:
          | (Database["public"]["Tables"]["outfits"]["Row"] & {
            occasion?: Json | null
            top?: Json | null
            bottom?: Json | null
            shoes?: Json | null
          })
          | null
          product: Database["public"]["Tables"]["products"]["Row"] | null
        }[]
      }
      get_similar_products: {
        Args: { product_id_param: string }
        Returns: {
          brand: string
          category_id: string
          color: string
          color_group: string
          created_at: string
          currency: string
          description: string
          feel: string
          fit: string
          gender: string
          id: string
          image_length: number
          image_url: string
          placement_x: number
          placement_y: number
          price: number
          product_name: string
          size: string
          type: Database["public"]["Enums"]["item_type"]
          type_category: string
          updated_at: string
          vibes: string
        }[]
      }
      get_top_rated_outfit_per_category: {
        Args: never
        Returns: {
          bottom_brand: string
          bottom_color: string
          bottom_currency: string
          bottom_description: string
          bottom_id: string
          bottom_image_url: string
          bottom_price: number
          bottom_size: string
          bottom_type: string
          category_id: string
          category_name: string
          category_slug: string
          occasion_background_url: string
          occasion_id: string
          occasion_name: string
          outfit_background_id: string
          outfit_id: string
          outfit_name: string
          outfit_rating: number
          shoes_brand: string
          shoes_color: string
          shoes_currency: string
          shoes_description: string
          shoes_id: string
          shoes_image_url: string
          shoes_price: number
          shoes_size: string
          shoes_type: string
          top_brand: string
          top_color: string
          top_currency: string
          top_description: string
          top_id: string
          top_image_url: string
          top_price: number
          top_size: string
          top_type: string
        }[]
      }
      get_user_collections: {
        Args: { p_user_id?: string }
        Returns: {
          collection_created_at: string
          collection_label: string
          collection_slug: string
          is_system: boolean
          item_count: number
        }[]
      }
      get_user_creations_counts: {
        Args: { p_user_id: string }
        Returns: {
          saved_outfit_count: number
          total_count: number
          tryon_outfit_count: number
        }[]
      }
      get_user_creations_page: {
        Args: { p_page?: number; p_size?: number; p_user_id: string }
        Returns: {
          background_id: string
          created_at: string
          gender: string
          is_private: boolean
          latest_generation_created_at: string
          latest_generation_status: string
          latest_generation_storage_path: string
          outfit_id: string
          outfit_name: string
          visible_in_feed: boolean
        }[]
      }
      has_app_access: { Args: never; Returns: boolean }
      manage_collection: {
        Args: {
          p_collection_label?: string
          p_collection_slug: string
          p_operation: string
          p_user_id?: string
        }
        Returns: Json
      }
      match_products_image: {
        Args: {
          filters?: Json
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          brand: string
          color: string
          id: string
          product_name: string
          similarity: number
          type_category: string
        }[]
      }
      match_products_text: {
        Args: {
          filters?: Json
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          brand: string
          color: string
          id: string
          product_name: string
          similarity: number
          type_category: string
        }[]
      }
      promote_ingested_product: {
        Args: { p_product_id: string }
        Returns: undefined
      }
      record_invite_use: {
        Args: { p_code: string; p_user_id?: string }
        Returns: Json
      }
      redeem_invite: { Args: { p_code: string }; Returns: Json }
      refresh_user_collection_stats: {
        Args: { p_collection_slug: string; p_user_id: string }
        Returns: undefined
      }
      search_outfits_by_vector: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          background_id: string
          category: string
          created_at: string
          created_by: string
          description: string
          description_text: string
          feel: string
          fit: string
          gender: string
          id: string
          name: string
          occasion: string
          outfit_match: string
          popularity: number
          rating: number
          similarity: number
          updated_at: string
          visible_in_feed: boolean
          word_association: string
        }[]
      }
      search_products_by_vector: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          brand: string
          category_id: string
          color: string
          color_group: string
          created_at: string
          currency: string
          description: string
          description_text: string
          feel: string
          fit: string
          gender: string
          id: string
          image_length: number
          image_url: string
          placement_x: number
          placement_y: number
          price: number
          product_name: string
          similarity: number
          size: string
          type: Database["public"]["Enums"]["item_type"]
          type_category: string
          updated_at: string
          vibes: string
        }[]
      }
      stage_ingested_product: {
        Args: { images: Json; product: Json }
        Returns: undefined
      }
      submit_to_waitlist: {
        Args: {
          p_email: string
          p_metadata?: Json
          p_name: string
          p_phone_number: string
          p_source?: string
        }
        Returns: Json
      }
      trigger_github_embedding_workflow: { Args: never; Returns: undefined }
      validate_invite_code: { Args: { p_code: string }; Returns: Json }
    }
    Enums: {
      generation_status: "queued" | "generating" | "ready" | "failed"
      ingestion_job_status:
      | "queued"
      | "ingesting"
      | "awaiting_phase1"
      | "phase1_complete"
      | "awaiting_phase2"
      | "promoting"
      | "completed"
      | "errored"
      | "cancelled"
      invite_code_type: "beta" | "waitlist_invite" | "special"
      item_type: "top" | "bottom" | "shoes" | "accessory" | "occasion"
      neutral_pose_status: "pending" | "ready" | "failed"
      order_status:
      | "pending"
      | "processing"
      | "shipped"
      | "delivered"
      | "cancelled"
      payment_type: "card" | "upi" | "wallet"
      waitlist_status: "pending" | "invited" | "converted" | "rejected"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      generation_status: ["queued", "generating", "ready", "failed"],
      ingestion_job_status: [
        "queued",
        "ingesting",
        "awaiting_phase1",
        "phase1_complete",
        "awaiting_phase2",
        "promoting",
        "completed",
        "errored",
        "cancelled",
      ],
      invite_code_type: ["beta", "waitlist_invite", "special"],
      item_type: ["top", "bottom", "shoes", "accessory", "occasion"],
      neutral_pose_status: ["pending", "ready", "failed"],
      order_status: [
        "pending",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
      ],
      payment_type: ["card", "upi", "wallet"],
      waitlist_status: ["pending", "invited", "converted", "rejected"],
    },
  },
} as const
