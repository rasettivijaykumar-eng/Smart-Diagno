import { Router } from "express";
import { z } from "zod";
import { db, findById, insert, newId, nowIso, save } from "./store.ts";
import { currentUser, distanceKm, rateLimit, requireRole } from "./security.ts";
import { param, parseBody } from "./helpers.ts";
import { buildGuidance } from "./routes-guidance.ts";
import { doctorsAtHospital, findHospitals, prioritizeHospitals } from "./routes-places.ts";

export const chatRouter = Router();
const patientOnly = requireRole("patient");

const MAX_CHATS = 50;
const MAX_MESSAGES = 200;

const mine = (request: any, id: unknown) => {
  const chat = findById("chats", id);
  return chat && chat.userId === currentUser(request).id ? chat : null;
};

// Doctors and slots change over time, so they are re-attached whenever a chat is read.
// Also validates that hospitals are strictly within the requested radius (20 km) of the user's location and prioritized by symptom severity.
async function refreshMessageHospitals(
  message: any,
  userLat: number,
  userLng: number,
  radiusKm = 20
): Promise<{ updatedMsg: any; didChange: boolean }> {
  const hospitals = message.result?.hospitals;
  if (!Array.isArray(hospitals)) return { updatedMsg: message, didChange: false };
  const severity = message.result?.severity || "mild";

  // Check if any hospital in the stored message is outside the requested radius from userLat/userLng
  const hasFarHospitals =
    hospitals.length === 0 ||
    hospitals.some((h: any) => {
      if (typeof h.lat !== "number" || typeof h.lng !== "number") return true;
      const d = distanceKm(userLat, userLng, h.lat, h.lng);
      return d > radiusKm;
    });

  let freshHospitals = hospitals;
  let didChange = false;

  if (hasFarHospitals) {
    try {
      const found = await findHospitals(userLat, userLng, radiusKm);
      freshHospitals = found.slice(0, 10);
      didChange = true;
    } catch {
      // Keep existing if lookup failed
    }
  }

  const prioritized = prioritizeHospitals(
    freshHospitals
      .map((h: any) => {
        const dist = Math.round(distanceKm(userLat, userLng, h.lat, h.lng) * 10) / 10;
        return {
          ...h,
          distanceKm: dist,
          doctors: doctorsAtHospital(h),
        };
      })
      .filter((h: any) => h.distanceKm <= radiusKm),
    severity
  );

  const updatedMsg = {
    ...message,
    result: {
      ...message.result,
      hospitals: prioritized,
      hospitalNote: prioritized.length === 0 ? "No hospitals were found within your 20 km radius." : null,
    },
  };

  return { updatedMsg, didChange };
}

chatRouter.get("/chats", patientOnly, (request, response) => {
  const chats = db.chats
    .filter((chat) => chat.userId === currentUser(request).id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(({ id, title, updatedAt, messages }) => ({ id, title, updatedAt, count: messages.length }));
  response.json({ chats });
});

chatRouter.post("/chats", patientOnly, (request, response) => {
  const owned = db.chats.filter((chat) => chat.userId === currentUser(request).id);
  if (owned.length >= MAX_CHATS) return response.status(400).json({ error: "Chat limit reached. Delete an old chat to start a new one." });
  const chat = insert("chats", { userId: currentUser(request).id, title: "New chat", updatedAt: nowIso(), messages: [] });
  response.status(201).json({ chat: { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, messages: [] } });
});

chatRouter.get("/chats/:id", patientOnly, async (request, response) => {
  const chat = mine(request, param(request, "id"));
  if (!chat) return response.status(404).json({ error: "Chat not found." });

  const latParam = Number(request.query.lat);
  const lngParam = Number(request.query.lng);
  const radiusKm = Number(request.query.radiusKm) || 20;

  // Use provided coordinates or fall back to Hyderabad
  const userLat = !isNaN(latParam) ? latParam : 17.3843;
  const userLng = !isNaN(lngParam) ? lngParam : 78.4583;

  let changed = false;
  const messages = await Promise.all(
    chat.messages.map(async (msg: any) => {
      if (msg.role !== "assistant" || !msg.result) return msg;
      const { updatedMsg, didChange } = await refreshMessageHospitals(msg, userLat, userLng, radiusKm);
      if (didChange) {
        msg.result = {
          ...msg.result,
          hospitals: updatedMsg.result.hospitals.map(({ doctors: _d, ...h }: any) => h),
          hospitalNote: updatedMsg.result.hospitalNote,
        };
        changed = true;
      }
      return updatedMsg;
    })
  );

  if (changed) {
    save();
  }

  response.json({ chat: { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, messages } });
});

// Explicit refresh of hospitals for the current chat when the patient switches area or triggers GPS
chatRouter.post("/chats/:id/refresh-hospitals", patientOnly, async (request, response) => {
  const chat = mine(request, param(request, "id"));
  if (!chat) return response.status(404).json({ error: "Chat not found." });

  const body = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radiusKm: z.number().min(1).max(50).default(20),
  }).safeParse(request.body);

  if (!body.success) return response.status(400).json({ error: "Invalid coordinates." });
  const { lat, lng, radiusKm } = body.data;

  const fresh = (await findHospitals(lat, lng, radiusKm)).slice(0, 8);
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const msg = chat.messages[i];
    if (msg.role === "assistant" && msg.result) {
      msg.result.hospitals = fresh.map(({ doctors: _d, ...h }: any) => h);
      msg.result.hospitalNote = fresh.length === 0 ? "No hospitals were found within your 20 km radius." : null;
      break;
    }
  }
  save();

  const messages = await Promise.all(
    chat.messages.map(async (msg: any) => {
      if (msg.role !== "assistant" || !msg.result) return msg;
      const { updatedMsg } = await refreshMessageHospitals(msg, lat, lng, radiusKm);
      return updatedMsg;
    })
  );

  response.json({ ok: true, messages });
});

