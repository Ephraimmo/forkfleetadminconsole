// One-shot repair: ensures every restaurant has delivery_enabled=true, pickup_enabled=true,
// and repairs the junk test restaurant rst_5jqj45emntl which has 200 tiers / 1000 km radius.
const https = require("https");

const DB = "https://e-comm-bd997-default-rtdb.firebaseio.com";

function get(path) {
  return new Promise((resolve, reject) => {
    https.get(`${DB}${path}`, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

function patch(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${DB}${path}`);
    const req = https.request({
      method: "PATCH",
      hostname: url.hostname,
      path: url.pathname,
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve(d); }
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function defaultTiersFor(radiusKm) {
  const bands = [{ up: Math.min(3, radiusKm), fee: 15 }];
  let up = 5, fee = 25;
  while (up < radiusKm) { bands.push({ up, fee }); up += 5; fee += 10; }
  bands.push({ up: radiusKm, fee });
  const seen = new Map();
  for (const b of bands) {
    const clamped = Math.min(Math.max(1, Math.round(b.up * 10) / 10), radiusKm);
    seen.set(clamped, b.fee);
  }
  return [...seen.entries()].sort(([a],[b])=>a-b).map(([up, fee], i) => ({
    id: `tier_fix_${i}`, up_to_km: up, fee, label: null,
  }));
}

(async () => {
  const all = await get("/restaurants.json");
  if (!all) { console.log("no restaurants"); return; }
  for (const [id, r] of Object.entries(all)) {
    const patches = {};
    if (typeof r.delivery_enabled !== "boolean") patches.delivery_enabled = true;
    if (typeof r.pickup_enabled !== "boolean") patches.pickup_enabled = true;
    // Repair restaurants with broken tier/radius data (radius > 50 or tiers > 20).
    const tiers = Array.isArray(r.delivery_tiers) ? r.delivery_tiers : [];
    const rad = Number(r.delivery_radius_km) || 0;
    if (rad > 50 || tiers.length > 20) {
      const sane = 10;
      patches.delivery_radius_km = sane;
      patches.delivery_tiers = defaultTiersFor(sane);
      patches.delivery_enabled = true;
      patches.pickup_enabled = true;
      console.log(`repairing ${id} (was radius=${rad}km, ${tiers.length} tiers)`);
    }
    if (Object.keys(patches).length > 0) {
      await patch(`/restaurants/${id}.json`, patches);
      console.log(`patched ${id} with`, Object.keys(patches));
    } else {
      console.log(`ok ${id} (already has flags, radius=${rad})`);
    }
  }
  console.log("done.");
})().catch((e) => { console.error(e); process.exit(1); });
