import { Router } from "express";
import { z } from "zod";
import { audit, db, findById, notify, nowIso, save, type Row } from "./store.ts";
import { currentUser, requireRole } from "./security.ts";
import { param, parseBody } from "./helpers.ts";

export const adminRouter = Router();
adminRouter.use("/admin", requireRole("admin"));

const profileOf = (user: Record<string, any>) =>
  user.role === "doctor" ? db.doctors.find((d) => d.userId === user.id) : user.role === "pharmacy" ? db.pharmacies.find((p) => p.userId === user.id) : null;

adminRouter.get("/admin/summary", (_request, response) => {
  response.json({
    users: db.users.length, patients: db.users.filter((u) => u.role === "patient").length,
    pendingDoctors: db.doctors.filter((d) => d.verification === "pending").length,
    pendingPharmacies: db.pharmacies.filter((p) => p.verification === "pending").length,
    verifiedDoctors: db.doctors.filter((d) => d.verification === "verified").length,
    verifiedPharmacies: db.pharmacies.filter((p) => p.verification === "verified").length,
    openComplaints: db.complaints.filter((c) => c.status === "open").length,
    appointments: db.appointments.length, orders: db.orders.length,
  });
});

adminRouter.get("/admin/verifications", (_request, response) => {
  const rows: Row[] = [
    ...db.doctors.map((d): Row => ({ kind: "doctor", ...d })),
    ...db.pharmacies.map((p): Row => ({ kind: "pharmacy", ...p })),
  ].map((row): Row => ({ ...row, email: findById("users", row.userId)?.email }))
    .sort((a, b) => (a.verification === "pending" ? -1 : 1) - (b.verification === "pending" ? -1 : 1));
  response.json({ verifications: rows });
});

adminRouter.post("/admin/verifications/:userId", (request, response) => {
  const data = parseBody(z.object({ decision: z.enum(["verified", "rejected", "pending"]), note: z.string().trim().max(300).optional() }).strict(), request, response);
  if (!data) return;
  const user = findById("users", param(request, "userId"));
  const profile = user && profileOf(user);
  if (!user || !profile) return response.status(404).json({ error: "No doctor or pharmacy account found." });
  profile.verification = data.decision;
  profile.verificationNote = data.note ?? "";
  profile.verifiedAt = data.decision === "verified" ? nowIso() : undefined;
  notify(user.id, "Verification update", data.decision === "verified" ? "Your account is verified. You can now use all professional features." : `Your verification status is now: ${data.decision}. ${data.note ?? ""}`);
  audit(currentUser(request).id, `verification.${data.decision}`, user.id, { note: data.note });
  save();
  response.json({ profile });
});

adminRouter.get("/admin/users", (_request, response) => {
  response.json({ users: db.users.map(({ passwordHash: _h, googleSub: _g, ...u }) => u).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
});

adminRouter.patch("/admin/users/:id/status", (request, response) => {
  const data = parseBody(z.object({ status: z.enum(["active", "suspended"]) }).strict(), request, response);
  if (!data) return;
  const user = findById("users", param(request, "id"));
  if (!user) return response.status(404).json({ error: "Not found." });
  if (user.role === "admin") return response.status(403).json({ error: "Administrator accounts cannot be changed here." });
  user.status = data.status;
  audit(currentUser(request).id, `user.${data.status}`, user.id);
  save();
  response.json({ ok: true });
});

adminRouter.get("/admin/complaints", (_request, response) => {
  response.json({ complaints: db.complaints.map((c): Row => ({ ...c, reporter: findById("users", c.reporterId)?.name })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
});

adminRouter.patch("/admin/complaints/:id", (request, response) => {
  const data = parseBody(z.object({ status: z.enum(["open", "resolved", "dismissed"]), resolution: z.string().trim().max(500).optional() }).strict(), request, response);
  if (!data) return;
  const complaint = findById("complaints", param(request, "id"));
  if (!complaint) return response.status(404).json({ error: "Not found." });
  Object.assign(complaint, data, { handledBy: currentUser(request).id });
  audit(currentUser(request).id, `complaint.${data.status}`, complaint.id);
  save();
  response.json({ complaint });
});

adminRouter.get("/admin/audit", (_request, response) => {
  response.json({ logs: [...db.auditLogs].reverse().slice(0, 200).map((log) => ({ ...log, actor: findById("users", log.actorId)?.name ?? null })) });
});
