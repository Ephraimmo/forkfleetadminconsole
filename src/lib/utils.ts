import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Great-circle distance between two WGS84 lat/lng points, in kilometres.
 *  Uses the Haversine formula with Earth mean radius 6371 km.
 *  Inputs outside valid lat/lng ranges return `null`.
 *  This is the canonical distance calculator shared between the Operations
 *  Console and the ForkFleet Customer App — do NOT reimplement in the
 *  customer app; copy this function verbatim so delivery fees always match. */
export function haversineDistanceKm(
  a: { latitude: number | null | undefined; longitude: number | null | undefined },
  b: { latitude: number | null | undefined; longitude: number | null | undefined },
): number | null {
  if (
    a.latitude == null || a.longitude == null ||
    b.latitude == null || b.longitude == null
  ) {
    return null;
  }
  const lat1 = Number(a.latitude);
  const lng1 = Number(a.longitude);
  const lat2 = Number(b.latitude);
  const lng2 = Number(b.longitude);
  if (
    !Number.isFinite(lat1) || !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) || !Number.isFinite(lng2)
  ) {
    return null;
  }
  if (
    lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90 ||
    lng1 < -180 || lng1 > 180 || lng2 < -180 || lng2 > 180
  ) {
    return null;
  }
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.round(R * c * 100) / 100;
}
