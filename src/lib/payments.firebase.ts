// Firebase-backed per-restaurant payment configuration.
//
// Stored under the Realtime Database root:
//   /restaurants/{restaurantId}/payment_config  -> RestaurantPaymentConfig
//
// The customer app reads this path to decide which payment methods to offer
// at checkout. When the record is missing, the safe default applies (card only),
// so existing restaurants keep working unchanged until an operator opts in.

import { isFirebaseAvailable, rtdbGet, rtdbSet, rtdbSubscribe } from "@/lib/firebase";

export type PaymentMethodId = "card" | "cash_on_delivery" | "cash_on_pickup" | "eft";
export type OrderType = "delivery" | "pickup";

export interface PaymentMethodSetting {
  enabled: boolean;
  /** Optional customer-facing note, e.g. "Please have exact change ready." */
  instructions: string | null;
}

export interface RestaurantPaymentConfig {
  restaurant_id: string;
  methods: Record<PaymentMethodId, PaymentMethodSetting>;
  updated_at: string;
  updated_by: string | null;
  [key: string]:
    | string
    | PaymentMethodSetting
    | Record<PaymentMethodId, PaymentMethodSetting>
    | null
    | undefined;
}

/** Static catalogue: id, customer-facing label, admin description + which
 *  order types the method may be offered for. Icons live in the UI layer. */
export const PAYMENT_METHOD_CATALOG: {
  id: PaymentMethodId;
  label: string;
  customer_hint: string;
  description: string;
  applies_to: OrderType[];
}[] = [
  {
    id: "card",
    label: "Card payment",
    customer_hint: "Pay securely online",
    description:
      "Customers pay online at checkout (Visa, Mastercard or instant EFT). Paid before the order reaches the kitchen.",
    applies_to: ["delivery", "pickup"],
  },
  {
    id: "cash_on_delivery",
    label: "Cash on delivery",
    customer_hint: "Pay the driver in cash",
    description:
      "Customers pay the driver in cash when the order arrives. Only ever offered on delivery orders.",
    applies_to: ["delivery"],
  },
  {
    id: "cash_on_pickup",
    label: "Cash on pickup",
    customer_hint: "Pay at the counter",
    description:
      "Customers pay at the counter when collecting their order. Only ever offered on customer-pickup orders.",
    applies_to: ["pickup"],
  },
  {
    id: "eft",
    label: "Bank transfer (EFT)",
    customer_hint: "Upload your proof of payment",
    description:
      "Customers pay by bank transfer and upload proof of payment (image or PDF) at checkout. The order is confirmed once the payment is verified.",
    applies_to: ["delivery", "pickup"],
  },
];

/** Safe fallback used for restaurants that have never configured payments. */
export function defaultPaymentConfig(restaurantId: string): RestaurantPaymentConfig {
  return {
    restaurant_id: restaurantId,
    methods: {
      card: { enabled: true, instructions: null },
      cash_on_delivery: { enabled: false, instructions: null },
      cash_on_pickup: { enabled: false, instructions: null },
      eft: { enabled: false, instructions: null },
    },
    updated_at: "",
    updated_by: null,
  };
}

/** Merge a raw record (possibly partial/legacy) over the defaults so every
 *  method always has a well-defined state. */
export function resolvePaymentConfig(
  restaurantId: string,
  raw: Partial<RestaurantPaymentConfig> | null,
): RestaurantPaymentConfig {
  const base = defaultPaymentConfig(restaurantId);
  if (!raw) return base;
  const methods = { ...base.methods };
  for (const { id } of PAYMENT_METHOD_CATALOG) {
    const m = raw.methods?.[id];
    if (m) {
      methods[id] = {
        enabled: Boolean(m.enabled),
        instructions: m.instructions ?? null,
      };
    }
  }
  return {
    restaurant_id: restaurantId,
    methods,
    updated_at: raw.updated_at ?? "",
    updated_by: raw.updated_by ?? null,
  };
}

/** Customer-facing read: payment methods enabled at a restaurant that apply
 *  to the given order type. When no config exists, only card is offered. */
export function availablePaymentMethods(
  config: RestaurantPaymentConfig,
  orderType: OrderType,
): PaymentMethodId[] {
  return PAYMENT_METHOD_CATALOG.filter(
    ({ id, applies_to }) => config.methods[id].enabled && applies_to.includes(orderType),
  ).map(({ id }) => id);
}

const path = (restaurantId: string) => `restaurants/${restaurantId}/payment_config`;

export async function getPaymentConfig(restaurantId: string): Promise<RestaurantPaymentConfig> {
  if (!isFirebaseAvailable()) return defaultPaymentConfig(restaurantId);
  const raw = await rtdbGet<Partial<RestaurantPaymentConfig>>(path(restaurantId));
  return resolvePaymentConfig(restaurantId, raw);
}

export function subscribePaymentConfig(
  restaurantId: string,
  cb: (config: RestaurantPaymentConfig) => void,
): () => void {
  if (!isFirebaseAvailable()) {
    cb(defaultPaymentConfig(restaurantId));
    return () => {};
  }
  return rtdbSubscribe<Partial<RestaurantPaymentConfig> | null>(path(restaurantId), (raw) =>
    cb(resolvePaymentConfig(restaurantId, raw)),
  );
}

