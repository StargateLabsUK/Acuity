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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      herald_reports: {
        Row: {
          assessment: Json | null
          can_transport: boolean | null
          confirmed_at: string | null
          created_at: string | null
          critical_care: boolean | null
          device_id: string | null
          diff: Json | null
          edited: boolean | null
          final_assessment: Json | null
          headline: string | null
          id: string
          incident_number: string | null
          lat: number | null
          latest_transmission_at: string | null
          lng: number | null
          location_accuracy: number | null
          operator_id: string | null
          original_assessment: Json | null
          priority: string | null
          service: string | null
          session_callsign: string | null
          session_operator_id: string | null
          session_service: string | null
          session_station: string | null
          shift_id: string | null
          status: string
          synced: boolean | null
          timestamp: string
          transcript: string | null
          transmission_count: number | null
          user_id: string | null
          vehicle_type: string | null
        }
        Insert: {
          assessment?: Json | null
          can_transport?: boolean | null
          confirmed_at?: string | null
          created_at?: string | null
          critical_care?: boolean | null
          device_id?: string | null
          diff?: Json | null
          edited?: boolean | null
          final_assessment?: Json | null
          headline?: string | null
          id?: string
          incident_number?: string | null
          lat?: number | null
          latest_transmission_at?: string | null
          lng?: number | null
          location_accuracy?: number | null
          operator_id?: string | null
          original_assessment?: Json | null
          priority?: string | null
          service?: string | null
          session_callsign?: string | null
          session_operator_id?: string | null
          session_service?: string | null
          session_station?: string | null
          shift_id?: string | null
          status?: string
          synced?: boolean | null
          timestamp: string
          transcript?: string | null
          transmission_count?: number | null
          user_id?: string | null
          vehicle_type?: string | null
        }
        Update: {
          assessment?: Json | null
          can_transport?: boolean | null
          confirmed_at?: string | null
          created_at?: string | null
          critical_care?: boolean | null
          device_id?: string | null
          diff?: Json | null
          edited?: boolean | null
          final_assessment?: Json | null
          headline?: string | null
          id?: string
          incident_number?: string | null
          lat?: number | null
          latest_transmission_at?: string | null
          lng?: number | null
          location_accuracy?: number | null
          operator_id?: string | null
          original_assessment?: Json | null
          priority?: string | null
          service?: string | null
          session_callsign?: string | null
          session_operator_id?: string | null
          session_service?: string | null
          session_station?: string | null
          shift_id?: string | null
          status?: string
          synced?: boolean | null
          timestamp?: string
          transcript?: string | null
          transmission_count?: number | null
          user_id?: string | null
          vehicle_type?: string | null
        }
        Relationships: []
      }
      incident_log: {
        Row: {
          ai_provider_latency_ms: number | null
          ai_provider_status: string
          checked_at: string
          created_at: string | null
          database_latency_ms: number | null
          database_status: string
          error_message: string | null
          id: string
          status: string
        }
        Insert: {
          ai_provider_latency_ms?: number | null
          ai_provider_status?: string
          checked_at?: string
          created_at?: string | null
          database_latency_ms?: number | null
          database_status?: string
          error_message?: string | null
          id?: string
          status?: string
        }
        Update: {
          ai_provider_latency_ms?: number | null
          ai_provider_status?: string
          checked_at?: string
          created_at?: string | null
          database_latency_ms?: number | null
          database_status?: string
          error_message?: string | null
          id?: string
          status?: string
        }
        Relationships: []
      }
      incident_transmissions: {
        Row: {
          assessment: Json | null
          created_at: string | null
          headline: string | null
          id: string
          operator_id: string | null
          priority: string | null
          report_id: string | null
          session_callsign: string | null
          timestamp: string
          transcript: string | null
        }
        Insert: {
          assessment?: Json | null
          created_at?: string | null
          headline?: string | null
          id?: string
          operator_id?: string | null
          priority?: string | null
          report_id?: string | null
          session_callsign?: string | null
          timestamp: string
          transcript?: string | null
        }
        Update: {
          assessment?: Json | null
          created_at?: string | null
          headline?: string | null
          id?: string
          operator_id?: string | null
          priority?: string | null
          report_id?: string | null
          session_callsign?: string | null
          timestamp?: string
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_transmissions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "herald_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          callsign: string | null
          can_transport: boolean | null
          created_at: string | null
          critical_care: boolean | null
          device_id: string | null
          ended_at: string | null
          id: string
          operator_id: string | null
          service: string | null
          started_at: string | null
          station: string | null
          vehicle_type: string | null
        }
        Insert: {
          callsign?: string | null
          can_transport?: boolean | null
          created_at?: string | null
          critical_care?: boolean | null
          device_id?: string | null
          ended_at?: string | null
          id?: string
          operator_id?: string | null
          service?: string | null
          started_at?: string | null
          station?: string | null
          vehicle_type?: string | null
        }
        Update: {
          callsign?: string | null
          can_transport?: boolean | null
          created_at?: string | null
          critical_care?: boolean | null
          device_id?: string | null
          ended_at?: string | null
          id?: string
          operator_id?: string | null
          service?: string | null
          started_at?: string | null
          station?: string | null
          vehicle_type?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string | null
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id?: string | null
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role: "admin" | "command" | "field"
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
      app_role: ["admin", "command", "field"],
    },
  },
} as const
