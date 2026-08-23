import { useEffect, useState } from "react";
import { isFirebaseAvailable } from "@/lib/firebase";
import {
  subscribeFirebaseDrivers,
  type DriverStatus,
  type FirebaseDriver,
} from "@/lib/drivers.firebase";
import { drivers as demoDrivers } from "@/lib/demo-store";

export interface DriverRow {
  id: string;
  full_name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  vehicle_type: string | null;
  vehicle_plate: string | null;
  license_number: string | null;
  id_number: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  preferred_language: string | null;
  verification_submitted_at: string | null;
  rejection_reason: string | null;
  status: DriverStatus | string;
  is_verified: boolean;
  is_active: boolean;
  rating: number;
  total_deliveries: number;
  wallet_balance: number;
  created_at: string | null;
  updated_at: string | null;
  last_online_at: string | null;
  last_offline_at: string | null;
  source: "firebase" | "demo";
}

/** Legacy demo rows — shown only when Firebase is unavailable (e.g. sandbox/SSR). */
function fromDemo(): DriverRow[] {
  return demoDrivers.map((d) => ({
    id: d.id,
    full_name: d.full_name,
    username: null,
    email: d.email,
    phone: d.phone,
    city: d.city,
    vehicle_type: d.vehicle_type,
    vehicle_plate: d.vehicle_plate,
    license_number: null,
    id_number: null,
    bank_name: null,
    bank_account_number: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    preferred_language: null,
    verification_submitted_at: null,
    rejection_reason: null,
    status: d.status,
    is_verified: d.is_verified,
    is_active: !["pending", "suspended", "rejected"].includes(d.status),
    rating: d.rating,
    total_deliveries: d.total_deliveries,
    wallet_balance: d.wallet_balance,
    created_at: null,
    updated_at: d.updated_at,
    last_online_at: null,
    last_offline_at: null,
    source: "demo",
  }));
}

function fromFirebase(list: FirebaseDriver[]): DriverRow[] {
  return list.map((d) => ({
    id: d.id,
    full_name: d.full_name ?? d.username ?? d.id,
    username: d.username ?? null,
    email: d.email ?? null,
    phone: d.phone ?? null,
    city: d.city ?? null,
    vehicle_type: d.vehicle_type ?? null,
    vehicle_plate: d.vehicle_plate ?? null,
    license_number: d.license_number ?? null,
    id_number: d.id_number ?? null,
    bank_name: d.bank_name ?? null,
    bank_account_number: d.bank_account_number ?? null,
    emergency_contact_name: d.emergency_contact_name ?? null,
    emergency_contact_phone: d.emergency_contact_phone ?? null,
    preferred_language: d.preferred_language ?? null,
    verification_submitted_at: d.verification_submitted_at ?? null,
    rejection_reason: d.rejection_reason ?? null,
    status: d.status ?? "pending",
    is_verified: d.is_verified === true,
    is_active: d.is_active === true,
    rating: typeof d.rating === "number" ? d.rating : 0,
    total_deliveries: typeof d.total_deliveries === "number" ? d.total_deliveries : 0,
    wallet_balance: typeof d.wallet_balance === "number" ? d.wallet_balance : 0,
    created_at: d.created_at ?? null,
    updated_at: d.updated_at ?? null,
    last_online_at: d.last_online_at ?? null,
    last_offline_at: d.last_offline_at ?? null,
    source: "firebase",
  }));
}

/**
 * Real-time driver fleet. Prefers Firebase /drivers; falls back to the legacy
 * demo list only if Firebase never delivers data (e.g. no network in preview).
 */
export function useDriverFleet() {
  const [rows, setRows] = useState<DriverRow[]>([]);
  const [source, setSource] = useState<"firebase" | "demo">("firebase");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseAvailable()) {
      setRows(fromDemo());
      setSource("demo");
      setLoading(false);
      return;
    }

    let gotFirebase = false;
    const timer = window.setTimeout(() => {
      if (!gotFirebase) {
        setRows(fromDemo());
        setSource("demo");
        setLoading(false);
      }
    }, 4000);

    const unsub = subscribeFirebaseDrivers((list) => {
      if (!gotFirebase) {
        gotFirebase = true;
        window.clearTimeout(timer);
        setSource("firebase");
        setLoading(false);
      }
      setRows(fromFirebase(list));
    });

    return () => {
      window.clearTimeout(timer);
      unsub();
    };
  }, []);

  return { rows, source, loading };
}
