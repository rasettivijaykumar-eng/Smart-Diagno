import { Router } from "express";
import { z } from "zod";
import { audit, db, findById, insert, save } from "./store.ts";
import {
  clearRateLimit, clearSessionCookie, currentUser, directionsUrl, distanceKm, doctorProfile, hashPassword,
  pharmacyProfile, rateLimit, requireRole, setSessionCookie, signToken, verifyPassword,
} from "./security.ts";
import { param, parseBody, publicUser } from "./helpers.ts";

export const publicRouter = Router();

const password = z.string().min(10).max(128).regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number");
const coords = { lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() };

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(120),
  password,
  role: z.enum(["patient", "doctor", "pharmacy"]),
  country: z.string().trim().min(2).max(80).optional(),
  specialty: z.string().trim().max(80).optional(),
  licenseNo: z.string().trim().max(60).optional(),
  qualifications: z.string().trim().max(200).optional(),
  clinic: z.string().trim().max(120).optional(),
  address: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().min(3).max(12).regex(/^[A-Za-z0-9 -]+$/).optional(),
  businessName: z.string().trim().max(120).optional(),
  placeId: z.string().trim().max(120).optional(),
  ...coords,
}).strict().superRefine((value, ctx) => {
  if (value.role === "doctor") for (const key of ["specialty", "qualifications"] as const) {
    if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: "Required for doctors" });
  }
  if (value.role === "pharmacy") for (const key of ["businessName", "address"] as const) {
    if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: "Required for pharmacies" });
  }
  if (value.role === "pharmacy" && !value.postalCode) {
    ctx.addIssue({ code: "custom", path: ["postalCode"], message: "Pincode / postal code is required for pharmacies" });
  }
  if (value.role === "pharmacy" && value.country === "India" && value.postalCode && !/^\d{6}$/.test(value.postalCode)) {
    ctx.addIssue({ code: "custom", path: ["postalCode"], message: "Enter a valid six-digit Indian pincode" });
  }
  if (value.role === "pharmacy" && value.postalCode && !/^[A-Za-z0-9 -]{3,12}$/.test(value.postalCode)) {
    ctx.addIssue({ code: "custom", path: ["postalCode"], message: "Enter a valid pincode / postal code" });
  }
});

publicRouter.get("/config", (_request, response) => {
  response.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    demoAccounts: db.meta.demoSeeded && process.env.SHOW_DEMO === "true" ? { password: db.meta.demoPassword, emails: db.meta.demoEmails } : null,
    integrations: { email: false, sms: false, push: false, video: false, payments: false, mapsApi: Boolean(process.env.GOOGLE_MAPS_API_KEY) },
  });
});

publicRouter.post("/auth/register", (request, response) => {
  const data = parseBody(registerSchema, request, response);
  if (!data) return;
  if (!rateLimit(`reg:${request.ip}`, 10, 60 * 60 * 1000)) return response.status(429).json({ error: "Too many sign-up attempts. Try again later." });
  if (db.users.some((user) => user.email === data.email)) return response.status(409).json({ error: "An account with this email already exists." });
  const user = insert("users", {
    name: data.name, email: data.email, role: data.role, passwordHash: hashPassword(data.password),
    status: "active", preferences: { browserNotifications: false },
  });
  if (data.role === "doctor") {
    insert("doctors", {
      userId: user.id, name: data.name, specialty: data.specialty, licenseNo: data.licenseNo || "OPTIONAL", qualifications: data.qualifications,
      clinic: data.clinic ?? "", address: data.address ?? "", placeId: data.placeId, lat: data.lat, lng: data.lng, fee: null, languages: [],
      modes: ["offline"], verification: "pending",
    });
  }
  if (data.role === "pharmacy") {
    insert("pharmacies", {
      userId: user.id, name: data.businessName, licenseNo: data.licenseNo || "OPTIONAL", address: data.address,
      postalCode: data.postalCode, placeId: data.placeId, lat: data.lat, lng: data.lng,
      hours: "", delivery: false, verification: "pending",
    });
  }
  audit(user.id, "account.register", user.id, { role: user.role });
  setSessionCookie(response, user.id);
  response.status(201).json({ user: publicUser(user) });
});

publicRouter.post("/auth/login", (request, response) => {
  const data = parseBody(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) }).strict(), request, response);
  if (!data) return;
  const key = `login:${request.ip}:${data.email}`;
  if (!rateLimit(key, 8, 15 * 60 * 1000)) return response.status(429).json({ error: "Too many attempts. Please wait 15 minutes and try again." });
  const user = db.users.find((row) => row.email === data.email);
  if (!user || !user.passwordHash || !verifyPassword(data.password, user.passwordHash)) {
    return response.status(401).json({ error: "Email or password is incorrect." });
  }
  if (user.status === "suspended") return response.status(403).json({ error: "This account is suspended. Contact support." });
  clearRateLimit(key);
  setSessionCookie(response, user.id);
  audit(user.id, "auth.login", user.id);
  response.json({ user: publicUser(user) });
});

