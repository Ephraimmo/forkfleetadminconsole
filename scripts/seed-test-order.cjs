// Quick seed script: write one pending order against e-comm-bd997 so the UI
// has something to accept/reject on first load. Run once. Idempotent by order id.
// eslint-disable-next-line
const https = require("https");

const FB = "https://e-comm-bd997-default-rtdb.firebaseio.com";
const ORDER_ID = "ord_demo_pending_01";

function put(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(`${FB}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const ts = new Date().toISOString();
  const order = {
    id: ORDER_ID,
    order_number: "FF-DEMO01",
    status: "pending",
    placed_at: ts,
    accepted_at: null, ready_at: null, picked_up_at: null, delivered_at: null,
    cancelled_at: null, rejected_at: null,
    eta_minutes: null, eta_at: null,
    subtotal: 178.00, delivery_fee: 25.00, service_fee: 8.90, tax: 0, discount: 0, tip: 10.00, total: 221.90,
    coupon_code: null,
    payment_method: "card",
    payment_status: "paid",
    delivery_address: {
      label: "Home", street: "144 Jan Smuts Ave, Parkwood", city: "Johannesburg",
      postal_code: "2193", latitude: -26.1662, longitude: 28.0273, notes: "Gate code 4821",
    },
    special_instructions: "No onions on the burger, please.",
    scheduled_for: null,
    restaurant_id: "rst-nonna",
    restaurant_name: "Nonna's Trattoria",
    restaurant_image: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=900&q=70",
    customer_id: "cus_demo_01",
    customer_name: "Thabo Mokoena",
    customer_phone: "+27 82 555 1234",
    customer_email: "thabo@example.demo",
    driver_id: null, driver_name: null, driver_phone: null, driver_photo: null, driver_rating: null,
    rejection_reason: null, rejected_by: null,
    created_at: ts, updated_at: ts,
  };
  const lines = {
    ln_demo_1: {
      id: "ln_demo_1", item_id: "itm_demo_1", name: "Margherita Pizza", quantity: 2,
      unit_price: 89.00, line_total: 178.00, notes: "Extra basil",
      variant: null, addons: [],
    },
  };
  const timeline = {
    tl_demo_placed: { id: "tl_demo_placed", status: "placed", at: ts, note: "Order placed by customer", actor: "cus_demo_01" },
  };

  const existing = await new Promise((resolve, reject) => {
    https.get(`${FB}/orders/${ORDER_ID}.json`, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => resolve(buf && buf !== "null" ? JSON.parse(buf) : null));
    }).on("error", reject);
  });

  if (existing && existing.status !== "pending") {
    console.log(`Order ${ORDER_ID} already exists with status=${existing.status}; not overwriting.`);
    return;
  }

  const [r1, r2, r3] = await Promise.all([
    put(`/orders/${ORDER_ID}.json`, order),
    put(`/orders/${ORDER_ID}/items.json`, lines),
    put(`/orders/${ORDER_ID}/timeline.json`, timeline),
  ]);
  console.log("order ->", r1.status);
  console.log("items ->", r2.status);
  console.log("timeline ->", r3.status);
  console.log("Done. Visit /orders to see the pending order.");
})();
