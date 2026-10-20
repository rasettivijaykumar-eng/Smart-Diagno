import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { audit, db, findById, inMemory, insert, newId, notify, nowIso, save, uploadDir, type Row } from "./store.ts";
import { currentUser, doctorProfile, requireRole, requireVerified, signToken, verifyPassword } from "./security.ts";
import { param, parseBody } from "./helpers.ts";

export const careRouter = Router();
const patientOnly = requireRole("patient");
const doctorOnly = requireRole("doctor");
const idString = z.string().min(3).max(60);

// ---------- Preferences, export, deletion ----------
careRouter.put("/me/preferences", requireRole("patient", "doctor", "pharmacy", "admin"), (request, response) => {
  const data = parseBody(z.object({ browserNotifications: z.boolean() }).strict(), request, response);
  if (!data) return;
  const user = currentUser(request);
  user.preferences = { ...user.preferences, ...data };
  save();
  response.json({ preferences: user.preferences });
});

careRouter.get("/me/export", patientOnly, (request, response) => {
  const id = currentUser(request).id;
  const { passwordHash: _hash, ...user } = currentUser(request);
  const mine = (rows: Row[]) => rows.filter((row) => row.patientId === id || row.userId === id);
  audit(id, "data.export", id);
  response.json({
    exportedAt: nowIso(), user, symptomLogs: mine(db.symptomLogs),
    records: mine(db.records).map(({ fileData: _data, ...row }) => row), appointments: mine(db.appointments),
    prescriptions: mine(db.prescriptions), doseLogs: mine(db.doseLogs), orders: mine(db.orders), consents: mine(db.consents),
  });
});

careRouter.delete("/me", patientOnly, (request, response) => {
  const data = parseBody(z.object({ password: z.string().min(1).max(128) }).strict(), request, response);
  if (!data) return;
  const user = currentUser(request);
  if (user.passwordHash && !verifyPassword(data.password, user.passwordHash)) return response.status(401).json({ error: "Password is incorrect." });
  const id = user.id;
  for (const record of db.records.filter((row) => row.patientId === id && row.filePath)) fs.rmSync(record.filePath, { force: true });
  for (const name of ["symptomLogs", "records", "doseLogs", "consents", "orders", "notifications", "prescriptions", "appointments"] as const) {
    db[name] = db[name].filter((row) => row.patientId !== id && row.userId !== id) as any;
  }
  for (const slot of db.slots) if (slot.patientId === id) { slot.status = "open"; delete slot.patientId; delete slot.appointmentId; }
  db.users = db.users.filter((row) => row.id !== id);
  audit(id, "account.delete", id);
  response.clearCookie("sd_session", { path: "/" }).json({ ok: true });
});

// ---------- Symptom logs and alerts ----------
careRouter.get("/symptom-logs", patientOnly, (request, response) => {
  const logs = db.symptomLogs.filter((row) => row.patientId === currentUser(request).id).sort((a, b) => b.date.localeCompare(a.date));
  response.json({ logs });
});

careRouter.post("/symptom-logs", patientOnly, (request, response) => {
  const data = parseBody(z.object({
    symptom: z.string().trim().min(2).max(100), severity: z.number().int().min(1).max(10),
    date: z.string().datetime({ offset: true }).optional(), notes: z.string().trim().max(500).optional(),
    measurement: z.object({ label: z.string().trim().min(1).max(40), value: z.number(), unit: z.string().trim().max(20) }).optional(),
  }).strict(), request, response);
  if (!data) return;
  const log = insert("symptomLogs", { ...data, date: data.date ?? nowIso(), patientId: currentUser(request).id, source: "patient-reported" });
  response.status(201).json({ log, urgentGuidance: data.severity >= 9 });
});

careRouter.delete("/symptom-logs/:id", patientOnly, (request, response) => {
  const index = db.symptomLogs.findIndex((row) => row.id === param(request, "id") && row.patientId === currentUser(request).id);
  if (index < 0) return response.status(404).json({ error: "Not found." });
  db.symptomLogs.splice(index, 1);
  save();
  response.json({ ok: true });
});