// Google sign-in: the ID token is verified server-side and only ever creates/links patient accounts.
publicRouter.post("/auth/google", async (request, response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return response.status(503).json({ error: "Google sign-in is not configured on this server." });
  const data = parseBody(z.object({ credential: z.string().min(20).max(5000), role: z.enum(["patient", "doctor", "pharmacy"]).default("patient") }).strict(), request, response);
  if (!data) return;
  let info: Record<string, string>;
  try {
    const result = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(data.credential)}`);
    if (!result.ok) throw new Error("rejected");
    info = await result.json() as Record<string, string>;
  } catch {
    return response.status(401).json({ error: "Google sign-in could not be verified." });
  }
  if (info.aud !== clientId || info.email_verified !== "true" || !info.email) {
    return response.status(401).json({ error: "Google sign-in could not be verified." });
  }
  const email = info.email.toLowerCase();
  let user = db.users.find((row) => row.googleSub === info.sub || row.email === email);
  if (user && user.status === "suspended") return response.status(403).json({ error: "This account is suspended. Contact support." });
  if (user && user.role !== "admin" && user.role !== data.role) {
    return response.status(409).json({ error: `This Google account is already registered as a ${user.role}. Select "${user.role}" and try again.` });
  }
  if (user?.role === "admin") return response.status(403).json({ error: "Administrators must sign in with email and password." });
  if (!user) {
    const name = info.name || email;
    user = insert("users", { name, email, role: data.role, googleSub: info.sub, status: "active", preferences: {} });
    // Professional accounts stay unverified until an administrator reviews their licence.
    if (data.role === "doctor") {
      insert("doctors", { userId: user.id, name, specialty: "", licenseNo: "", qualifications: "", clinic: "", address: "", fee: null, languages: [], modes: ["offline"], verification: "pending" });
    }
    if (data.role === "pharmacy") {
      insert("pharmacies", { userId: user.id, name, licenseNo: "", address: "", hours: "", delivery: false, verification: "pending" });
    }
  } else if (!user.googleSub) { user.googleSub = info.sub; save(); }
  setSessionCookie(response, user.id);
  audit(user.id, "auth.google", user.id);
  response.json({ user: publicUser(user) });
});

publicRouter.post("/auth/logout", (_request, response) => {
  clearSessionCookie(response);
  response.json({ ok: true });
});

publicRouter.get("/me", (request, response) => {
  const user = (request as any).user;
  if (!user) return response.json({ user: null });
  const profile = user.role === "doctor" ? doctorProfile(user.id) : user.role === "pharmacy" ? pharmacyProfile(user.id) : null;
  response.json({ user: publicUser(user), profile });
});

// Discovery ---------------------------------------------------------------

function withDistance<T extends Record<string, any>>(row: T, lat?: number, lng?: number) {
  const hasPoint = lat !== undefined && lng !== undefined && typeof row.lat === "number" && typeof row.lng === "number";
  return { ...row, distanceKm: hasPoint ? Math.round(distanceKm(lat!, lng!, row.lat, row.lng) * 10) / 10 : null, directionsUrl: directionsUrl(row) };
}

const publicDoctor = (doctor: Record<string, any>) => ({
  id: doctor.id, name: doctor.name, specialty: doctor.specialty, qualifications: doctor.qualifications, clinic: doctor.clinic,
  address: doctor.address, lat: doctor.lat, lng: doctor.lng, fee: doctor.fee, languages: doctor.languages, modes: doctor.modes,
  listingStatus: "registered-verified" as const, demo: Boolean(doctor.demo),
  openSlots: db.slots.filter((slot) => slot.doctorId === doctor.id && slot.status === "open" && new Date(slot.start).getTime() + (slot.durationMin || 30) * 60_000 > Date.now()).length,
});

const searchQuery = z.object({
  specialty: z.string().trim().max(80).optional(), q: z.string().trim().max(80).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(500).default(20), nearby: z.enum(["true", "false"]).optional(),
  mode: z.enum(["online", "offline"]).optional(),
});

export function findDoctors(query: z.infer<typeof searchQuery>) {
  const text = query.q?.toLowerCase();
  let list = db.doctors.filter((doctor) => doctor.verification === "verified" && db.users.find((u) => u.id === doctor.userId)?.status !== "suspended");
  if (query.specialty) list = list.filter((doctor) => String(doctor.specialty).toLowerCase().includes(query.specialty!.toLowerCase()));
  if (text) {
    const isGeneric = text === "doctor" || text === "doctors" || text === "dr" || text === "dr." || text === "clinic" || text === "hospital";
    if (!isGeneric) {
      list = list.filter((doctor) => `${doctor.name} ${doctor.clinic} ${doctor.specialty} ${doctor.address || ""} ${doctor.qualifications || ""}`.toLowerCase().includes(text));
    }
  }
  if (query.mode) list = list.filter((doctor) => (doctor.modes ?? []).includes(query.mode));
  let result = list.map((doctor) => withDistance(publicDoctor(doctor), query.lat, query.lng));
  if (query.nearby === "true" && query.lat !== undefined && query.lng !== undefined) {
    result = result.filter((doctor) => doctor.distanceKm !== null && doctor.distanceKm <= query.radiusKm);
  }
  return result.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9) || a.name.localeCompare(b.name));
}

publicRouter.get("/doctors", (request, response) => {
  const query = searchQuery.safeParse(request.query);
  if (!query.success) return response.status(400).json({ error: "Invalid search filters." });
  if (query.data.nearby === "true" && (query.data.lat === undefined || query.data.lng === undefined)) {
    return response.status(400).json({ error: "Nearby search needs a location. Enter one manually or allow location access." });
  }
  response.json({ radiusKm: query.data.radiusKm, doctors: findDoctors(query.data) });
});

publicRouter.get("/specialties", (_request, response) => {
  const set = new Set(db.doctors.filter((doctor) => doctor.verification === "verified").map((doctor) => doctor.specialty as string));
  response.json({ specialties: [...set].sort() });
});

publicRouter.get("/doctors/:id", (request, response) => {
  const doctor = findById("doctors", param(request, "id"));
  if (!doctor || doctor.verification !== "verified") return response.status(404).json({ error: "Doctor not found." });
  response.json({ doctor: withDistance(publicDoctor(doctor)) });
});

publicRouter.get("/doctors/:id/slots", (request, response) => {
  const doctor = findById("doctors", param(request, "id"));
  if (!doctor || doctor.verification !== "verified") return response.status(404).json({ error: "Doctor not found." });
  const slots = db.slots
    .filter((slot) => slot.doctorId === doctor.id && slot.status === "open" && new Date(slot.start).getTime() + (slot.durationMin || 30) * 60_000 > Date.now())
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((slot) => ({ id: slot.id, start: slot.start, mode: slot.mode, durationMin: slot.durationMin }));
  response.json({ slots });
});

publicRouter.get("/pharmacies", (request, response) => {
  const query = z.object({
    lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().min(1).max(50).optional(),
  }).safeParse(request.query);
  if (!query.success) return response.status(400).json({ error: "Invalid location." });
  const list = db.pharmacies
    .filter((pharmacy) => pharmacy.verification === "verified")
    .map((pharmacy) => withDistance({
      id: pharmacy.id, name: pharmacy.name, address: pharmacy.address, lat: pharmacy.lat, lng: pharmacy.lng,
      hours: pharmacy.hours, delivery: pharmacy.delivery,
    }, query.data.lat, query.data.lng))
    .filter((pharmacy) => query.data.radiusKm === undefined || (
      query.data.lat !== undefined && query.data.lng !== undefined
      && typeof pharmacy.lat === "number" && typeof pharmacy.lng === "number"
      && distanceKm(query.data.lat, query.data.lng, pharmacy.lat, pharmacy.lng) <= query.data.radiusKm
    ))
    .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  response.json({ pharmacies: list });
});

// Prescription verification: status and integrity only, no patient data.
publicRouter.get("/verify-prescription/:id/:token", (request, response) => {
  const rx = findById("prescriptions", param(request, "id"));
  if (!rx || signToken(rx.id) !== param(request, "token")) return response.json({ result: "invalid", message: "Not a valid Smart Diagno prescription." });
  const doctor = findById("doctors", rx.doctorId);
  response.json({
    result: rx.status === "active" ? "valid" : "revoked", prescriptionId: rx.id, issuedAt: rx.issuedAt,
    issuer: doctor ? { name: doctor.name, verification: doctor.verification } : null, source: "platform-issued",
  });
});

publicRouter.post("/complaints", requireRole("patient", "doctor", "pharmacy"), (request, response) => {
  const data = parseBody(z.object({ subject: z.string().trim().min(3).max(120), details: z.string().trim().min(10).max(1500), targetUserId: z.string().max(60).optional() }).strict(), request, response);
  if (!data) return;
  const complaint = insert("complaints", { ...data, reporterId: currentUser(request).id, status: "open" });
  audit(currentUser(request).id, "complaint.create", complaint.id);
  response.status(201).json({ complaint });
});