chatRouter.delete("/chats/:id", patientOnly, (request, response) => {
  const chat = mine(request, param(request, "id"));
  if (!chat) return response.status(404).json({ error: "Chat not found." });
  db.chats.splice(db.chats.indexOf(chat), 1);
  save();
  response.json({ ok: true });
});

const messageSchema = z.object({
  concern: z.string().trim().min(2).max(500),
  urgentSymptoms: z.array(z.enum(["chest-pain", "trouble-breathing", "stroke-signs", "severe-bleeding", "loss-consciousness"])).max(5).default([]),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
}).strict();

chatRouter.post("/chats/:id/messages", patientOnly, async (request, response) => {
  const chat = mine(request, param(request, "id"));
  if (!chat) return response.status(404).json({ error: "Chat not found." });
  const data = parseBody(messageSchema, request, response);
  if (!data) return;
  if (chat.messages.length >= MAX_MESSAGES) return response.status(400).json({ error: "This chat is full. Start a new chat to continue." });
  if (!rateLimit(`chat:${currentUser(request).id}`, 30, 60_000)) return response.status(429).json({ error: "You're sending messages too quickly. Please wait a moment." });

  const history = chat.messages.filter((m: any) => m.role === "user").map((m: any) => m.text as string);
  const guidance = await buildGuidance(data, history);
  let hospitals: any[] = [];
  let hospitalNote: string | null = null;
  const userLat = typeof data.lat === "number" && !isNaN(data.lat) ? data.lat : 17.3843;
  const userLng = typeof data.lng === "number" && !isNaN(data.lng) ? data.lng : 78.4583;
  try {
    const rawHospitals = (await findHospitals(userLat, userLng, 20)).slice(0, 10).map((h) => ({ ...h, doctors: doctorsAtHospital(h) }));
    hospitals = prioritizeHospitals(rawHospitals, guidance.severity);
    if (hospitals.length === 0) hospitalNote = "No hospitals were found within your 20 km radius.";
  } catch {
    hospitalNote = "Nearby hospitals couldn't be loaded right now. Please try again shortly.";
  }

  const userMessage = { id: newId("msg"), role: "user", text: data.concern, at: nowIso() };
  const assistantMessage = { id: newId("msg"), role: "assistant", at: nowIso(), result: { ...guidance, hospitals: hospitals.map(({ doctors: _doctors, ...h }) => h), hospitalNote } };
  chat.messages.push(userMessage, assistantMessage);
  if (chat.title === "New chat") chat.title = data.concern.slice(0, 60);
  chat.updatedAt = nowIso();
  save();

  const messages = await Promise.all(
    chat.messages.map(async (msg: any) => {
      if (msg.role !== "assistant" || !msg.result) return msg;
      const { updatedMsg } = await refreshMessageHospitals(msg, userLat, userLng, 20);
      return updatedMsg;
    })
  );

  response.json({ title: chat.title, updatedAt: chat.updatedAt, messages });
});
