import { Router } from "express";
import { z } from "zod";
import { audit, db, findById, insert, notify, nowIso, save, type Row } from "./store.ts";
import { currentUser, pharmacyProfile, requireRole, requireVerified } from "./security.ts";
import { param, parseBody } from "./helpers.ts";

export const pharmacyRouter = Router();
const pharmacyOnly = requireRole("pharmacy");
const id = z.string().min(3).max(60);

pharmacyRouter.get("/pharmacy/profile", pharmacyOnly, (request, response) => response.json({ profile: pharmacyProfile(currentUser(request).id) }));

pharmacyRouter.put("/pharmacy/profile", pharmacyOnly, (request, response) => {
  const data = parseBody(z.object({
    name: z.string().trim().min(2).max(120), address: z.string().trim().min(3).max(200), hours: z.string().trim().max(120),
    delivery: z.boolean(), lat: z.number().min(-90).max(90).nullable(), lng: z.number().min(-180).max(180).nullable(),
  }).strict(), request, response);
  if (!data) return;
  const profile = pharmacyProfile(currentUser(request).id)!;
  Object.assign(profile, { ...data, lat: data.lat ?? undefined, lng: data.lng ?? undefined });
  audit(currentUser(request).id, "pharmacy.profile.update", profile.id);
  save();
  response.json({ profile });
});

// Inventory ---------------------------------------------------------------
const inventorySchema = z.object({
  name: z.string().trim().min(2).max(120), price: z.number().min(0).max(1_000_000), stock: z.number().int().min(0).max(100_000),
  prescriptionOnly: z.boolean().default(true),
}).strict();

pharmacyRouter.get("/pharmacy/inventory", pharmacyOnly, (request, response) => {
  const profile = pharmacyProfile(currentUser(request).id)!;
  response.json({ items: db.inventory.filter((item) => item.pharmacyId === profile.id).sort((a, b) => a.name.localeCompare(b.name)) });
});

pharmacyRouter.post("/pharmacy/inventory", pharmacyOnly, requireVerified, (request, response) => {
  const data = parseBody(inventorySchema, request, response);
  if (!data) return;
  const profile = pharmacyProfile(currentUser(request).id)!;
  response.status(201).json({ item: insert("inventory", { ...data, pharmacyId: profile.id, updatedAt: nowIso() }) });
});

pharmacyRouter.patch("/pharmacy/inventory/:id", pharmacyOnly, requireVerified, (request, response) => {
  const data = parseBody(inventorySchema.partial(), request, response);
  if (!data) return;
  const profile = pharmacyProfile(currentUser(request).id)!;
  const item = db.inventory.find((row) => row.id === param(request, "id") && row.pharmacyId === profile.id);
  if (!item) return response.status(404).json({ error: "Not found." });
  Object.assign(item, data, { updatedAt: nowIso() });
  save();
  response.json({ item });
});

pharmacyRouter.delete("/pharmacy/inventory/:id", pharmacyOnly, requireVerified, (request, response) => {
  const profile = pharmacyProfile(currentUser(request).id)!;
  const index = db.inventory.findIndex((row) => row.id === param(request, "id") && row.pharmacyId === profile.id);
  if (index < 0) return response.status(404).json({ error: "Not found." });
  db.inventory.splice(index, 1);
  save();
  response.json({ ok: true });
});

// Orders ------------------------------------------------------------------
const TERMINAL = ["delivered", "cancelled", "rejected"];

function view(order: Row, role: string) {
  const rx = findById("prescriptions", order.prescriptionId);
  const base = { ...order, prescription: rx ? { id: rx.id, status: rx.status, issuedAt: rx.issuedAt, doctorName: rx.doctorName, items: rx.items, notes: rx.notes } : null };
  if (role === "pharmacy") return { ...base, patientName: String(order.patientName).split(" ")[0] };
  return base;
}

pharmacyRouter.post("/prescriptions/:id/share", requireRole("patient"), (request, response) => {
  const data = parseBody(z.object({
    pharmacyId: id, consent: z.literal(true, { errorMap: () => ({ message: "Explicit consent is required to share a prescription." }) }),
    deliveryAddress: z.string().trim().max(250).optional(),
  }).strict(), request, response);
  if (!data) return;
  const patient = currentUser(request);
  const rx = findById("prescriptions", param(request, "id"));
  if (!rx || rx.patientId !== patient.id) return response.status(404).json({ error: "Not found." });
  if (rx.status !== "active") return response.status(409).json({ error: "Only active prescriptions can be shared." });
  const pharmacy = findById("pharmacies", data.pharmacyId);
  if (!pharmacy || pharmacy.verification !== "verified") return response.status(403).json({ error: "Choose a verified, participating pharmacy." });
  if (db.orders.some((o) => o.prescriptionId === rx.id && o.pharmacyId === pharmacy.id && !TERMINAL.includes(o.status))) {
    return response.status(409).json({ error: "This prescription is already shared with that pharmacy." });
  }
  const order = insert("orders", {
    prescriptionId: rx.id, patientId: patient.id, patientName: patient.name, pharmacyId: pharmacy.id, pharmacyUserId: pharmacy.userId, pharmacyName: pharmacy.name,
    deliveryAddress: data.deliveryAddress ?? "", status: "received", quote: null, history: [{ status: "received", at: nowIso() }],
  });
  insert("consents", { patientId: patient.id, type: "prescription-share", prescriptionId: rx.id, pharmacyId: pharmacy.id, granted: true });
  notify(pharmacy.userId, "New prescription request", `Order ${order.id} is awaiting review.`);
  audit(patient.id, "prescription.share", rx.id, { pharmacyId: pharmacy.id, orderId: order.id });
  response.status(201).json({ order: view(order, "patient") });
});

