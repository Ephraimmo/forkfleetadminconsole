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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after_value: Json | null
          before_value: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          is_active: boolean
          is_deleted: boolean
          updated_at: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          is_active?: boolean
          is_deleted?: boolean
          updated_at?: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          is_active?: boolean
          is_deleted?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          city: string
          created_at: string
          created_by: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean
          is_blocked: boolean
          is_deleted: boolean
          loyalty_points: number
          phone: string | null
          updated_at: string
          updated_by: string | null
          user_id: string | null
          wallet_balance: number
        }
        Insert: {
          city?: string
          created_at?: string
          created_by?: string | null
          email: string
          full_name: string
          id?: string
          is_active?: boolean
          is_blocked?: boolean
          is_deleted?: boolean
          loyalty_points?: number
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          wallet_balance?: number
        }
        Update: {
          city?: string
          created_at?: string
          created_by?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          is_blocked?: boolean
          is_deleted?: boolean
          loyalty_points?: number
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          wallet_balance?: number
        }
        Relationships: []
      }
      delivery_zones: {
        Row: {
          base_fee: number
          branch_id: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          min_order: number
          name: string
          postal_codes: string[]
          radius_km: number
          restaurant_id: string
          surcharge: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          base_fee?: number
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          min_order?: number
          name: string
          postal_codes?: string[]
          radius_km?: number
          restaurant_id: string
          surcharge?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          base_fee?: number
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          min_order?: number
          name?: string
          postal_codes?: string[]
          radius_km?: number
          restaurant_id?: string
          surcharge?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_zones_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "restaurant_branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_zones_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          city: string
          created_at: string
          created_by: string | null
          current_latitude: number | null
          current_longitude: number | null
          email: string
          full_name: string
          id: string
          is_active: boolean
          is_deleted: boolean
          is_verified: boolean
          license_number: string | null
          phone: string | null
          rating: number
          status: Database["public"]["Enums"]["driver_status"]
          total_deliveries: number
          updated_at: string
          updated_by: string | null
          user_id: string | null
          vehicle_plate: string | null
          vehicle_type: string
          wallet_balance: number
        }
        Insert: {
          city?: string
          created_at?: string
          created_by?: string | null
          current_latitude?: number | null
          current_longitude?: number | null
          email: string
          full_name: string
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          is_verified?: boolean
          license_number?: string | null
          phone?: string | null
          rating?: number
          status?: Database["public"]["Enums"]["driver_status"]
          total_deliveries?: number
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          vehicle_plate?: string | null
          vehicle_type?: string
          wallet_balance?: number
        }
        Update: {
          city?: string
          created_at?: string
          created_by?: string | null
          current_latitude?: number | null
          current_longitude?: number | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          is_verified?: boolean
          license_number?: string | null
          phone?: string | null
          rating?: number
          status?: Database["public"]["Enums"]["driver_status"]
          total_deliveries?: number
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          vehicle_plate?: string | null
          vehicle_type?: string
          wallet_balance?: number
        }
        Relationships: []
      }
      menu_categories: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_available: boolean
          is_deleted: boolean
          name: string
          restaurant_id: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_available?: boolean
          is_deleted?: boolean
          name: string
          restaurant_id: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_available?: boolean
          is_deleted?: boolean
          name?: string
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_addons: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_available: boolean
          is_deleted: boolean
          max_quantity: number
          menu_item_id: string
          name: string
          price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_available?: boolean
          is_deleted?: boolean
          max_quantity?: number
          menu_item_id: string
          name: string
          price?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_available?: boolean
          is_deleted?: boolean
          max_quantity?: number
          menu_item_id?: string
          name?: string
          price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_addons_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_variants: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_available: boolean
          is_default: boolean
          is_deleted: boolean
          menu_item_id: string
          name: string
          price_delta: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_available?: boolean
          is_default?: boolean
          is_deleted?: boolean
          menu_item_id: string
          name: string
          price_delta?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_available?: boolean
          is_default?: boolean
          is_deleted?: boolean
          menu_item_id?: string
          name?: string
          price_delta?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_variants_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          allergens: string[]
          category: string
          category_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          discount_price: number | null
          id: string
          image_url: string | null
          is_active: boolean
          is_available: boolean
          is_deleted: boolean
          is_featured: boolean
          name: string
          prep_time_minutes: number
          price: number
          restaurant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allergens?: string[]
          category: string
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_price?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_available?: boolean
          is_deleted?: boolean
          is_featured?: boolean
          name: string
          prep_time_minutes?: number
          price: number
          restaurant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allergens?: string[]
          category?: string
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_price?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_available?: boolean
          is_deleted?: boolean
          is_featured?: boolean
          name?: string
          prep_time_minutes?: number
          price?: number
          restaurant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          item_name: string
          line_total: number
          menu_item_id: string | null
          notes: string | null
          order_id: string
          quantity: number
          unit_price: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          item_name: string
          line_total: number
          menu_item_id?: string | null
          notes?: string | null
          order_id: string
          quantity?: number
          unit_price: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          item_name?: string
          line_total?: number
          menu_item_id?: string | null
          notes?: string | null
          order_id?: string
          quantity?: number
          unit_price?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancelled_at: string | null
          commission: number
          created_at: string
          created_by: string | null
          customer_id: string
          delivered_at: string | null
          delivery_address: string | null
          delivery_fee: number
          discount: number
          driver_id: string | null
          eta_minutes: number | null
          id: string
          is_active: boolean
          is_deleted: boolean
          order_number: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          placed_at: string
          restaurant_id: string
          special_instructions: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          tax: number
          total: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cancelled_at?: string | null
          commission?: number
          created_at?: string
          created_by?: string | null
          customer_id: string
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_fee?: number
          discount?: number
          driver_id?: string | null
          eta_minutes?: number | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          order_number?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          placed_at?: string
          restaurant_id: string
          special_instructions?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cancelled_at?: string | null
          commission?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_fee?: number
          discount?: number
          driver_id?: string | null
          eta_minutes?: number | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          order_number?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          placed_at?: string
          restaurant_id?: string
          special_instructions?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          code: string
          created_at: string
          description: string
          id: string
          is_active: boolean
          is_deleted: boolean
          module: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description: string
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          module: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          module?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          created_by: string | null
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          job_title: string | null
          last_login_at: string | null
          phone: string | null
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          job_title?: string | null
          last_login_at?: string | null
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          job_title?: string | null
          last_login_at?: string | null
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      restaurant_branches: {
        Row: {
          address: string | null
          city: string
          code: string | null
          created_at: string
          created_by: string | null
          delivery_radius_km: number
          id: string
          is_active: boolean
          is_deleted: boolean
          latitude: number | null
          longitude: number | null
          name: string
          phone: string | null
          restaurant_id: string
          status: Database["public"]["Enums"]["restaurant_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          city?: string
          code?: string | null
          created_at?: string
          created_by?: string | null
          delivery_radius_km?: number
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          latitude?: number | null
          longitude?: number | null
          name: string
          phone?: string | null
          restaurant_id: string
          status?: Database["public"]["Enums"]["restaurant_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          city?: string
          code?: string | null
          created_at?: string
          created_by?: string | null
          delivery_radius_km?: number
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          phone?: string | null
          restaurant_id?: string
          status?: Database["public"]["Enums"]["restaurant_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_branches_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_hours: {
        Row: {
          closes_at: string
          created_at: string
          day_of_week: number
          id: string
          is_active: boolean
          is_closed: boolean
          is_deleted: boolean
          opens_at: string
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          closes_at?: string
          created_at?: string
          day_of_week: number
          id?: string
          is_active?: boolean
          is_closed?: boolean
          is_deleted?: boolean
          opens_at?: string
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          closes_at?: string
          created_at?: string
          day_of_week?: number
          id?: string
          is_active?: boolean
          is_closed?: boolean
          is_deleted?: boolean
          opens_at?: string
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_hours_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_staff: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          restaurant_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          restaurant_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          restaurant_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_staff_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          address: string | null
          city: string
          closes_at: string
          commission_rate: number
          country: string
          created_at: string
          created_by: string | null
          cuisine: string
          currency: string
          delivery_radius_km: number
          email: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          name: string
          opens_at: string
          phone: string | null
          prep_time_minutes: number
          rating: number
          rating_count: number
          slug: string
          status: Database["public"]["Enums"]["restaurant_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          city?: string
          closes_at?: string
          commission_rate?: number
          country?: string
          created_at?: string
          created_by?: string | null
          cuisine: string
          currency?: string
          delivery_radius_km?: number
          email?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          name: string
          opens_at?: string
          phone?: string | null
          prep_time_minutes?: number
          rating?: number
          rating_count?: number
          slug: string
          status?: Database["public"]["Enums"]["restaurant_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          city?: string
          closes_at?: string
          commission_rate?: number
          country?: string
          created_at?: string
          created_by?: string | null
          cuisine?: string
          currency?: string
          delivery_radius_km?: number
          email?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          name?: string
          opens_at?: string
          phone?: string | null
          prep_time_minutes?: number
          rating?: number
          rating_count?: number
          slug?: string
          status?: Database["public"]["Enums"]["restaurant_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          permission_code: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          permission_code: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          permission_code?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
        ]
      }
      staff_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          is_active: boolean
          is_deleted: boolean
          message: string | null
          restaurant_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          is_active?: boolean
          is_deleted?: boolean
          message?: string | null
          restaurant_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          is_active?: boolean
          is_deleted?: boolean
          message?: string | null
          restaurant_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_invitations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_delivery_status: {
        Args: {
          _eta_minutes?: number
          _next: Database["public"]["Enums"]["order_status"]
          _order_id: string
        }
        Returns: {
          cancelled_at: string | null
          commission: number
          created_at: string
          created_by: string | null
          customer_id: string
          delivered_at: string | null
          delivery_address: string | null
          delivery_fee: number
          discount: number
          driver_id: string | null
          eta_minutes: number | null
          id: string
          is_active: boolean
          is_deleted: boolean
          order_number: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          placed_at: string
          restaurant_id: string
          special_instructions: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          tax: number
          total: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      advance_order_status: {
        Args: {
          _next: Database["public"]["Enums"]["order_status"]
          _order_id: string
        }
        Returns: {
          cancelled_at: string | null
          commission: number
          created_at: string
          created_by: string | null
          customer_id: string
          delivered_at: string | null
          delivery_address: string | null
          delivery_fee: number
          discount: number
          driver_id: string | null
          eta_minutes: number | null
          id: string
          is_active: boolean
          is_deleted: boolean
          order_number: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          placed_at: string
          restaurant_id: string
          special_instructions: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          tax: number
          total: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_order_driver: {
        Args: { _driver_id: string; _eta_minutes?: number; _order_id: string }
        Returns: {
          cancelled_at: string | null
          commission: number
          created_at: string
          created_by: string | null
          customer_id: string
          delivered_at: string | null
          delivery_address: string | null
          delivery_fee: number
          discount: number
          driver_id: string | null
          eta_minutes: number | null
          id: string
          is_active: boolean
          is_deleted: boolean
          order_number: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          placed_at: string
          restaurant_id: string
          special_instructions: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          tax: number
          total: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      best_customers: {
        Args: { _limit?: number }
        Returns: {
          email: string
          full_name: string
          id: string
          orders: number
          spend: number
        }[]
      }
      bootstrap_super_admin: { Args: never; Returns: boolean }
      dashboard_metrics: { Args: never; Returns: Json }
      driver_performance: {
        Args: { _limit?: number }
        Returns: {
          deliveries: number
          earnings: number
          full_name: string
          id: string
          rating: number
          status: Database["public"]["Enums"]["driver_status"]
        }[]
      }
      has_permission: {
        Args: { _code: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      manages_restaurant: {
        Args: { _restaurant_id: string; _user_id: string }
        Returns: boolean
      }
      revenue_trend: {
        Args: { _days?: number }
        Returns: {
          day: string
          orders: number
          revenue: number
        }[]
      }
      set_driver_status: {
        Args: {
          _driver_id: string
          _next: Database["public"]["Enums"]["driver_status"]
        }
        Returns: {
          city: string
          created_at: string
          created_by: string | null
          current_latitude: number | null
          current_longitude: number | null
          email: string
          full_name: string
          id: string
          is_active: boolean
          is_deleted: boolean
          is_verified: boolean
          license_number: string | null
          phone: string | null
          rating: number
          status: Database["public"]["Enums"]["driver_status"]
          total_deliveries: number
          updated_at: string
          updated_by: string | null
          user_id: string | null
          vehicle_plate: string | null
          vehicle_type: string
          wallet_balance: number
        }
        SetofOptions: {
          from: "*"
          to: "drivers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      top_menu_items: {
        Args: { _limit?: number }
        Returns: {
          name: string
          revenue: number
          units: number
        }[]
      }
      top_restaurants: {
        Args: { _limit?: number }
        Returns: {
          cuisine: string
          id: string
          name: string
          orders: number
          rating: number
          revenue: number
        }[]
      }
      works_at_restaurant: {
        Args: { _restaurant_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "platform_admin"
        | "restaurant_owner"
        | "restaurant_manager"
        | "kitchen_manager"
        | "kitchen_staff"
        | "cashier"
        | "dispatcher"
        | "finance_manager"
        | "customer_support"
        | "marketing_manager"
        | "inventory_manager"
        | "branch_manager"
        | "operations_manager"
        | "auditor"
      driver_status: "offline" | "online" | "busy" | "suspended" | "pending"
      order_status:
        | "pending"
        | "accepted"
        | "preparing"
        | "ready"
        | "assigned"
        | "picked_up"
        | "on_the_way"
        | "delivered"
        | "cancelled"
        | "refunded"
      payment_method: "cash" | "card" | "wallet" | "online"
      restaurant_status: "pending" | "approved" | "suspended" | "rejected"
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
      app_role: [
        "super_admin",
        "platform_admin",
        "restaurant_owner",
        "restaurant_manager",
        "kitchen_manager",
        "kitchen_staff",
        "cashier",
        "dispatcher",
        "finance_manager",
        "customer_support",
        "marketing_manager",
        "inventory_manager",
        "branch_manager",
        "operations_manager",
        "auditor",
      ],
      driver_status: ["offline", "online", "busy", "suspended", "pending"],
      order_status: [
        "pending",
        "accepted",
        "preparing",
        "ready",
        "assigned",
        "picked_up",
        "on_the_way",
        "delivered",
        "cancelled",
        "refunded",
      ],
      payment_method: ["cash", "card", "wallet", "online"],
      restaurant_status: ["pending", "approved", "suspended", "rejected"],
    },
  },
} as const
