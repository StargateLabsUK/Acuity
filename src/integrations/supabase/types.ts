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
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          trust_id: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          trust_id?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          trust_id?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_trust_id_fkey"
            columns: ["trust_id"]
            isOneToOne: false
            referencedRelation: "trusts"
            referencedColumns: ["id"]
          },
        ]
      }
      casualty_dispositions: {
        Row: {
          casualty_key: string
          casualty_label: string
          closed_at: string
          created_at: string | null
          disposition: string
          fields: Json | null
          id: string
          incident_number: string | null
          priority: string
          report_id: string
          session_callsign: string | null
          trust_id: string | null
        }
        Insert: {
          casualty_key: string
          casualty_label: string
          closed_at: string
          created_at?: string | null
          disposition: string
          fields?: Json | null
          id?: string
          incident_number?: string | null
          priority: string
          report_id: string
          session_callsign?: string | null
          trust_id?: string | null
        }
        Update: {
          casualty_key?: string
          casualty_label?: string
          closed_at?: string
          created_at?: string | null
          disposition?: string
          fields?: Json | null
          id?: string
          incident_number?: string | null
          priority?: string
          report_id?: string
          session_callsign?: string | null
          trust_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "casualty_dispositions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "herald_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "casualty_dispositions_trust_id_fkey"
            columns: ["trust_id"]
            isOneToOne: false
            referencedRelation: "trusts"
            referencedColumns: ["id"]
          },
        ]
      }
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
          receiving_hospital: string | null
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
          trust_id: string | null
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
          receiving_hospital?: string | null
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
          trust_id?: string | null
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
          receiving_hospital?: string | null
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
          trust_id?: string | null
          user_id?: string | null
          vehicle_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "herald_reports_trust_id_fkey"
            columns: ["trust_id"]
            isOneToOne: false
            referencedRelation: "trusts"
            referencedColumns: ["id"]
          },
        ]
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
          trust_id: string | null
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
          trust_id?: string | null
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
          trust_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_transmissions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "herald_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_transmissions_trust_id_fkey"
            columns: ["trust_id"]
            isOneToOne: false
            referencedRelation: "trusts"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_transfers: {
        Row: {
          accepted_at: string | null
          casualty_key: string
          casualty_label: string
          clinical_snapshot: Json
          created_at: string | null
          declined_at: string | null
          declined_reason: string | null
          from_callsign: string
          from_operator_id: string | null
          from_shift_id: string | null
          handover_notes: string | null
          id: string
          initiated_at: string
          priority: string
          report_id: string
          status: string
          to_callsign: string
          to_shift_id: string | null
          trust_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          casualty_key: string
          casualty_label: string
          clinical_snapshot?: Json
          created_at?: string | null
          declined_at?: string | null
          declined_reason?: string | null
          from_callsign: string
          from_operator_id?: string | null
          from_shift_id?: string | null
          handover_notes?: string | null
          id?: string
          initiated_at?: string
          priority: string
          report_id: string
          status?: string
          to_callsign: string
          to_shift_id?: string | null
          trust_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          casualty_key?: string
          casualty_label?: string
          clinical_snapshot?: Json
          created_at?: string | null
          declined_at?: string | null
          declined_reason?: string | null
          from_callsign?: string
          from_operator_id?: string | null
          from_shift_id?: string | null
          handover_notes?: string | null
          id?: string
          initiated_at?: string
          priority?: string
          report_id?: string
          status?: string
          to_callsign?: string
          to_shift_id?: string | null
          trust_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_transfers_from_shift_id_fkey"
            columns: ["from_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_transfers_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "herald_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_transfers_to_shift_id_fkey"
            columns: ["to_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_transfers_trust_id_fkey"
            columns: ["trust_id"]
            isOneToOne: false
            referencedRelation: "trusts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          failed_login_attempts: number
          full_name: string | null
          id: string
          locked: boolean
          locked_until: string | null
          trust_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          failed_login_attempts?: number
          full_name?: string | null
          id: string
          locked?: boolean
          locked_until?: string | null
          trust_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          failed_login_attempts?: number
          full_name?: string | null
          id?: string
          locked?: boolean
          locked_until?: string | null
          trust_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_trust_id_fkey"
            columns: ["trust_id"]
            isOneToOne: false
            referencedRelation: "trusts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_link_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          id: string
          left_at: string | null
          operator_id: string | null
          session_data: Json
          shift_id: string
          trust_id: string | null
          used_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          id?: string
          left_at?: string | null
          operator_id?: string | null
          session_data?: Json
          shift_id: string
          trust_id?: string | null
          used_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          left_at?: string | null
          operator_id?: string | null
          session_data?: Json
          shift_id?: string
          trust_id?: string | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_link_codes_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_link_codes_trust_id_fkey"
            columns: ["trust_id"]
            isOneToOne: false
            referencedRelation: "trusts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          active_report_id: string | null
          callsign: string | null
          can_transport: boolean | null
          crew_status: string
          created_at: string | null
          critical_care: boolean | null
          device_id: string | null
          ended_at: string | null
          id: string
          operator_id: string | null
          service: string | null
          started_at: string | null
          station: string | null
          trust_id: string | null
          vehicle_type: string | null
        }
        Insert: {
          active_report_id?: string | null
          callsign?: string | null
          can_transport?: boolean | null
          crew_status?: string
          created_at?: string | null
          critical_care?: boolean | null
          device_id?: string | null
          ended_at?: string | null
          id?: string
          operator_id?: string | null
          service?: string | null
          started_at?: string | null
          station?: string | null
          trust_id?: string | null
          vehicle_type?: string | null
        }
        Update: {
          active_report_id?: string | null
          callsign?: string | null
          can_transport?: boolean | null
          crew_status?: string
          created_at?: string | null
          critical_care?: boolean | null
          device_id?: string | null
          ended_at?: string | null
          id?: string
          operator_id?: string | null
          service?: string | null
          started_at?: string | null
          station?: string | null
          trust_id?: string | null
          vehicle_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_active_report_id_fkey"
            columns: ["active_report_id"]
            isOneToOne: false
            referencedRelation: "herald_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_trust_id_fkey"
            columns: ["trust_id"]
            isOneToOne: false
            referencedRelation: "trusts"
            referencedColumns: ["id"]
          },
        ]
      }
      trusts: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          retention_days: number
          slug: string
          trust_pin_hash: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          retention_days?: number
          slug: string
          trust_pin_hash: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          retention_days?: number
          slug?: string
          trust_pin_hash?: string
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      purge_expired_data: { Args: never; Returns: Json }
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
