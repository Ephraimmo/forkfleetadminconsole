// Link-up seed: publish a working promotion + order demo set to the shared
// Firebase RTDB (e-comm-bd997) so the CUSTOMER APP can consume it exactly as
// specified in docs/CUSTOMER_APP_PROMOTIONS_INTEGRATION.md.
//
//   node scripts/link-customer-app.cjs
//
// Safe to re-run: every record is keyed by a stable demo id and is skipped
// when it already exists. Nothing operator-owned is overwritten — the global
// points config and the existing restaurant override are left untouched.
// Menu items are only backfilled where `points_value` is missing (default 5).
const https = require("https");

const FB = "https://e-comm-bd997-default-rtdb.firebaseio.com";
const RID = "rst_5jqj45emntl"; // "Restaurant  test 1" — the restaurant with a live menu
const RESTAURANT_NAME = "Restaurant  test 1";
const ITEM_A = "itm_5hhmd8j5wmh"; // product test 2  (R30, points_value 5)
const ITEM_A_NAME = "product test 2";
const ITEM_A_PRICE = 30;
const ITEM_B = "itm_obny6nbp00g"; // product test 1  (R120)
const ITEM_B_NAME = "product test 1";
const ITEM_B_PRICE = 120;
const CUSTOMER = { id: "demo-thabo", name: "Thabo Mokoena", phone: "+27 82 555 1234" };

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = https.request(
      `${FB}${path}`,
      {
        method,
        headers: data
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: buf }));
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const get = async (path) => {
  const r = await request("GET", path);
  return r.body && r.body !== "null" ? JSON.parse(r.body) : null;
};
const put = (path, body) => request("PUT", path, body);
const patch = (path, body) => request("PATCH", path, body);