export function computeAlerts(patientId: string) {
  const alerts: Array<{ level: "urgent" | "review"; message: string; rule: string }> = [];
  const logs = db.symptomLogs.filter((row) => row.patientId === patientId).sort((a, b) => a.date.localeCompare(b.date));
  const bySymptom = new Map<string, Row[]>();
  for (const log of logs) bySymptom.set(log.symptom.toLowerCase(), [...(bySymptom.get(log.symptom.toLowerCase()) ?? []), log]);
  for (const [symptom, list] of bySymptom) {
    const last = list.at(-1)!;
    if (last.severity >= 9) alerts.push({ level: "urgent", message: `You recently rated "${symptom}" at ${last.severity}/10. If this is severe or sudden, seek urgent medical care now.`, rule: "Latest severity ≥ 9" });
    const last3 = list.slice(-3);
    if (last3.length === 3 && last3.every((log) => log.severity >= 7)) alerts.push({ level: "review", message: `"${symptom}" has been rated 7 or higher in your last 3 entries. Consider booking a clinician review.`, rule: "3 consecutive severity ≥ 7" });
    else if (last3.length === 3 && last3[0].severity < last3[1].severity && last3[1].severity < last3[2].severity) alerts.push({ level: "review", message: `"${symptom}" has increased across your last 3 entries. Consider discussing this with a clinician.`, rule: "3 consecutive increases" });
  }
  return alerts;
}

careRouter.get("/health-alerts", patientOnly, (request, response) => {
  response.json({ alerts: computeAlerts(currentUser(request).id), note: "Alerts follow simple, fixed rules. They are not diagnoses or predictions." });
});

// ---------- Records and uploads ----------
const fileMagic: Record<string, number[]> = { "application/pdf": [0x25, 0x50, 0x44, 0x46], "image/png": [0x89, 0x50, 0x4e, 0x47], "image/jpeg": [0xff, 0xd8, 0xff] };

const recordSchema = z.object({
  type: z.enum(["condition", "allergy", "lab", "report", "note"]),
  title: z.string().trim().min(2).max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.string().trim().max(40).optional(), unit: z.string().trim().max(20).optional(), refRange: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
  file: z.object({ name: z.string().trim().min(1).max(120), mime: z.enum(["application/pdf", "image/png", "image/jpeg"]), data: z.string().max(2_800_000) }).optional(),
}).strict();

careRouter.get("/records", patientOnly, (request, response) => {
  const records = db.records.filter((row) => row.patientId === currentUser(request).id)
    .map(({ fileData: _d, filePath: _p, ...row }) => row).sort((a, b) => b.date.localeCompare(a.date));
  response.json({ records });
});

careRouter.post("/records", patientOnly, (request, response) => {
  const data = parseBody(recordSchema, request, response);
  if (!data) return;
  const { file, ...fields } = data;
  const row: Row = { ...fields, id: newId("rec"), patientId: currentUser(request).id, source: "patient-reported", verified: false };
  if (file) {
    const bytes = Buffer.from(file.data, "base64");
    const magic = fileMagic[file.mime];
    if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024 || !magic.every((byte, index) => bytes[index] === byte)) {
      return response.status(400).json({ error: "The file must be a valid PDF, PNG or JPEG under 2 MB." });
    }
    row.file = { name: file.name.replace(/[^\w.\- ]/g, "_"), mime: file.mime, size: bytes.length };
    if (inMemory) row.fileData = file.data;
    else { row.filePath = path.join(uploadDir, `${row.id}.bin`); fs.writeFileSync(row.filePath, bytes); }
  }
  insert("records", row);
  const { fileData: _d, filePath: _p, ...safe } = row;
  response.status(201).json({ record: safe });
});

careRouter.delete("/records/:id", patientOnly, (request, response) => {
  const index = db.records.findIndex((row) => row.id === param(request, "id") && row.patientId === currentUser(request).id);
  if (index < 0) return response.status(404).json({ error: "Not found." });
  if (db.records[index].filePath) fs.rmSync(db.records[index].filePath, { force: true });
  db.records.splice(index, 1);
  save();
  response.json({ ok: true });
});

