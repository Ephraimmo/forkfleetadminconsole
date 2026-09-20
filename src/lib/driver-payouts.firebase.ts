// Weekly (or day/month/custom-period) driver payout ledger, computed from
// completed deliveries and persisted so a given driver+period is only ever
// marked paid once.
//
// Pay rule (confirmed by ops, 2026-09-20): a driver keeps the delivery fee
// charged on every successful delivery, minus a flat platform commission per
// delivery. The platform's own delivery-commission revenue for the period is
// simply (deliveries * DRIVER_COMMISSION_PER_DELIVERY).
//
//   amount_due    = sum(delivery_fee for completed deliveries) - deliveries * DRIVER_COMMISSION_PER_DELIVERY
//   platform_take = deliveries * DRIVER_COMMISSION_PER_DELIVERY
//
// Ledger stored at /driver_payouts/{driverId}__{periodStartISODate} so a paid
// period keeps its original snapshot even if orders in that window change
// later (e.g. a late cancellation) — recomputing never un-pays a driver.

import { isFirebaseAvailable, fsGet, fsSet, type FirestoreValue } from "@/lib/firestore";
import type { FirebaseOrder } from "@/lib/orders.firebase";
import type { DateRange } from "@/lib/finance.firebase";

export const DRIVER_COMMISSION_PER_DELIVERY = 5;

export type DriverPayoutStatus = "pending" | "paid";

export interface DriverPayoutRecord {
  driver_id: string;
  driver_name: string;
  period_start: string;
  period_end: string;
  deliveries: number;
  gross_delivery_fees: number;
  commission: number;
  amount_due: number;
  status: DriverPayoutStatus;
  paid_at: string | null;
  paid_by: string | null;
  updated_at: string;
}

function periodKey(driverId: string, range: DateRange): string {
  return `${driverId}__${range.start.toISOString().slice(0, 10)}`;
}

const path = (driverId: string, range: DateRange) => `driver_payouts/${periodKey(driverId, range)}`;

function inRange(iso: string, range: DateRange): boolean {
  const t = new Date(iso).getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
}

/** Pure aggregation: one row per driver with at least one completed delivery
 *  in the period, before the paid/pending ledger is overlaid. */
export function summarizeDriverDeliveries(
  orders: FirebaseOrder[],
  range: DateRange,
): { driver_id: string; driver_name: string; deliveries: number; gross_delivery_fees: number }[] {
  const completed = orders.filter(
    (o) => o.status === "delivered" && o.driver_id && inRange(o.delivered_at ?? o.placed_at, range),
  );
  const map = new Map<
    string,
    { driver_id: string; driver_name: string; deliveries: number; gross_delivery_fees: number }
  >();
  for (const o of completed) {
    const key = o.driver_id!;
    const entry = map.get(key) ?? {
      driver_id: key,
      driver_name: o.driver_name ?? "Unknown driver",
      deliveries: 0,
      gross_delivery_fees: 0,
    };
    entry.deliveries += 1;
    entry.gross_delivery_fees += o.delivery_fee;
    map.set(key, entry);
  }
  return Array.from(map.values());
}

/** Computed payout rows for a period, merged with any existing ledger record.
 *  A driver already marked "paid" for this exact period keeps that frozen
 *  snapshot; everyone else gets a fresh "pending" computation from live
 *  orders. */
export async function computeDriverPayouts(
  orders: FirebaseOrder[],
  range: DateRange,
): Promise<DriverPayoutRecord[]> {
  const rows = summarizeDriverDeliveries(orders, range);

  const results = await Promise.all(
    rows.map(async (row) => {
      const existing = isFirebaseAvailable()
        ? await fsGet<DriverPayoutRecord>(path(row.driver_id, range))
        : null;
      if (existing?.status === "paid") return existing;

      const commission = row.deliveries * DRIVER_COMMISSION_PER_DELIVERY;
      const amount_due = Math.round((row.gross_delivery_fees - commission) * 100) / 100;
      return {
        driver_id: row.driver_id,
        driver_name: row.driver_name,
        period_start: range.start.toISOString(),
        period_end: range.end.toISOString(),
        deliveries: row.deliveries,
        gross_delivery_fees: row.gross_delivery_fees,
        commission,
        amount_due,
        status: "pending",
        paid_at: null,
        paid_by: null,
        updated_at: "",
      } satisfies DriverPayoutRecord;
    }),
  );

  return results.sort((a, b) => b.amount_due - a.amount_due);
}

/** Mark a driver's payout for this exact period as paid. */
export async function markDriverPayoutPaid(input: {
  driver_id: string;
  driver_name: string;
  range: DateRange;
  deliveries: number;
  gross_delivery_fees: number;
  commission: number;
  amount_due: number;
  actor?: string | null;
}): Promise<DriverPayoutRecord> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const ts = new Date().toISOString();
  const record: DriverPayoutRecord = {
    driver_id: input.driver_id,
    driver_name: input.driver_name,
    period_start: input.range.start.toISOString(),
    period_end: input.range.end.toISOString(),
    deliveries: input.deliveries,
    gross_delivery_fees: input.gross_delivery_fees,
    commission: input.commission,
    amount_due: input.amount_due,
    status: "paid",
    paid_at: ts,
    paid_by: input.actor ?? "console",
    updated_at: ts,
  };
  await fsSet(path(input.driver_id, input.range), record as unknown as FirestoreValue);
  return record;
}