(async () => {
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString();
  const starts = iso(now - 60 * 60 * 1000);
  const expires = iso(now + 90 * 24 * 60 * 60 * 1000);
  const plan = [];

  /* ---- 1. Menu backfill: legacy items get points_value = 5 (doc §3.4) ---- */
  const menus = (await get("/menus.json")) ?? {};
  for (const [rid, menu] of Object.entries(menus)) {
    for (const [iid, item] of Object.entries(menu?.items ?? {})) {
      if (item && (item.points_value === undefined || item.points_value === null)) {
        await patch(`/menus/${rid}/items/${iid}.json`, { points_value: 5 });
        plan.push(`backfilled points_value=5  -> /menus/${rid}/items/${iid} (${item.name})`);
      }
    }
  }
  if (plan.length === 0)
    plan.push("menu backfill: nothing to do (every item already has points_value)");

  /* ---- 2. Coupon campaigns (doc §3.1) ---- */
  const promoBase = {
    description: null,
    min_order: 0,
    max_discount: null,
    usage_limit: null,
    usage_count: 0,
    starts_at: starts,
    expires_at: expires,
    is_active: true,
    applies_to: "all",
    created_at: iso(now),
    updated_at: iso(now),
    created_by: "link-seed",
  };
  const promos = {
    pro_demo_welcome20: {
      ...promoBase,
      id: "pro_demo_welcome20",
      code: "WELCOME20",
      name: "Welcome — 20% off your first order",
      description: "First-order customers get 20% off up to R60 (min order R150).",
      type: "percent",
      value: 20,
      scope: "first_order",
      restaurant_id: null,
      restaurant_ids: null,
      min_order: 150,
      max_discount: 60,
    },
    pro_demo_freedel: {
      ...promoBase,
      id: "pro_demo_freedel",
      code: "FREEDEL",
      name: "Free delivery",
      description: "Free delivery on any order over R100.",
      type: "free_delivery",
      value: 0,
      scope: "platform",
      restaurant_id: null,
      restaurant_ids: null,
      min_order: 100,
    },
    pro_demo_test15: {
      ...promoBase,
      id: "pro_demo_test15",
      code: "TEST15",
      name: `${RESTAURANT_NAME} — 15% off`,
      description: "15% off at the test restaurant only (min order R50, capped at R40).",
      type: "percent",
      value: 15,
      scope: "restaurant",
      restaurant_id: RID, // single-restaurant selection also syncs the legacy field
      restaurant_ids: [RID],
      min_order: 50,
      max_discount: 40,
    },
  };
  for (const [id, promo] of Object.entries(promos)) {
    if (await get(`/promotions/codes/${id}.json`)) {
      plan.push(`coupon ${promo.code} already exists — skipped`);
    } else {
      await put(`/promotions/codes/${id}.json`, promo);
      plan.push(`coupon ${promo.code} -> /promotions/codes/${id} (scope=${promo.scope})`);
    }
  }

  /* ---- 3. Combo deals (doc §3.2) — always per-restaurant ---- */
  const comboBase = {
    restaurant_id: RID,
    description: null,
    discount_type: null,
    discount_value: null,
    buy_qty: null,
    pay_qty: null,
    is_active: true,
    starts_at: starts,
    expires_at: expires,
    created_at: iso(now),
    updated_at: iso(now),
  };
  const combos = {
    cmb_demo_duo: {
      ...comboBase,
      id: "cmb_demo_duo",
      name: "Test Duo — 10% off together",
      description: `Buy ${ITEM_A_NAME} + ${ITEM_B_NAME} together, save 10% on the pair.`,
      kind: "bundle",
      item_ids: [ITEM_A, ITEM_B].sort(),
      discount_type: "percent",
      discount_value: 10,
    },
    cmb_demo_3for2: {
      ...comboBase,
      id: "cmb_demo_3for2",
      name: `3-for-2 — ${ITEM_B_NAME}`,
      description: `Order 3 × ${ITEM_B_NAME}, pay for 2. Applies per group of 3.`,
      kind: "multibuy",
      item_ids: [ITEM_B],
      buy_qty: 3,
      pay_qty: 2,
    },
  };
  for (const [id, combo] of Object.entries(combos)) {
    if (await get(`/promotions/combos/${id}.json`)) {
      plan.push(`combo ${combo.name} already exists — skipped`);
    } else {
      await put(`/promotions/combos/${id}.json`, combo);
      plan.push(`combo -> /promotions/combos/${id} (${combo.kind})`);
    }
  }

  /* ---- 3b. Payment options (doc §3.6) — card + cash on pickup + EFT for the test restaurant ---- */
  const existingPcfg = await get(`/restaurants/${RID}/payment_config.json`);
  if (existingPcfg) {
    if (existingPcfg.methods?.eft) {
      plan.push("payment_config already complete (incl. eft) — skipped");
    } else {
      await patch(`/restaurants/${RID}/payment_config.json`, {
        methods: {
          ...existingPcfg.methods,
          eft: { enabled: true, instructions: "Use your order number as the payment reference." },
        },
        updated_at: iso(now),
      });
      plan.push(`payment_config: added eft (enabled) -> /restaurants/${RID}/payment_config`);
    }
  } else {
    await put(`/restaurants/${RID}/payment_config.json`, {
      restaurant_id: RID,
      methods: {
        card: { enabled: true, instructions: null },
        cash_on_delivery: { enabled: false, instructions: null },
        cash_on_pickup: { enabled: true, instructions: "Please have exact change ready" },
        eft: { enabled: true, instructions: "Use your order number as the payment reference." },
      },
      updated_at: iso(now),
      updated_by: "link-seed",
    });
    plan.push(`payment_config -> /restaurants/${RID}/payment_config (card + cash_on_pickup)`);
  }

  /* ---- 4. One delivery + one pickup test order (doc §3.5) ---- */
  const mkOrder = (id, number, orderType, lines, fees, address) => {
    const ts = iso(now);
    const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
    return {
      order: {
        id,
        order_number: number,
        status: "pending",
        order_type: orderType,
        placed_at: ts,
        accepted_at: null,
        ready_at: null,
        picked_up_at: null,
        delivered_at: null,
        cancelled_at: null,
        rejected_at: null,
        eta_minutes: null,
        eta_at: null,
        subtotal,
        delivery_fee: fees.delivery,
        service_fee: fees.service,
        tax: 0,
        discount: 0,
        tip: fees.tip,
        total: Math.round((subtotal + fees.delivery + fees.service + fees.tip) * 100) / 100,
        coupon_code: null,
        payment_method: "card",
        payment_status: "paid",
        delivery_address: address,
        special_instructions: null,
        scheduled_for: null,
        restaurant_id: RID,
        restaurant_name: RESTAURANT_NAME,
        restaurant_image: null,
        customer_id: CUSTOMER.id,
        customer_name: CUSTOMER.name,
        customer_phone: CUSTOMER.phone,
        customer_email: null,
        driver_id: null,
        driver_name: null,
        driver_phone: null,
        driver_photo: null,
        driver_rating: null,
        rejection_reason: null,
        rejected_by: null,
        created_at: ts,
        updated_at: ts,
      },
      items: Object.fromEntries(lines.map((l, i) => [`ln_${id}_${i + 1}`, l])),
      timeline: {
        [`tl_${id}_placed`]: {
          id: `tl_${id}_placed`,
          status: "placed",
          at: ts,
          note: "Order placed by customer",
          actor: CUSTOMER.id,
        },
      },
    };
  };
  const delivery = mkOrder(
    "ord_demo_delivery_01",
    "FF-DELIV01",
    "delivery",
    [
      {
        id: "ln_ord_demo_delivery_01_1",
        item_id: ITEM_A,
        name: ITEM_A_NAME,
        quantity: 2,
        unit_price: ITEM_A_PRICE,
        line_total: 2 * ITEM_A_PRICE,
        notes: null,
        variant: null,
        addons: [],
      },
      {
        id: "ln_ord_demo_delivery_01_2",
        item_id: ITEM_B,
        name: ITEM_B_NAME,
        quantity: 1,
        unit_price: ITEM_B_PRICE,
        line_total: ITEM_B_PRICE,
        notes: null,
        variant: null,
        addons: [],
      },
    ],
    { delivery: 25, service: 9, tip: 10 },
    {
      label: "Home",
      street: "144 Jan Smuts Ave, Parkwood",
      city: "Johannesburg",
      postal_code: "2193",
      latitude: -26.1662,
      longitude: 28.0273,
      notes: "Gate code 4821",
    },
  );
  const pickup = mkOrder(
    "ord_demo_pickup_01",
    "FF-PICKUP01",
    "pickup",
    [
      {
        id: "ln_ord_demo_pickup_01_1",
        item_id: ITEM_B,
        name: ITEM_B_NAME,
        quantity: 3,
        unit_price: ITEM_B_PRICE,
        line_total: 3 * ITEM_B_PRICE,
        notes: "Customer collects at the counter",
        variant: null,
        addons: [],
      },
    ],
    { delivery: 0, service: 18, tip: 0 },
    null,
  );
  for (const seed of [delivery, pickup]) {
    if (await get(`/orders/${seed.order.id}.json`)) {
      plan.push(`order ${seed.order.order_number} already exists — skipped`);
    } else {
      await put(`/orders/${seed.order.id}.json`, seed.order);
      await put(`/orders/${seed.order.id}/items.json`, seed.items);
      await put(`/orders/${seed.order.id}/timeline.json`, seed.timeline);
      plan.push(
        `order ${seed.order.order_number} -> /orders/${seed.order.id} (type=${seed.order.order_type})`,
      );
    }
  }

  /* ---- 5. Payment evidence / receipts for the demo orders (doc §3.8) ---- */
  const evidences = {
    ord_demo_delivery_01: {
      order_id: "ord_demo_delivery_01",
      method: "card",
      status: "paid",
      amount: 224,
      currency: "ZAR",
      receipt_number: "R-FF-DELIV01",
      reference: "SIM-8F3K21",
      gateway: "demo-gateway",
      proof_url: null,
      paid_at: iso(now),
      recorded_by: "customer_app",
      updated_at: iso(now),
    },
    ord_demo_pickup_01: {
      order_id: "ord_demo_pickup_01",
      method: "cash_on_pickup",
      status: "pending",
      amount: 378,
      currency: "ZAR",
      receipt_number: "R-FF-PICKUP01",
      reference: null,
      gateway: null,
      proof_url: null,
      paid_at: null,
      recorded_by: "customer_app",
      updated_at: iso(now),
    },
  };
  for (const [orderId, ev] of Object.entries(evidences)) {
    if (await get(`/orders/${orderId}/payment.json`)) {
      plan.push(`payment evidence ${ev.receipt_number} already exists — skipped`);
    } else {
      await put(`/orders/${orderId}/payment.json`, ev);
      plan.push(
        `payment evidence -> /orders/${orderId}/payment (${ev.status}, ${ev.receipt_number})`,
      );
    }
  }

  /* ---- done ---- */
  console.log("\n=== Link-up seed complete ===");
  for (const line of plan) console.log(" •", line);
  console.log(`
The customer app is now linked through these live paths (see docs/CUSTOMER_APP_PROMOTIONS_INTEGRATION.md §4):
  /promotions/codes                 WELCOME20 (first order) · FREEDEL (platform) · TEST15 (this restaurant)
  /promotions/combos                Test Duo 10% bundle · 3-for-2 multi-buy at ${RESTAURANT_NAME}
  /promotions/global/points_config  (existing operator config — untouched)
  /promotions/restaurant_points/${RID}  (existing override — untouched)
  /restaurants/${RID}/payment_config  card + cash on pickup + EFT enabled
  /orders/{id}/payment                proof of payment: FF-DELIV01 paid · FF-PICKUP01 pending (cash)
  /menus/{rid}/items                points_value present on every item
  /orders                           FF-DELIV01 (delivery) + FF-PICKUP01 (customer pickup)
`);
})().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
