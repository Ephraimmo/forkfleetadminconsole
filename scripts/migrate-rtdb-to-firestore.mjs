// One-time migration: Firebase Realtime Database -> Cloud Firestore.
//
// Copies every existing RTDB node into Firestore using the exact storage
// convention implemented in src/lib/firebase.ts, so the migrated console
// reads the data unchanged:
//
//   RTDB /{node}/{entityId}            -> Firestore doc {node}/{entityId}
//   RTDB deeper nesting                -> kept verbatim as map fields on that doc
//
// Special cases (matching the code):
//   /support/tickets/{tid}             -> tickets/{tid}
//   /support/messages/{tid}/{mid}      -> tickets/{tid}/messages/{mid}
//   /restaurantBranches/{rid}/{bid}    -> restaurantBranches docs "{rid}__{bid}"
//   /drivers/live                      -> skipped (ephemeral GPS node)
//
// Usage:
//   node scripts/migrate-rtdb-to-firestore.mjs [--dry-run] [--nodes=orders,support]
//
// Credentials (admin SDK bypasses security rules):
//   --service-account=path/to/serviceAccount.json
//   or set GOOGLE_APPLICATION_CREDENTIALS
//   or run on a host with Application Default Credentials.
//
// The script is safe to re-run: every write is a full-document set().

import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const onlyArg = args.find((a) => a.startsWith("--nodes="));
const ONLY_NODES = onlyArg ? onlyArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean) : null;
const saArg = args.find((a) => a.startsWith("--service-account="));
const SERVICE_ACCOUNT = saArg ? saArg.split("=")[1] : undefined;

if (DRY_RUN) console.log("[migrate] DRY RUN — no writes will be performed.");

// Fail fast with guidance instead of hanging in the ADC credential chain.
const HAS_ADC_HINT =
  SERVICE_ACCOUNT ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_CONFIG;
if (!HAS_ADC_HINT) {
  console.error(
    "[migrate] No credentials found.\n" +
      "Pass --service-account=path/to/serviceAccount.json (Firebase Console →\n" +
      "Project settings → Service accounts) or set GOOGLE_APPLICATION_CREDENTIALS.",
  );
  process.exit(1);
}

const adminArgs = SERVICE_ACCOUNT
  ? [{ credential: cert(readFileSync(SERVICE_ACCOUNT, "utf8")), databaseURL: "https://e-comm-bd997-default-rtdb.firebaseio.com" }]
  : [{ databaseURL: "https://e-comm-bd997-default-rtdb.firebaseio.com" }];

initializeApp(...adminArgs);
const rtdb = getDatabase();
const fs = getFirestore();

const BATCH_LIMIT = 450; // keep under Firestore's 500-op batch cap

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

class Writer {
  constructor(label) {
    this.label = label;
    this.batch = fs.batch();
    this.pending = 0;
    this.commits = [];
    this.count = 0;
  }
  set(ref, data) {
    if (DRY_RUN) {
      this.count += 1;
      return;
    }
    this.batch.set(ref, data);
    this.pending += 1;
    this.count += 1;
    if (this.pending >= BATCH_LIMIT) this.flush();
  }
  flush() {
    if (DRY_RUN || this.pending === 0) {
      this.pending = 0;
      return;
    }
    const commit = this.batch.commit();
    this.commits.push(commit);
    this.batch = fs.batch();
    this.pending = 0;
  }
  async done() {
    this.flush();
    await Promise.all(this.commits);
    console.log(`[migrate] ${this.label}: ${this.count} documents ${DRY_RUN ? "(dry run)" : "written"}`);
  }
}

async function readMap(path) {
  const snap = await rtdb.ref(path).get();
  const val = snap.val();
  return val && typeof val === "object" ? val : null;
}

async function listKeys(path) {
  try {
    const res = await rtdb.ref(path).list();
    return res.keys ?? [];
  } catch {
    // Shallow listing unavailable for deep paths: fall back to reading keys.
    const map = await readMap(path);
    return map ? Object.keys(map) : [];
  }
}

/* ------------------------------------------------------------- migrators */

async function migrateGeneric(node) {
  const writer = new Writer(node);
  for (const entityId of await listKeys(node)) {
    const val = await readMap(`${node}/${entityId}`);
    if (!val || typeof val !== "object") continue;
    writer.set(fs.collection(node).doc(entityId), clean(val));
  }
  await writer.done();
}

async function migrateSupport() {
  // Tickets -> top-level `tickets` collection.
  const tw = new Writer("support/tickets -> tickets");
  const tickets = await readMap("support/tickets");
  for (const [tid, ticket] of Object.entries(tickets ?? {})) {
    tw.set(fs.collection("tickets").doc(tid), clean(ticket));
  }
  await tw.done();

  // Messages -> per-ticket subcollection.
  const mw = new Writer("support/messages -> tickets/{id}/messages");
  const threads = await readMap("support/messages");
  for (const [tid, messages] of Object.entries(threads ?? {})) {
    if (!messages || typeof messages !== "object") continue;
    for (const [mid, message] of Object.entries(messages)) {
      mw.set(fs.collection("tickets").doc(tid).collection("messages").doc(mid), clean(message));
    }
  }
  await mw.done();
}

async function migrateBranches() {
  const writer = new Writer("restaurantBranches (flattened)");
  const nested = await readMap("restaurantBranches");
  for (const [rid, branches] of Object.entries(nested ?? {})) {
    if (!branches || typeof branches !== "object") continue;
    for (const [bid, branch] of Object.entries(branches)) {
      if (!branch || typeof branch !== "object") continue;
      writer.set(fs.collection("restaurantBranches").doc(`${rid}__${bid}`), clean(branch));
    }
  }
  await writer.done();
}

async function migrateDrivers() {
  const writer = new Writer("drivers (skipping live)");
  for (const driverId of await listKeys("drivers")) {
    if (driverId === "live") continue; // ephemeral GPS node, not a driver record
    const val = await readMap(`drivers/${driverId}`);
    if (!val || typeof val !== "object") continue;
    writer.set(fs.collection("drivers").doc(driverId), clean(val));
  }
  await writer.done();
}

async function migrateNode(node) {
  if (node === "support") return migrateSupport();
  if (node === "restaurantBranches") return migrateBranches();
  if (node === "drivers") return migrateDrivers();
  return migrateGeneric(node);
}

/* --------------------------------------------------------------- runner */

async function main() {
  let nodes = await listKeys("/");
  const skip = new Set(["support", "restaurantBranches", "drivers"]);
  // support/branches/drivers are handled by dedicated migrators below.
  nodes = nodes.filter((n) => !skip.has(n));

  if (ONLY_NODES) {
    const wanted = new Set(ONLY_NODES);
    nodes = nodes.filter((n) => wanted.has(n));
  }

  const ordered = ["restaurants", "menus", "orders", "drivers", "driverAssignments",
    ...nodes.filter((n) => !["restaurants", "menus", "orders", "drivers", "driverAssignments"].includes(n)),
    "restaurantBranches", "support"];

  console.log(`[migrate] nodes: ${ordered.join(", ")}`);
  for (const node of ordered) {
    try {
      await migrateNode(node);
    } catch (err) {
      console.error(`[migrate] FAILED on "${node}":`, err);
      process.exitCode = 1;
    }
  }
  console.log(DRY_RUN
    ? "[migrate] dry run complete. Re-run without --dry-run to write."
    : "[migrate] done.");
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
