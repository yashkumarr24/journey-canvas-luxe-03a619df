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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      destinations: {
        Row: {
          country: string
          created_at: string
          hero_image_url: string | null
          id: string
          is_published: boolean
          name: string
          region: string
          slug: string
          sort_order: number
          state_or_area: string | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          country: string
          created_at?: string
          hero_image_url?: string | null
          id?: string
          is_published?: boolean
          name: string
          region: string
          slug: string
          sort_order?: number
          state_or_area?: string | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          country?: string
          created_at?: string
          hero_image_url?: string | null
          id?: string
          is_published?: boolean
          name?: string
          region?: string
          slug?: string
          sort_order?: number
          state_or_area?: string | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      package_departures: {
        Row: {
          departure_date: string
          id: string
          package_id: string
          price_override: number | null
          seats_note: string | null
        }
        Insert: {
          departure_date: string
          id?: string
          package_id: string
          price_override?: number | null
          seats_note?: string | null
        }
        Update: {
          departure_date?: string
          id?: string
          package_id?: string
          price_override?: number | null
          seats_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "package_departures_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_enquiries: {
        Row: {
          adults: number
          children: number
          created_at: string
          email: string | null
          id: string
          message: string | null
          name: string
          option_id: string | null
          package_id: string
          phone: string | null
          source: string
          status: string
          travel_month: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          adults?: number
          children?: number
          created_at?: string
          email?: string | null
          id?: string
          message?: string | null
          name: string
          option_id?: string | null
          package_id: string
          phone?: string | null
          source?: string
          status?: string
          travel_month?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          adults?: number
          children?: number
          created_at?: string
          email?: string | null
          id?: string
          message?: string | null
          name?: string
          option_id?: string | null
          package_id?: string
          phone?: string | null
          source?: string
          status?: string
          travel_month?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "package_enquiries_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "package_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_enquiries_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_flights: {
        Row: {
          airline: string | null
          arrive_time: string | null
          depart_time: string | null
          flight_no: string | null
          id: string
          is_included: boolean
          notes: string | null
          option_id: string | null
          package_id: string
          sector: string | null
          sort_order: number
        }
        Insert: {
          airline?: string | null
          arrive_time?: string | null
          depart_time?: string | null
          flight_no?: string | null
          id?: string
          is_included?: boolean
          notes?: string | null
          option_id?: string | null
          package_id: string
          sector?: string | null
          sort_order?: number
        }
        Update: {
          airline?: string | null
          arrive_time?: string | null
          depart_time?: string | null
          flight_no?: string | null
          id?: string
          is_included?: boolean
          notes?: string | null
          option_id?: string | null
          package_id?: string
          sector?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "package_flights_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "package_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_flights_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_images: {
        Row: {
          alt: string | null
          id: string
          is_cover: boolean
          package_id: string
          sort_order: number
          url: string
        }
        Insert: {
          alt?: string | null
          id?: string
          is_cover?: boolean
          package_id: string
          sort_order?: number
          url: string
        }
        Update: {
          alt?: string | null
          id?: string
          is_cover?: boolean
          package_id?: string
          sort_order?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_images_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_inclusions: {
        Row: {
          id: string
          kind: string
          package_id: string
          sort_order: number
          text: string
        }
        Insert: {
          id?: string
          kind: string
          package_id: string
          sort_order?: number
          text: string
        }
        Update: {
          id?: string
          kind?: string
          package_id?: string
          sort_order?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_inclusions_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_itinerary_days: {
        Row: {
          day_number: number
          description: string | null
          id: string
          meals: string[]
          overnight_city: string | null
          package_id: string
          title: string
        }
        Insert: {
          day_number: number
          description?: string | null
          id?: string
          meals?: string[]
          overnight_city?: string | null
          package_id: string
          title: string
        }
        Update: {
          day_number?: number
          description?: string | null
          id?: string
          meals?: string[]
          overnight_city?: string | null
          package_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_itinerary_days_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_notes: {
        Row: {
          id: string
          kind: string
          package_id: string
          sort_order: number
          text: string
        }
        Insert: {
          id?: string
          kind: string
          package_id: string
          sort_order?: number
          text: string
        }
        Update: {
          id?: string
          kind?: string
          package_id?: string
          sort_order?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_notes_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_option_hotels: {
        Row: {
          city: string | null
          hotel_name: string
          id: string
          is_similar: boolean
          meal_plan: string | null
          nights: number | null
          option_id: string
          room_type: string | null
          sort_order: number
          star_rating: number | null
        }
        Insert: {
          city?: string | null
          hotel_name: string
          id?: string
          is_similar?: boolean
          meal_plan?: string | null
          nights?: number | null
          option_id: string
          room_type?: string | null
          sort_order?: number
          star_rating?: number | null
        }
        Update: {
          city?: string | null
          hotel_name?: string
          id?: string
          is_similar?: boolean
          meal_plan?: string | null
          nights?: number | null
          option_id?: string
          room_type?: string | null
          sort_order?: number
          star_rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "package_option_hotels_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "package_options"
            referencedColumns: ["id"]
          },
        ]
      }
      package_options: {
        Row: {
          child_price_notes: string | null
          created_at: string
          currency: string
          id: string
          indicative_price: number | null
          notes: string | null
          option_name: string
          package_id: string
          price_basis: string | null
          single_supplement: number | null
          sort_order: number
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          child_price_notes?: string | null
          created_at?: string
          currency?: string
          id?: string
          indicative_price?: number | null
          notes?: string | null
          option_name: string
          package_id: string
          price_basis?: string | null
          single_supplement?: number | null
          sort_order?: number
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          child_price_notes?: string | null
          created_at?: string
          currency?: string
          id?: string
          indicative_price?: number | null
          notes?: string | null
          option_name?: string
          package_id?: string
          price_basis?: string | null
          single_supplement?: number | null
          sort_order?: number
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "package_options_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_sources: {
        Row: {
          created_at: string
          file_checksum: string
          id: string
          original_filename: string
          parse_status: string
          parse_warnings: Json
          parsed_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          file_checksum: string
          id?: string
          original_filename: string
          parse_status?: string
          parse_warnings?: Json
          parsed_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          file_checksum?: string
          id?: string
          original_filename?: string
          parse_status?: string
          parse_warnings?: Json
          parsed_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      packages: {
        Row: {
          created_at: string
          currency: string
          departure_city: string | null
          destination_id: string
          duration_days: number | null
          duration_nights: number | null
          highlights: string[]
          id: string
          indicative_price_from: number | null
          is_published: boolean
          meal_plan: string | null
          name: string
          overview: string | null
          package_code: string | null
          price_basis: string | null
          slug: string
          source_id: string | null
          travel_validity_from: string | null
          travel_validity_to: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          departure_city?: string | null
          destination_id: string
          duration_days?: number | null
          duration_nights?: number | null
          highlights?: string[]
          id?: string
          indicative_price_from?: number | null
          is_published?: boolean
          meal_plan?: string | null
          name: string
          overview?: string | null
          package_code?: string | null
          price_basis?: string | null
          slug: string
          source_id?: string | null
          travel_validity_from?: string | null
          travel_validity_to?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          departure_city?: string | null
          destination_id?: string
          duration_days?: number | null
          duration_nights?: number | null
          highlights?: string[]
          id?: string
          indicative_price_from?: number | null
          is_published?: boolean
          meal_plan?: string | null
          name?: string
          overview?: string | null
          package_code?: string | null
          price_basis?: string | null
          slug?: string
          source_id?: string | null
          travel_validity_from?: string | null
          travel_validity_to?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packages_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "package_sources"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_package_published: { Args: { p_package_id: string }; Returns: boolean }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
