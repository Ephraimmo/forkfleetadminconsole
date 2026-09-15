import { audit } from "@/lib/audit";
import {
  delay,
  promotions,
  restaurants,
  uid,
  type PromoType,
  type PromoScope,
} from "@/lib/demo-store";

export interface PromoRow {
  id: string;
  code: string;
  name: string;
  description: string;
  type: PromoType;
  value: number;
  scope: PromoScope;
  restaurant_id: string | null;
  restaurant_name: string | null;
  min_order: number;
  max_discount: number | null;
  usage_limit: number | null;
  usage_count: number;
  starts_at: string;
  expires_at: string;
  is_active: boolean;
}

export interface PromoApplication {
  valid: boolean;
  reason?: string;
  discount: number;
  freeDelivery: boolean;
  promo: PromoRow | null;
  subtotal: number;
  deliveryFee: number;
  total: number;
  breakdown: { label: string; amount: number }[];
}

function toRow(p: (typeof promotions)[number]): PromoRow {
  return {
    ...p,
    restaurant_name: p.restaurant_id ? restaurants.find((r) => r.id === p.restaurant_id)?.name ?? null : null,
  };
}

export async function listPromotions(): Promise<PromoRow[]> {
  await delay(60);
  return promotions.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map(toRow);
}

export async function savePromotion(
  input: Omit<PromoRow, "id" | "usage_count" | "restaurant_name" | "created_at"> & { id?: string },
) {
  await delay(80);
  if (input.id) {
    const p = promotions.find((x) => x.id === input.id);
    if (!p) throw new Error("Promotion not found");
    Object.assign(p, {
      code: input.code.toUpperCase(),
      name: input.name,
      description: input.description,
      type: input.type,
      value: input.value,
      scope: input.scope,
      restaurant_id: input.restaurant_id,
      min_order: input.min_order,
      max_discount: input.max_discount,
      usage_limit: input.usage_limit,
      starts_at: input.starts_at,
      expires_at: input.expires_at,
      is_active: input.is_active,
    });
    audit({
      action: "promotion.updated",
      entityType: "promotion",
      entityId: p.id,
      after: { code: p.code },
    });
    return { ok: true, id: p.id };
  }
  const id = uid("pr");
  promotions.push({
    id,
    code: input.code.toUpperCase(),
    name: input.name,
    description: input.description,
    type: input.type,
    value: input.value,
    scope: input.scope,
    restaurant_id: input.restaurant_id,
    min_order: input.min_order,
    max_discount: input.max_discount,
    usage_limit: input.usage_limit,
    usage_count: 0,
    starts_at: input.starts_at,
    expires_at: input.expires_at,
    is_active: input.is_active,
    created_at: new Date().toISOString(),
  });
  audit({
    action: "promotion.created",
    entityType: "promotion",
    entityId: id,
    after: { code: input.code.toUpperCase() },
  });
  return { ok: true, id };
}

export async function togglePromotion(input: { id: string; isActive: boolean }) {
  await delay(40);
  const p = promotions.find((x) => x.id === input.id);
  if (!p) throw new Error("Promotion not found");
  p.is_active = input.isActive;
  return { ok: true };
}

export async function applyPromo(input: {
  code: string;
  subtotal: number;
  deliveryFee: number;
  restaurantId?: string | null;
  isFirstOrder?: boolean;
}): Promise<PromoApplication> {
  await delay(120);
  const breakdown: { label: string; amount: number }[] = [];
  breakdown.push({ label: "Subtotal", amount: Math.round(input.subtotal * 100) / 100 });
  if (input.deliveryFee) breakdown.push({ label: "Delivery", amount: Math.round(input.deliveryFee * 100) / 100 });

  const code = input.code.trim().toUpperCase();
  if (!code) {
    return invalid("Enter a promo code to continue.", input.subtotal, input.deliveryFee, breakdown);
  }
  const promo = promotions.find((p) => p.code.toUpperCase() === code);
  if (!promo) return invalid("Promo code not recognised.", input.subtotal, input.deliveryFee, breakdown);
  if (!promo.is_active) return invalid("This promo is no longer active.", input.subtotal, input.deliveryFee, breakdown);
  const now = new Date();
  if (new Date(promo.starts_at) > now) return invalid("This promo is not yet valid.", input.subtotal, input.deliveryFee, breakdown);
  if (new Date(promo.expires_at) < now) return invalid("This promo has expired.", input.subtotal, input.deliveryFee, breakdown);
  if (promo.usage_limit && promo.usage_count >= promo.usage_limit)
    return invalid("This promo has reached its redemption limit.", input.subtotal, input.deliveryFee, breakdown);
  if (input.subtotal < promo.min_order)
    return invalid(`Minimum order of R ${promo.min_order.toFixed(2)} required.`, input.subtotal, input.deliveryFee, breakdown);
  if (promo.scope === "restaurant" && promo.restaurant_id && promo.restaurant_id !== input.restaurantId)
    return invalid("This promo is for a different restaurant.", input.subtotal, input.deliveryFee, breakdown);
  if (promo.scope === "first_order" && !input.isFirstOrder)
    return invalid("This promo is for first orders only.", input.subtotal, input.deliveryFee, breakdown);

  let discount = 0;
  let freeDelivery = false;
  switch (promo.type) {
    case "percent": {
      discount = (input.subtotal * promo.value) / 100;
      if (promo.max_discount) discount = Math.min(discount, promo.max_discount);
      break;
    }
    case "fixed": {
      discount = Math.min(promo.value, input.subtotal);
      break;
    }
    case "free_delivery": {
      freeDelivery = true;
      break;
    }
    case "bogo": {
      // Demo: 25% off the whole basket to represent a BOGO credit
      discount = Math.round(input.subtotal * 0.25 * 100) / 100;
      break;
    }
  }
  discount = Math.round(discount * 100) / 100;
  if (discount > 0) breakdown.push({ label: `Promo (${promo.code})`, amount: -discount });
  const deliveryTotal = freeDelivery ? 0 : input.deliveryFee;
  if (freeDelivery && input.deliveryFee > 0) breakdown.push({ label: "Free delivery", amount: -input.deliveryFee });
  const total = Math.max(0, Math.round((input.subtotal + deliveryTotal - discount) * 100) / 100);
  breakdown.push({ label: "Total", amount: total });

  promo.usage_count += 1;
  audit({
    action: "promotion.applied",
    entityType: "promotion",
    entityId: promo.id,
    after: { code: promo.code, discount, freeDelivery },
  });

  return {
    valid: true,
    discount,
    freeDelivery,
    promo: toRow(promo),
    subtotal: input.subtotal,
    deliveryFee: deliveryTotal,
    total,
    breakdown,
  };
}

function invalid(
  reason: string,
  subtotal: number,
  deliveryFee: number,
  breakdown: { label: string; amount: number }[],
): PromoApplication {
  const total = Math.round((subtotal + deliveryFee) * 100) / 100;
  breakdown.push({ label: "Total", amount: total });
  return {
    valid: false,
    reason,
    discount: 0,
    freeDelivery: false,
    promo: null,
    subtotal,
    deliveryFee,
    total,
    breakdown,
  };
}
