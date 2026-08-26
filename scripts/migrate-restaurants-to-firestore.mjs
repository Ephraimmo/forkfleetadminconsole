// One-time migration: copy RESTAURANT MANAGEMENT data from the Realtime
// Database into Cloud Firestore (the only section of the console that reads
// Firestore today).
//
//   RTDB /restaurants/{id}                 -> Firestore doc restaurants/{id}
//   RTDB /restaurantBranches/{rid}/{bid}   -> flat docs restaurantBranches/{rid}__{bid}
//
// Usage:
//   node scripts/migrate-restaurants-to-firestore.mjs [--dry-run]
//
// Credentials (admin SDK bypasses security rules):
//   --service-account=path/to/serviceAccount.json
//   or set GOOGLE_APPLICATION_CREDENTIALS

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const saArg = args.find((a) => a.startsWith("--service-account="));
const SERVICE_ACCOUNT = saArg ? saArg.split("=")[1] : undefined;

if (DRY_RUN) console.log("[migrate] DRY RUN — no writes will be performed.");

const HAS_CREDENTIALS = SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!HAS_CREDENTIALS) {
  console.error(
    "[migrate] No credentials found.\n" +
      "Pass --service-account=path/to/serviceAccount.json (Firebase Console →\n" +
      "Project settings → Service accounts) or set GOOGLE_APPLICATION_CREDENTIALS.",
  );
  process.exit(1);
}

initializeApp({
  credential: cert(readFileSync(SERVICE_ACCOUNT, "utf8")),
  databaseURL: "https://e-comm-bd997-default-rtdb.firebaseio.com",
});
const rtdb = getDatabase();
const fs = getFirestore();

/** Drop empty plain objects defensively (Firestore rejects `{}` map values). */
function clean(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => clean(v));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    if (v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0)
      continue;
    out[k] = clean(v);
  }
  return out;
}

async function readMap(path) {
  const snap = await rtdb.ref(path).get();
  const val = snap.val();
  return val && typeof val === "object" ? val : null;
}

async function migrateRestaurants() {
  const restaurants = await readMap("restaurants");
  const entries = Object.entries(restaurants ?? {});
  let count = 0;
  for (const [id, record] of entries) {
    if (!record || typeof record !== "object") continue;
    count += 1;
    if (!DRY_RUN) {
      await fs.collection("restaurants").doc(id).set(clean(record));
    }
    if (!DRY_RUN && count % 100 === 0) console.log(`[migrate] restaurants: ${count} written...`);
  }
  console.log(`[migrate] restaurants: ${count} documents ${DRY_RUN ? "(dry run)" : "written"}`);
}

async function migrateBranches() {
  const nested = await readMap("restaurantBranches");
  let count = 0;
  for (const [rid, branches] of Object.entries(nested ?? {})) {
    if (!branches || typeof branches !== "object") continue;
    for (const [bid, branch] of Object.entries(branches)) {
      if (!branch || typeof branch !== "object") continue;
      count += 1;
      if (!DRY_RUN) {
        await fs.collection("restaurantBranches").doc(`${rid}__${bid}`).set(clean(branch));
      }
    }
  }
  console.log(`[migrate] restaurantBranches: ${count} documents ${DRY_RUN ? "(dry run)" : "written"}`);
}

async function main() {
  await migrateRestaurants();
  await migrateBranches();
  console.log(DRY_RUN
    ? "[migrate] dry run complete. Re-run without --dry-run to write."
    : "[migrate] done.");
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