export async function savePaymentConfig(input: {
  restaurant_id: string;
  methods: Record<PaymentMethodId, PaymentMethodSetting>;
  updated_by?: string | null;
}): Promise<RestaurantPaymentConfig> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const enabled = PAYMENT_METHOD_CATALOG.filter(({ id }) => input.methods[id]?.enabled);
  if (enabled.length === 0) {
    throw new Error("Enable at least one payment method — customers must be able to pay.");
  }
  const record: RestaurantPaymentConfig = {
    restaurant_id: input.restaurant_id,
    methods: Object.fromEntries(
      PAYMENT_METHOD_CATALOG.map(({ id }) => [
        id,
        {
          enabled: Boolean(input.methods[id]?.enabled),
          instructions: (input.methods[id]?.instructions ?? "").trim() || null,
        },
      ]),
    ) as Record<PaymentMethodId, PaymentMethodSetting>,
    updated_at: new Date().toISOString(),
    updated_by: input.updated_by ?? null,
  };
  await rtdbSet(path(input.restaurant_id), record as unknown as import("@/lib/firebase").RTDBValue);
  return record;
}

/* ------------------------------------------------- payment evidence ------
 *
 * Proof of payment / receipt for a single order, stored at
 *   /orders/{orderId}/payment  -> OrderPaymentEvidence
 *
 * The customer app writes this when the order is placed (card: paid with a
 * gateway reference; cash: pending). The console/driver marks cash orders
 * paid on handover — both sides subscribe to the same node, so the receipt
 * always stays in sync.
 */

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export interface OrderPaymentEvidence {
  order_id: string;
  method: PaymentMethodId | string; // tolerate legacy/unknown method ids
  status: PaymentStatus;
  amount: number; // what the customer paid (== order.total)
  currency: string; // "ZAR"
  receipt_number: string; // stable, shown to the customer
  reference: string | null; // gateway transaction reference
  gateway: string | null; // e.g. "yoco", "payfast", "demo-gateway"
  proof_url: string | null; // uploaded proof of payment (EFT: image or PDF)
  card_brand: string | null; // e.g. "visa", "mastercard" (card only)
  card_last4: string | null; // last 4 digits only — never the full PAN
  paid_at: string | null;
  recorded_by: string | null; // "customer_app" | "driver" | "console" | email
  updated_at: string;
}

const paymentPath = (orderId: string) => `orders/${orderId}/payment`;

/** Deterministic receipt number so both apps render the same one even before
 *  the evidence record exists. */
export function receiptNumberFor(orderNumber: string): string {
  return `R-${orderNumber}`;
}

/** Human label for a payment method id (falls back to the raw id). */
export function paymentMethodLabel(id: string): string {
  return PAYMENT_METHOD_CATALOG.find((m) => m.id === id)?.label ?? id.replace(/_/g, " ");
}

/** Fallback view used when no evidence record exists yet (legacy orders). */
export function synthesizePaymentEvidence(order: {
  id: string;
  order_number: string;
  total: number;
  payment_method: string;
  payment_status: string;
}): OrderPaymentEvidence {
  return {
    order_id: order.id,
    method: order.payment_method || "card",
    status: order.payment_status === "paid" ? "paid" : "pending",
    amount: order.total,
    currency: "ZAR",
    receipt_number: receiptNumberFor(order.order_number),
    reference: null,
    gateway: null,
    proof_url: null,
    card_brand: null,
    card_last4: null,
    paid_at: null,
    recorded_by: null,
    updated_at: "",
  };
}

export function subscribeOrderPayment(
  orderId: string,
  cb: (ev: OrderPaymentEvidence | null) => void,
): () => void {
  if (!isFirebaseAvailable()) {
    cb(null);
    return () => {};
  }
  return rtdbSubscribe<OrderPaymentEvidence | null>(paymentPath(orderId), (v) => cb(v ?? null));
}

/** Mark an order's payment as PAID (cash handover), merging any existing
 *  evidence kept by the customer app. Also syncs order.payment_status. */
export async function markOrderPaid(input: {
  order_id: string;
  order_number: string;
  total: number;
  payment_method: string;
  recorded_by?: string | null;
}): Promise<OrderPaymentEvidence> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const existing = await rtdbGet<OrderPaymentEvidence>(paymentPath(input.order_id));
  if (existing?.status === "paid") return existing;
  const ts = new Date().toISOString();
  const record: OrderPaymentEvidence = {
    order_id: input.order_id,
    method: existing?.method ?? input.payment_method ?? "card",
    status: "paid",
    amount: existing?.amount ?? input.total,
    currency: existing?.currency ?? "ZAR",
    receipt_number: existing?.receipt_number ?? receiptNumberFor(input.order_number),
    reference: existing?.reference ?? null,
    gateway: existing?.gateway ?? null,
    proof_url: existing?.proof_url ?? null,
    card_brand: existing?.card_brand ?? null,
    card_last4: existing?.card_last4 ?? null,
    paid_at: ts,
    recorded_by: input.recorded_by ?? "console",
    updated_at: ts,
  };
  await rtdbSet(
    paymentPath(input.order_id),
    record as unknown as import("@/lib/firebase").RTDBValue,
  );
  await rtdbSet(`orders/${input.order_id}/payment_status`, "paid");
  return record;
}