export function doctorCanViewPatient(doctorUserId: string, patientId: string) {
  const doctor = doctorProfile(doctorUserId);
  return Boolean(doctor && db.appointments.some((a) => a.doctorId === doctor.id && a.patientId === patientId && a.status !== "cancelled" && a.shareHistory));
}

careRouter.get("/records/:id/file", requireRole("patient", "doctor"), (request, response) => {
  const record = findById("records", param(request, "id"));
  const user = currentUser(request);
  const allowed = record && record.file && (record.patientId === user.id || (user.role === "doctor" && doctorCanViewPatient(user.id, record.patientId)));
  if (!allowed) return response.status(404).json({ error: "Not found." });
  if (user.role === "doctor") audit(user.id, "record.file.view", record.id, { patientId: record.patientId });
  const bytes = record.fileData ? Buffer.from(record.fileData, "base64") : fs.readFileSync(record.filePath);
  response.setHeader("Content-Type", record.file.mime);
  response.setHeader("Content-Disposition", `attachment; filename="${record.file.name}"`);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.send(bytes);
});

// ---------- Timeline ----------
export function buildTimeline(patientId: string, onlyDoctorId?: string) {
  const items: Array<{ date: string; type: string; title: string; detail?: string; source: string; id: string }> = [];
  for (const r of db.records.filter((row) => row.patientId === patientId)) {
    const detail = r.type === "lab" ? `${r.value ?? ""} ${r.unit ?? ""}${r.refRange ? ` (ref ${r.refRange})` : ""}`.trim() : r.notes;
    items.push({ id: r.id, date: r.date, type: r.type, title: r.title, detail, source: r.source });
  }
  for (const l of db.symptomLogs.filter((row) => row.patientId === patientId)) {
    items.push({ id: l.id, date: l.date.slice(0, 10), type: "symptom", title: `${l.symptom} · ${l.severity}/10`, detail: l.notes, source: "patient-reported" });
  }
  for (const a of db.appointments.filter((row) => row.patientId === patientId && (!onlyDoctorId || row.doctorId === onlyDoctorId))) {
    items.push({ id: a.id, date: a.start.slice(0, 10), type: "appointment", title: `${a.mode === "online" ? "Online" : "In-person"} consultation with ${a.doctorName}`, detail: `Status: ${a.status}`, source: "platform" });
  }
  for (const p of db.prescriptions.filter((row) => row.patientId === patientId && (!onlyDoctorId || row.doctorId === onlyDoctorId))) {
    items.push({ id: p.id, date: p.issuedAt.slice(0, 10), type: "prescription", title: `Prescription ${p.id} (${p.status})`, detail: p.items.map((i: Row) => i.name).join(", "), source: `doctor-issued · ${p.doctorName}` });
  }
  return items.sort((a, b) => b.date.localeCompare(a.date));
}

careRouter.get("/timeline", patientOnly, (request, response) => response.json({ timeline: buildTimeline(currentUser(request).id) }));