pharmacyRouter.get("/orders", requireRole("patient", "pharmacy"), (request, response) => {
  const user = currentUser(request);
  const list = db.orders.filter((o) => (user.role === "patient" ? o.patientId === user.id : o.pharmacyUserId === user.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => view(o, user.role));
  response.json({ orders: list, delivery: { liveTracking: false, onlinePayment: false } });
});

function setStatus(order: Row, status: string, note?: string, actor?: string) {
  order.status = status;
  order.history.push({ status, at: nowIso(), note, by: actor });
  save();
}

pharmacyRouter.patch("/orders/:id/patient", requireRole("patient"), (request, response) => {
  const data = parseBody(z.object({ action: z.enum(["confirm", "decline", "cancel"]) }).strict(), request, response);
  if (!data) return;
  const user = currentUser(request);
  const order = findById("orders", param(request, "id"));
  if (!order || order.patientId !== user.id) return response.status(404).json({ error: "Not found." });
  if (TERMINAL.includes(order.status)) return response.status(409).json({ error: `Order is already ${order.status}.` });
  if (data.action === "confirm") {
    if (order.status !== "awaiting_confirmation") return response.status(409).json({ error: "There is no quotation to confirm." });
    if (findById("prescriptions", order.prescriptionId)?.status !== "active") return response.status(409).json({ error: "The prescription is no longer active." });
    setStatus(order, "confirmed", undefined, "patient");
  } else {
    if (["dispatched", "out_for_delivery"].includes(order.status)) return response.status(409).json({ error: "Order is already on its way. Contact the pharmacy." });
    setStatus(order, "cancelled", data.action === "decline" ? "Quotation declined" : "Cancelled by patient", "patient");
  }
  notify(order.pharmacyUserId, "Order update", `Order ${order.id}: ${order.status.replaceAll("_", " ")}.`);
  audit(user.id, `order.${data.action}`, order.id);
  response.json({ order: view(order, "patient") });
});

function pharmacyOrder(request: any, response: any) {
  const profile = pharmacyProfile(currentUser(request).id)!;
  const order = findById("orders", param(request, "id"));
  if (!order || order.pharmacyId !== profile.id) { response.status(404).json({ error: "Not found." }); return null; }
  return order;
}

pharmacyRouter.post("/orders/:id/quote", pharmacyOnly, requireVerified, (request, response) => {
  const data = parseBody(z.object({
    items: z.array(z.object({ name: z.string().trim().min(2).max(120), qty: z.number().int().min(1).max(1000), unitPrice: z.number().min(0).max(1_000_000) }).strict()).min(1).max(40),
    deliveryFee: z.number().min(0).max(100_000).default(0), note: z.string().trim().max(300).optional(),
  }).strict(), request, response);
  if (!data) return;
  const order = pharmacyOrder(request, response);
  if (!order) return;
  if (!["received", "under_review", "awaiting_confirmation"].includes(order.status)) return response.status(409).json({ error: "A quotation can't be issued at this stage." });
  const rx = findById("prescriptions", order.prescriptionId);
  if (!rx || rx.status !== "active") return response.status(409).json({ error: "The prescription is no longer active." });
  const total = data.items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0) + data.deliveryFee;
  order.quote = { ...data, total: Math.round(total * 100) / 100, issuedAt: nowIso() };
  setStatus(order, "awaiting_confirmation", "Quotation issued", "pharmacy");
  notify(order.patientId, "Quotation ready", `${order.pharmacyName} sent a quotation for ${rx.id}. Review and confirm it.`);
  audit(currentUser(request).id, "order.quote", order.id);
  response.json({ order: view(order, "pharmacy") });
});

const NEXT: Record<string, string[]> = {
  received: ["under_review"], confirmed: ["preparing"], preparing: ["dispatched"], dispatched: ["out_for_delivery", "delivered"], out_for_delivery: ["delivered"],
};

pharmacyRouter.patch("/orders/:id/status", pharmacyOnly, requireVerified, (request, response) => {
  const data = parseBody(z.object({ status: z.enum(["under_review", "preparing", "dispatched", "out_for_delivery", "delivered"]) }).strict(), request, response);
  if (!data) return;
  const order = pharmacyOrder(request, response);
  if (!order) return;
  if (!(NEXT[order.status] ?? []).includes(data.status)) return response.status(409).json({ error: `Cannot move an order from ${order.status} to ${data.status}.` });
  if (findById("prescriptions", order.prescriptionId)?.status !== "active" && data.status !== "delivered") return response.status(409).json({ error: "The prescription is no longer active." });
  setStatus(order, data.status, undefined, "pharmacy");
  notify(order.patientId, "Order update", `Your order is now ${data.status.replaceAll("_", " ")}.`);
  audit(currentUser(request).id, "order.status", order.id, { status: data.status });
  response.json({ order: view(order, "pharmacy") });
});

pharmacyRouter.post("/orders/:id/reject", pharmacyOnly, requireVerified, (request, response) => {
  const data = parseBody(z.object({ reason: z.string().trim().min(3).max(300) }).strict(), request, response);
  if (!data) return;
  const order = pharmacyOrder(request, response);
  if (!order) return;
  if (!["received", "under_review", "awaiting_confirmation"].includes(order.status)) return response.status(409).json({ error: "This order can no longer be rejected." });
  setStatus(order, "rejected", data.reason, "pharmacy");
  notify(order.patientId, "Order rejected", `${order.pharmacyName} could not fulfil your request: ${data.reason}`);
  audit(currentUser(request).id, "order.reject", order.id);
  response.json({ order: view(order, "pharmacy") });
});
