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
      amenities: {
        Row: {
          category: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      developer_translations: {
        Row: {
          created_at: string
          description: string | null
          developer_id: string
          id: string
          locale: string
          name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          developer_id: string
          id?: string
          locale: string
          name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          developer_id?: string
          id?: string
          locale?: string
          name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "developer_translations_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "developers"
            referencedColumns: ["id"]
          },
        ]
      }
      developers: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          description: string | null
          id: string
          logo_url: string | null
          name: string
          updated_at: string
          website: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      investment_data: {
        Row: {
          annual_roi_percent: number | null
          created_at: string
          expected_daily_rate: number | null
          expected_monthly_rent: number | null
          expected_yearly_rent: number | null
          guarantee_years: number | null
          guaranteed_rental_percent: number | null
          id: string
          management_company: string | null
          notes: string | null
          occupancy_rate: number | null
          project_id: string | null
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          annual_roi_percent?: number | null
          created_at?: string
          expected_daily_rate?: number | null
          expected_monthly_rent?: number | null
          expected_yearly_rent?: number | null
          guarantee_years?: number | null
          guaranteed_rental_percent?: number | null
          id?: string
          management_company?: string | null
          notes?: string | null
          occupancy_rate?: number | null
          project_id?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          annual_roi_percent?: number | null
          created_at?: string
          expected_daily_rate?: number | null
          expected_monthly_rent?: number | null
          expected_yearly_rent?: number | null
          guarantee_years?: number | null
          guaranteed_rental_percent?: number | null
          id?: string
          management_company?: string | null
          notes?: string | null
          occupancy_rate?: number | null
          project_id?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "investment_data_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_data_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          budget: string | null
          country: string | null
          created_at: string
          email: string
          id: string
          interest: string | null
          message: string | null
          name: string
          phone: string
          project_slug: string | null
          source: string
          status: string
        }
        Insert: {
          budget?: string | null
          country?: string | null
          created_at?: string
          email: string
          id?: string
          interest?: string | null
          message?: string | null
          name: string
          phone: string
          project_slug?: string | null
          source?: string
          status?: string
        }
        Update: {
          budget?: string | null
          country?: string | null
          created_at?: string
          email?: string
          id?: string
          interest?: string | null
          message?: string | null
          name?: string
          phone?: string
          project_slug?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_project_slug_fkey"
            columns: ["project_slug"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["slug"]
          },
        ]
      }
      locations: {
        Row: {
          area_name: string
          beach_name: string | null
          created_at: string
          description: string | null
          family_score: number | null
          id: string
          investment_strength: number | null
          lifestyle_type: string | null
          notes: string | null
          rental_demand_score: number | null
          updated_at: string
        }
        Insert: {
          area_name: string
          beach_name?: string | null
          created_at?: string
          description?: string | null
          family_score?: number | null
          id?: string
          investment_strength?: number | null
          lifestyle_type?: string | null
          notes?: string | null
          rental_demand_score?: number | null
          updated_at?: string
        }
        Update: {
          area_name?: string
          beach_name?: string | null
          created_at?: string
          description?: string | null
          family_score?: number | null
          id?: string
          investment_strength?: number | null
          lifestyle_type?: string | null
          notes?: string | null
          rental_demand_score?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      nearby_places: {
        Row: {
          category: Database["public"]["Enums"]["place_category"]
          created_at: string
          distance_km: number | null
          drive_time_minutes: number | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          notes: string | null
          project_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category: Database["public"]["Enums"]["place_category"]
          created_at?: string
          distance_km?: number | null
          drive_time_minutes?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          notes?: string | null
          project_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["place_category"]
          created_at?: string
          distance_km?: number | null
          drive_time_minutes?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          notes?: string | null
          project_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nearby_places_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      price_updates: {
        Row: {
          created_at: string
          id: string
          new_price_thb: number | null
          old_price_thb: number | null
          project_id: string | null
          source_file_url: string | null
          unit_id: string | null
          update_reason: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          new_price_thb?: number | null
          old_price_thb?: number | null
          project_id?: string | null
          source_file_url?: string | null
          unit_id?: string | null
          update_reason?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          new_price_thb?: number | null
          old_price_thb?: number | null
          project_id?: string | null
          source_file_url?: string | null
          unit_id?: string | null
          update_reason?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_updates_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      project_amenities: {
        Row: {
          amenity_id: string
          created_at: string
          note: string | null
          project_id: string
        }
        Insert: {
          amenity_id: string
          created_at?: string
          note?: string | null
          project_id: string
        }
        Update: {
          amenity_id?: string
          created_at?: string
          note?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_amenities_amenity_id_fkey"
            columns: ["amenity_id"]
            isOneToOne: false
            referencedRelation: "amenities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_amenities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_media: {
        Row: {
          created_at: string
          id: string
          media_type: string
          project_id: string
          sort_order: number
          title: string | null
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          media_type: string
          project_id: string
          sort_order?: number
          title?: string | null
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          media_type?: string
          project_id?: string
          sort_order?: number
          title?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_media_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_seo: {
        Row: {
          canonical_url: string | null
          created_at: string
          description: string | null
          keywords: string[] | null
          og_image_url: string | null
          project_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          canonical_url?: string | null
          created_at?: string
          description?: string | null
          keywords?: string[] | null
          og_image_url?: string | null
          project_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          canonical_url?: string | null
          created_at?: string
          description?: string | null
          keywords?: string[] | null
          og_image_url?: string | null
          project_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_seo_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_status_history: {
        Row: {
          created_at: string
          effective_date: string
          id: string
          note: string | null
          project_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          effective_date?: string
          id?: string
          note?: string | null
          project_id: string
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          effective_date?: string
          id?: string
          note?: string | null
          project_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_status_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tags: {
        Row: {
          created_at: string
          project_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          project_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          project_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tags_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      project_translations: {
        Row: {
          created_at: string
          description: string | null
          highlights: string[] | null
          id: string
          investment_value: string | null
          locale: string
          market_position: string | null
          meta_description: string | null
          meta_keywords: string[] | null
          meta_title: string | null
          name: string | null
          project_id: string
          tagline: string | null
          trust_note: string | null
          updated_at: string
          verdict: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          highlights?: string[] | null
          id?: string
          investment_value?: string | null
          locale: string
          market_position?: string | null
          meta_description?: string | null
          meta_keywords?: string[] | null
          meta_title?: string | null
          name?: string | null
          project_id: string
          tagline?: string | null
          trust_note?: string | null
          updated_at?: string
          verdict?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          highlights?: string[] | null
          id?: string
          investment_value?: string | null
          locale?: string
          market_position?: string | null
          meta_description?: string | null
          meta_keywords?: string[] | null
          meta_title?: string | null
          name?: string | null
          project_id?: string
          tagline?: string | null
          trust_note?: string | null
          updated_at?: string
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_translations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          address: string | null
          area_range: string | null
          beds_display: string | null
          brochure_url: string | null
          capital_growth_estimate: string | null
          completion_date: string | null
          completion_date_display: string | null
          construction_status: string | null
          created_at: string
          developer_id: string | null
          distance_to_airport: string | null
          distance_to_beach: string | null
          distance_to_school: string | null
          facilities: string[] | null
          forever_verified: boolean
          full_description: string | null
          highlights: string[] | null
          id: string
          image_key: string | null
          investment_value: number | null
          is_active: boolean
          is_featured: boolean
          last_inspection: string | null
          last_price_update: string | null
          latitude: number | null
          lifestyle: string[] | null
          location_area: string | null
          longitude: number | null
          main_image_url: string | null
          market_position: string | null
          name: string
          nearby_hospitals: string[] | null
          nearby_schools: string[] | null
          ownership_type: string | null
          price_per_sqm_display: string | null
          price_range: string | null
          project_type: string | null
          promotion: string | null
          rental_demand: string | null
          rental_yield: string | null
          sales_status: string | null
          short_description: string | null
          slug: string
          start_date_display: string | null
          starting_price_thb: number | null
          tagline: string | null
          trust_note: string | null
          trust_score: number | null
          updated_at: string
          verdict: string | null
          verified_price: string | null
        }
        Insert: {
          address?: string | null
          area_range?: string | null
          beds_display?: string | null
          brochure_url?: string | null
          capital_growth_estimate?: string | null
          completion_date?: string | null
          completion_date_display?: string | null
          construction_status?: string | null
          created_at?: string
          developer_id?: string | null
          distance_to_airport?: string | null
          distance_to_beach?: string | null
          distance_to_school?: string | null
          facilities?: string[] | null
          forever_verified?: boolean
          full_description?: string | null
          highlights?: string[] | null
          id?: string
          image_key?: string | null
          investment_value?: number | null
          is_active?: boolean
          is_featured?: boolean
          last_inspection?: string | null
          last_price_update?: string | null
          latitude?: number | null
          lifestyle?: string[] | null
          location_area?: string | null
          longitude?: number | null
          main_image_url?: string | null
          market_position?: string | null
          name: string
          nearby_hospitals?: string[] | null
          nearby_schools?: string[] | null
          ownership_type?: string | null
          price_per_sqm_display?: string | null
          price_range?: string | null
          project_type?: string | null
          promotion?: string | null
          rental_demand?: string | null
          rental_yield?: string | null
          sales_status?: string | null
          short_description?: string | null
          slug: string
          start_date_display?: string | null
          starting_price_thb?: number | null
          tagline?: string | null
          trust_note?: string | null
          trust_score?: number | null
          updated_at?: string
          verdict?: string | null
          verified_price?: string | null
        }
        Update: {
          address?: string | null
          area_range?: string | null
          beds_display?: string | null
          brochure_url?: string | null
          capital_growth_estimate?: string | null
          completion_date?: string | null
          completion_date_display?: string | null
          construction_status?: string | null
          created_at?: string
          developer_id?: string | null
          distance_to_airport?: string | null
          distance_to_beach?: string | null
          distance_to_school?: string | null
          facilities?: string[] | null
          forever_verified?: boolean
          full_description?: string | null
          highlights?: string[] | null
          id?: string
          image_key?: string | null
          investment_value?: number | null
          is_active?: boolean
          is_featured?: boolean
          last_inspection?: string | null
          last_price_update?: string | null
          latitude?: number | null
          lifestyle?: string[] | null
          location_area?: string | null
          longitude?: number | null
          main_image_url?: string | null
          market_position?: string | null
          name?: string
          nearby_hospitals?: string[] | null
          nearby_schools?: string[] | null
          ownership_type?: string | null
          price_per_sqm_display?: string | null
          price_range?: string | null
          project_type?: string | null
          promotion?: string | null
          rental_demand?: string | null
          rental_yield?: string | null
          sales_status?: string | null
          short_description?: string | null
          slug?: string
          start_date_display?: string | null
          starting_price_thb?: number | null
          tagline?: string | null
          trust_note?: string | null
          trust_score?: number | null
          updated_at?: string
          verdict?: string | null
          verified_price?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "developers"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      units: {
        Row: {
          availability_status: string
          base_price_thb: number | null
          bathrooms: number | null
          bedrooms: number | null
          created_at: string
          discounted_price_thb: number | null
          floor: number | null
          furniture_package: string | null
          id: string
          notes: string | null
          ownership_type: string | null
          payment_plan: string | null
          price_per_sqm: number | null
          project_id: string
          rental_guarantee: string | null
          roi_estimate: string | null
          size_sqm: number | null
          unit_code: string | null
          unit_type: string | null
          updated_at: string
          view_type: string | null
        }
        Insert: {
          availability_status?: string
          base_price_thb?: number | null
          bathrooms?: number | null
          bedrooms?: number | null
          created_at?: string
          discounted_price_thb?: number | null
          floor?: number | null
          furniture_package?: string | null
          id?: string
          notes?: string | null
          ownership_type?: string | null
          payment_plan?: string | null
          price_per_sqm?: number | null
          project_id: string
          rental_guarantee?: string | null
          roi_estimate?: string | null
          size_sqm?: number | null
          unit_code?: string | null
          unit_type?: string | null
          updated_at?: string
          view_type?: string | null
        }
        Update: {
          availability_status?: string
          base_price_thb?: number | null
          bathrooms?: number | null
          bedrooms?: number | null
          created_at?: string
          discounted_price_thb?: number | null
          floor?: number | null
          furniture_package?: string | null
          id?: string
          notes?: string | null
          ownership_type?: string | null
          payment_plan?: string | null
          price_per_sqm?: number | null
          project_id?: string
          rental_guarantee?: string | null
          roi_estimate?: string | null
          size_sqm?: number | null
          unit_code?: string | null
          unit_type?: string | null
          updated_at?: string
          view_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      place_category:
        | "school"
        | "beach"
        | "hospital"
        | "mall"
        | "airport"
        | "restaurant"
        | "park"
        | "transport"
        | "other"
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
      place_category: [
        "school",
        "beach",
        "hospital",
        "mall",
        "airport",
        "restaurant",
        "park",
        "transport",
        "other",
      ],
    },
  },
} as const