// ---------- Appointments ----------
careRouter.post("/appointments", patientOnly, (request, response) => {
  const data = parseBody(z.object({
    slotId: idString.optional(),
    doctorId: idString.optional(),
    start: z.string().optional(),
    mode: z.enum(["online", "offline"]).optional(),
    reason: z.string().trim().min(3).max(300),
    shareHistory: z.boolean(),
  }).strict(), request, response);
  if (!data) return;

  const patient = currentUser(request);
  let slot: any;
  let doctor: any;
  let chosenMode: "online" | "offline";

  if (data.slotId) {
    slot = findById("slots", data.slotId);
    if (!slot) return response.status(404).json({ error: "That slot no longer exists." });
    doctor = findById("doctors", slot.doctorId);
    if (!doctor || doctor.verification !== "verified") return response.status(403).json({ error: "Only verified doctors can accept consultations." });
    const slotEndTime = new Date(slot.start).getTime() + (slot.durationMin || 30) * 60_000;
    if (slot.status !== "open" || slotEndTime <= Date.now()) {
      return response.status(409).json({ error: "That slot is no longer available. Please choose another." });
    }
    chosenMode = slot.mode === "both" ? (data.mode || (doctor.modes?.includes("online") ? "online" : "offline")) : (slot.mode as "online" | "offline");
    slot.status = "booked";
  } else if (data.doctorId) {
    doctor = findById("doctors", data.doctorId);
    if (!doctor || doctor.verification !== "verified") return response.status(403).json({ error: "Only verified doctors can accept consultations." });
    const start = data.start ? new Date(data.start) : new Date(Date.now() + 30 * 60_000);
    if (isNaN(start.getTime()) || start.getTime() < Date.now() - 5 * 60_000) {
      return response.status(400).json({ error: "Choose a time in the future." });
    }
    const docModes = doctor.modes ?? ["offline", "online"];
    chosenMode = data.mode && docModes.includes(data.mode) ? data.mode : (docModes.includes("online") ? "online" : "offline");
    slot = insert("slots", {
      doctorId: doctor.id,
      start: start.toISOString(),
      mode: chosenMode,
      durationMin: 30,
      status: "booked",
      patientId: patient.id,
    });
  } else {
    return response.status(400).json({ error: "Please select an available slot or doctor." });
  }

  const appointment = insert("appointments", {
    slotId: slot.id, doctorId: doctor.id, doctorUserId: doctor.userId, doctorName: doctor.name, patientId: patient.id, patientName: patient.name,
    start: slot.start, durationMin: slot.durationMin || 30, mode: chosenMode, reason: data.reason, shareHistory: data.shareHistory,
    status: "confirmed", statusHistory: [{ status: "confirmed", at: nowIso() }],
    videoLink: null, videoNote: chosenMode === "online" ? "Google Meet or video link will be arranged by doctor." : null,
  });
  slot.appointmentId = appointment.id; slot.patientId = patient.id;
  insert("consents", { patientId: patient.id, type: "doctor-history-access", doctorId: doctor.id, appointmentId: appointment.id, granted: data.shareHistory });
  notify(doctor.userId, "New appointment", `${patient.name} booked ${new Date(slot.start).toLocaleString()}.`);
  notify(patient.id, "Appointment confirmed", `With ${doctor.name} on ${new Date(slot.start).toLocaleString()}.`);
  audit(patient.id, "appointment.book", appointment.id);
  save();
  response.status(201).json({ appointment });
});

careRouter.get("/appointments", requireRole("patient", "doctor"), (request, response) => {
  const user = currentUser(request);
  const list = db.appointments.filter((a) => (user.role === "patient" ? a.patientId === user.id : a.doctorUserId === user.id))
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((a) => (user.role === "doctor" ? { ...a, patientName: a.patientName, canViewHistory: Boolean(a.shareHistory && a.status !== "cancelled") } : a));
  response.json({ appointments: list });
});

careRouter.patch("/appointments/:id", requireRole("patient", "doctor"), (request, response) => {
  const data = parseBody(z.object({ status: z.enum(["cancelled", "completed", "no_show"]) }).strict(), request, response);
  if (!data) return;
  const user = currentUser(request);
  const appt = findById("appointments", param(request, "id"));
  const owns = appt && (user.role === "patient" ? appt.patientId === user.id : appt.doctorUserId === user.id);
  if (!appt || !owns) return response.status(404).json({ error: "Not found." });
  if (appt.status !== "confirmed") return response.status(409).json({ error: `This appointment is already ${appt.status}.` });
  if (user.role === "patient" && data.status !== "cancelled") return response.status(403).json({ error: "Patients can only cancel appointments." });
  appt.status = data.status;
  appt.statusHistory.push({ status: data.status, at: nowIso(), by: user.role });
  if (data.status === "cancelled") {
    const slot = findById("slots", appt.slotId);
    if (slot) {
      const slotEndTime = new Date(slot.start).getTime() + (slot.durationMin || 30) * 60_000;
      slot.status = slotEndTime > Date.now() ? "open" : "closed";
      delete slot.appointmentId;
      delete slot.patientId;
    }
    notify(user.role === "patient" ? appt.doctorUserId : appt.patientId, "Appointment cancelled", `The appointment on ${new Date(appt.start).toLocaleString()} was cancelled.`);
  }
  audit(user.id, `appointment.${data.status}`, appt.id);
  save();
  response.json({ appointment: appt });
});

