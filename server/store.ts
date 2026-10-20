import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MongoClient, type Db } from "mongodb";

export type Row = Record<string, any>;

const COLLECTIONS = [
  "users", "doctors", "pharmacies", "slots", "appointments", "symptomLogs", "records",
  "prescriptions", "doseLogs", "inventory", "orders", "notifications", "consents",
  "complaints", "auditLogs", "chats", "consultationChats", "pharmacyChats", "medicineReminders",
] as const;
export type Collection = (typeof COLLECTIONS)[number];

type Data = { meta: Row } & Record<Collection, Row[]>;

const dataDir = process.env.DATA_DIR ?? path.resolve("data");
export const inMemory = dataDir === ":memory:";
const dbFile = path.join(dataDir, "db.json");
export const uploadDir = path.join(dataDir, "uploads");

function empty(): Data {
  const data = { meta: {} } as Data;
  for (const name of COLLECTIONS) data[name] = [];
  return data;
}

function load(): Data {
  const data = empty();
  if (inMemory) return data;
  fs.mkdirSync(uploadDir, { recursive: true });
  // When MongoDB is configured, skip loading the local JSON file entirely.
  // MongoDB is the sole source of truth; local JSON is only used in offline/fallback mode.
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) return data;
  if (fs.existsSync(dbFile)) Object.assign(data, JSON.parse(fs.readFileSync(dbFile, "utf8")));
  return data;
}

export const db = load();

// MongoDB persistence: when MONGODB_URI is set, data is loaded into memory at startup and changes are synced per row.
const mongoUri = inMemory ? undefined : process.env.MONGODB_URI;
export const usingMongo = Boolean(mongoUri);
const synced = new Map<string, string>();
let mongoDb: Db | undefined;
let syncing = false;
let syncAgain = false;

if (mongoUri) {
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  mongoDb = client.db(process.env.MONGODB_DB || "smartdiagno");
  const metaDoc = await mongoDb.collection("meta").findOne({ _id: "meta" as any });
  if (metaDoc) db.meta = (metaDoc as Row).value;
  for (const name of COLLECTIONS) {
    const rows = await mongoDb.collection(name).find({}).toArray();
    if (rows.length) db[name] = rows.map(({ _id, ...row }) => ({ id: _id as unknown as string, ...row }));
    for (const row of db[name]) synced.set(`${name}:${row.id}`, JSON.stringify(row));
  }
  // An empty database keeps any data loaded from the local JSON file, which the first sync migrates.
  console.log(`Connected to MongoDB database "${mongoDb.databaseName}"`);
}

async function syncMongo() {
  if (!mongoDb) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  try {
    await mongoDb.collection("meta").replaceOne({ _id: "meta" as any }, { _id: "meta" as any, value: db.meta }, { upsert: true });
    for (const name of COLLECTIONS) {
      const ops: any[] = [];
      const live = new Set<string>();
      for (const row of db[name]) {
        const key = `${name}:${row.id}`;
        const json = JSON.stringify(row);
        live.add(key);
        if (synced.get(key) === json) continue;
        const { id, ...rest } = row;
        ops.push({ replaceOne: { filter: { _id: id }, replacement: rest, upsert: true } });
        synced.set(key, json);
      }
      for (const key of [...synced.keys()]) {
        if (!key.startsWith(`${name}:`) || live.has(key)) continue;
        ops.push({ deleteOne: { filter: { _id: key.slice(name.length + 1) } } });
        synced.delete(key);
      }
      if (ops.length) await mongoDb.collection(name).bulkWrite(ops);
    }
  } catch (error) {
    console.error("MongoDB sync failed:", (error as Error).message);
    synced.clear();
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; void syncMongo(); }
  }
}

export function save() {
  if (inMemory) return;
  if (mongoDb) { void syncMongo(); return; }
  const tmp = `${dbFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, dbFile);
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
export const nowIso = () => new Date().toISOString();

export function insert(collection: Collection, row: Row): Row {
  const record: Row = { id: newId(collection.slice(0, 3)), createdAt: nowIso(), ...row };
  db[collection].push(record);
  save();
  return record;
}

export const findById = (collection: Collection, id: unknown) => db[collection].find((row) => row.id === id);

export function audit(actorId: string | null, action: string, target?: string, meta?: Row) {
  db.auditLogs.push({ id: newId("aud"), at: nowIso(), actorId, action, target, meta });
  save();
}

export function notify(userId: string, title: string, body: string) {
  db.notifications.push({ id: newId("ntf"), userId, title, body, read: false, createdAt: nowIso(), delivery: "in-app" });
  save();
}

export function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is required in production");
  if (!db.meta.sessionSecret) {
    db.meta.sessionSecret = crypto.randomBytes(32).toString("hex");
    save();
  }
  return db.meta.sessionSecret as string;
}