// ---------- Doctor profile, availability, patient review ----------
careRouter.get("/doctor/profile", doctorOnly, (request, response) => response.json({ profile: doctorProfile(currentUser(request).id) }));

careRouter.put("/doctor/profile", doctorOnly, (request, response) => {
  const data = parseBody(z.object({
    specialty: z.string().trim().min(2).max(80), qualifications: z.string().trim().min(2).max(200), clinic: z.string().trim().max(120),
    address: z.string().trim().max(200), placeId: z.string().trim().max(80).nullable().optional(), lat: z.number().min(-90).max(90).nullable(), lng: z.number().min(-180).max(180).nullable(),
    fee: z.number().min(0).max(1_000_000).nullable(), languages: z.array(z.string().trim().max(30)).max(10),
    modes: z.array(z.enum(["online", "offline"])).min(1),
  }).strict(), request, response);
  if (!data) return;
  const profile = doctorProfile(currentUser(request).id)!;
  Object.assign(profile, { ...data, placeId: data.placeId ?? undefined, lat: data.lat ?? undefined, lng: data.lng ?? undefined });
  audit(currentUser(request).id, "doctor.profile.update", profile.id);
  save();
  response.json({ profile });
});

careRouter.get("/doctor/slots", doctorOnly, (request, response) => {
  const doctor = doctorProfile(currentUser(request).id)!;
  response.json({ slots: db.slots.filter((s) => s.doctorId === doctor.id && new Date(s.start) > new Date(Date.now() - 86_400_000)).sort((a, b) => a.start.localeCompare(b.start)) });
});

careRouter.post("/doctor/slots", doctorOnly, requireVerified, (request, response) => {
  const data = parseBody(z.object({
    start: z.string().datetime({ offset: true }),
    mode: z.enum(["online", "offline", "both"]),
    durationMin: z.number().int().min(10).max(120).default(30),
  }).strict(), request, response);
  if (!data) return;
  const doctor = doctorProfile(currentUser(request).id)!;
  const start = new Date(data.start);
  if (start.getTime() < Date.now() - 5 * 60_000) return response.status(400).json({ error: "Choose a time in the future." });
  const docModes = doctor.modes ?? [];
  if (data.mode === "both") {
    if (!docModes.includes("online") && !docModes.includes("offline")) {
      return response.status(400).json({ error: "Enable consultation modes in your profile first." });
    }
  } else if (!docModes.includes(data.mode)) {
    return response.status(400).json({ error: `Enable ${data.mode} consultations in your profile first.` });
  }
  const end = start.getTime() + data.durationMin * 60_000;
  const clash = db.slots.some((s) => s.doctorId === doctor.id && s.status !== "closed" && new Date(s.start).getTime() < end && new Date(s.start).getTime() + s.durationMin * 60_000 > start.getTime());
  if (clash) return response.status(409).json({ error: "This overlaps an existing slot." });
  const slot = insert("slots", { doctorId: doctor.id, start: start.toISOString(), mode: data.mode, durationMin: data.durationMin, status: "open" });
  response.status(201).json({ slot });
});

careRouter.delete("/doctor/slots/:id", doctorOnly, (request, response) => {
  const doctor = doctorProfile(currentUser(request).id)!;
  const slot = db.slots.find((s) => s.id === param(request, "id") && s.doctorId === doctor.id);
  if (!slot) return response.status(404).json({ error: "Not found." });
  if (slot.status === "booked") return response.status(409).json({ error: "Cancel the appointment instead of removing a booked slot." });
  db.slots.splice(db.slots.indexOf(slot), 1);
  save();
  response.json({ ok: true });
});

careRouter.get("/doctor/patients/:patientId", doctorOnly, requireVerified, (request, response) => {
  const user = currentUser(request);
  const patientId = param(request, "patientId");
  if (!doctorCanViewPatient(user.id, patientId)) return response.status(403).json({ error: "The patient has not granted you access to their history." });
  const patient = findById("users", patientId);
  audit(user.id, "patient.history.view", patientId);
  response.json({
    patient: { id: patientId, name: patient?.name },
    timeline: buildTimeline(patientId),
    records: db.records.filter((r) => r.patientId === patientId).map((r) => ({ id: r.id, type: r.type, title: r.title, date: r.date, hasFile: Boolean(r.file) })),
    symptomLogs: db.symptomLogs.filter((l) => l.patientId === patientId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50),
  });
});

// ---------- Prescriptions ----------
const itemSchema = z.object({
  name: z.string().trim().min(2).max(120), dose: z.string().trim().min(1).max(60), route: z.string().trim().min(2).max(40),
  frequency: z.string().trim().min(2).max(80), timing: z.string().trim().max(80).optional(),
  durationDays: z.number().int().min(1).max(365), times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(8),
  instructions: z.string().trim().max(300).optional(),
}).strict();
const prescriptionSchema = z.object({ appointmentId: idString.optional(), items: z.array(itemSchema).min(1).max(20), notes: z.string().trim().max(1000).optional() }).strict();

const present = (rx: Row) => ({ ...rx, verifyPath: `/verify/${rx.id}/${signToken(rx.id)}` });

careRouter.post("/prescriptions", doctorOnly, requireVerified, (request, response) => {
  const data = parseBody(prescriptionSchema.required({ appointmentId: true }), request, response);
  if (!data) return;
  const doctor = doctorProfile(currentUser(request).id)!;
  const appt = findById("appointments", data.appointmentId);
  if (!appt || appt.doctorId !== doctor.id || !["confirmed", "completed"].includes(appt.status)) {
    return response.status(403).json({ error: "You can only prescribe within your own active or completed consultation." });
  }
  const rx = insert("prescriptions", {
    id: `RX-${newId("x").slice(2, 10).toUpperCase()}`, doctorId: doctor.id, doctorUserId: doctor.userId, doctorName: doctor.name,
    patientId: appt.patientId, patientName: appt.patientName, appointmentId: appt.id, items: data.items, notes: data.notes ?? "",
    status: "active", issuedAt: nowIso(), revisions: [],
  });
  notify(appt.patientId, "New prescription", `${doctor.name} issued prescription ${rx.id}.`);
  audit(doctor.userId, "prescription.issue", rx.id, { patientId: appt.patientId });
  response.status(201).json({ prescription: present(rx) });
});

careRouter.get("/prescriptions", requireRole("patient", "doctor"), (request, response) => {
  const user = currentUser(request);
  const list = db.prescriptions.filter((rx) => (user.role === "patient" ? rx.patientId === user.id : rx.doctorUserId === user.id))
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).map(present);
  response.json({ prescriptions: list });
});

careRouter.put("/prescriptions/:id", doctorOnly, requireVerified, (request, response) => {
  const data = parseBody(prescriptionSchema.omit({ appointmentId: true }), request, response);
  if (!data) return;
  const rx = findById("prescriptions", param(request, "id"));
  if (!rx || rx.doctorUserId !== currentUser(request).id) return response.status(404).json({ error: "Not found." });
  if (rx.status !== "active") return response.status(409).json({ error: "Revoked prescriptions cannot be edited." });
  rx.revisions.push({ at: nowIso(), items: rx.items, notes: rx.notes });
  rx.items = data.items; rx.notes = data.notes ?? "";
  notify(rx.patientId, "Prescription updated", `Prescription ${rx.id} was revised by ${rx.doctorName}. Review your reminders.`);
  audit(rx.doctorUserId, "prescription.revise", rx.id);
  save();
  response.json({ prescription: present(rx) });
});

careRouter.post("/prescriptions/:id/revoke", doctorOnly, (request, response) => {
  const data = parseBody(z.object({ reason: z.string().trim().min(3).max(300) }).strict(), request, response);
  if (!data) return;
  const rx = findById("prescriptions", param(request, "id"));
  if (!rx || rx.doctorUserId !== currentUser(request).id) return response.status(404).json({ error: "Not found." });
  if (rx.status === "revoked") return response.status(409).json({ error: "Already revoked." });
  rx.status = "revoked"; rx.revokedAt = nowIso(); rx.revokeReason = data.reason;
  for (const order of db.orders.filter((o) => o.prescriptionId === rx.id && !["delivered", "cancelled", "rejected"].includes(o.status))) {
    order.status = "cancelled"; order.history.push({ status: "cancelled", at: nowIso(), note: "Prescription revoked by issuing doctor" });
    const pharmacy = findById("pharmacies", order.pharmacyId);
    if (pharmacy) notify(pharmacy.userId, "Prescription revoked", `Order ${order.id} was cancelled because ${rx.id} was revoked.`);
  }
  notify(rx.patientId, "Prescription revoked", `${rx.id} was revoked. Contact ${rx.doctorName} for guidance; do not change treatment on your own.`);
  audit(rx.doctorUserId, "prescription.revoke", rx.id);
  save();
  response.json({ prescription: present(rx) });
});

// ---------- Dose logs ----------
careRouter.get("/dose-logs", patientOnly, (request, response) => {
  response.json({ doseLogs: db.doseLogs.filter((d) => d.patientId === currentUser(request).id).sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)) });
});

careRouter.post("/dose-logs", patientOnly, (request, response) => {
  const data = parseBody(z.object({
    prescriptionId: idString, itemIndex: z.number().int().min(0).max(19), scheduledAt: z.string().datetime({ offset: true }), status: z.enum(["taken", "skipped"]),
  }).strict(), request, response);
  if (!data) return;
  const rx = findById("prescriptions", data.prescriptionId);
  const item = rx?.items[data.itemIndex];
  if (!rx || rx.patientId !== currentUser(request).id || !item) return response.status(404).json({ error: "Not found." });
  if (rx.status !== "active") return response.status(409).json({ error: "This prescription is no longer active." });
  const when = new Date(data.scheduledAt).getTime();
  const start = new Date(rx.issuedAt).getTime() - 86_400_000, end = new Date(rx.issuedAt).getTime() + (item.durationDays + 1) * 86_400_000;
  if (when < start || when > end || when > Date.now() + 12 * 3_600_000) return response.status(400).json({ error: "That time is outside this prescription's schedule." });
  const existing = db.doseLogs.find((d) => d.prescriptionId === rx.id && d.itemIndex === data.itemIndex && d.scheduledAt === new Date(data.scheduledAt).toISOString());
  const scheduledAt = new Date(data.scheduledAt).toISOString();
  if (existing) { existing.status = data.status; existing.respondedAt = nowIso(); save(); return response.json({ doseLog: existing }); }
  const log = insert("doseLogs", { patientId: rx.patientId, prescriptionId: rx.id, itemIndex: data.itemIndex, medicine: item.name, scheduledAt, status: data.status, respondedAt: nowIso() });
  response.status(201).json({ doseLog: log });
});

// ---------- Medicine information check ----------
careRouter.post("/medicine-verification", requireRole("patient", "pharmacy"), (request, response) => {
  const data = parseBody(z.object({ productName: z.string().trim().min(2).max(120), batchNo: z.string().trim().max(60).optional(), barcode: z.string().trim().max(60).optional() }).strict(), request, response);
  if (!data) return;
  const name = data.productName.toLowerCase();
  const match = db.inventory.find((item) => item.name.toLowerCase() === name && db.pharmacies.find((p) => p.id === item.pharmacyId)?.verification === "verified");
  audit(currentUser(request).id, "medicine.check", undefined, { product: data.productName });
  response.json({
    status: match ? "details_matched" : "unable_to_verify",
    label: match ? "Details matched; authenticity not independently confirmed" : "Unable to verify",
    explanation: match
      ? "The product name matches an item listed by a verified pharmacy on Smart Diagno. No manufacturer or regulator system was consulted, so this does not confirm the item is genuine."
      : "No matching listing was found, and no manufacturer or regulator integration is configured. Ask your pharmacist or check the packaging with the manufacturer.",
    trustedSourceIntegration: false,
  });
});

// ---------- Notifications ----------
careRouter.get("/notifications", requireRole("patient", "doctor", "pharmacy", "admin"), (request, response) => {
  const list = db.notifications.filter((n) => n.userId === currentUser(request).id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  response.json({ notifications: list, channel: "in-app" });
});

careRouter.post("/notifications/read", requireRole("patient", "doctor", "pharmacy", "admin"), (request, response) => {
  for (const n of db.notifications) if (n.userId === currentUser(request).id) n.read = true;
  save();
  response.json({ ok: true });
});
