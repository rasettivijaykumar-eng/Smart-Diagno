import { Router } from "express";
import { z } from "zod";
import { audit, db, findById, notify, nowIso, save, type Row } from "./store.ts";
import { currentUser, doctorProfile, requireRole } from "./security.ts";
import { param, parseBody } from "./helpers.ts";
import {
  clearDoctorTokens,
  createGoogleMeetConference,
  exchangeCodeForTokens,
  generateDoctorAuthUrl,
  getGoogleOAuthClientConfig,
  isDoctorGoogleCalendarConnected,
  saveDoctorTokens,
} from "./google-calendar.ts";

export const meetRouter = Router();

// Helper to verify participant access to appointment
function getAuthorizedAppointment(request: any, appointmentId: string) {
  const user = currentUser(request);
  const appt = findById("appointments", appointmentId);
  if (!appt) return null;

  const isPatient = user.role === "patient" && appt.patientId === user.id;
  const isDoctor = user.role === "doctor" && (appt.doctorUserId === user.id || doctorProfile(user.id)?.id === appt.doctorId);

  if (!isPatient && !isDoctor) return null;
  return { appt, user, isPatient, isDoctor };
}

// Compute consultation lobby status dynamically
export function computeLobbyStatus(appt: Row): string {
  if (appt.status === "cancelled") return "cancelled";
  if (appt.status === "rejected") return "rejected";
  if (appt.status === "completed") return "completed";
  if (appt.mode !== "online") return "offline";

  if (appt.status === "pending" || appt.status === "awaiting_confirmation") {
    return "waiting_doctor_acceptance";
  }

  if (appt.meetStatus === "preparing") return "preparing_meet";
  if (appt.meetStatus === "auth_required") return "auth_required";
  if (appt.meetStatus === "failed") return "creation_failed";

  if (appt.status === "confirmed") {
    if (appt.patientReady && appt.doctorReady) {
      return "both_ready";
    }
    if (appt.patientReady && !appt.doctorReady) {
      return "waiting_doctor";
    }
    if (!appt.patientReady && appt.doctorReady) {
      return "waiting_patient";
    }
    return "ready_to_connect";
  }

  return appt.status || "ready_to_connect";
}

// ----------------------------------------------------
// Google Calendar OAuth Management for Doctors
// ----------------------------------------------------

meetRouter.get("/doctor/google-calendar/auth-url", requireRole("doctor"), (request, response) => {
  const user = currentUser(request);
  const { clientId } = getGoogleOAuthClientConfig();
  if (!clientId) {
    return response.status(503).json({ error: "Google Calendar integration is not configured on this server (GOOGLE_CLIENT_ID missing)." });
  }
  try {
    const returnUrl = request.query.returnUrl ? String(request.query.returnUrl) : (request.headers.referer || "");
    const url = generateDoctorAuthUrl(user.id, returnUrl);
    response.json({ url });
  } catch (err: any) {
    response.status(500).json({ error: err.message || "Failed to generate Google Calendar auth URL." });
  }
});

meetRouter.get("/doctor/google-calendar/status", requireRole("doctor"), (request, response) => {
  const user = currentUser(request);
  const connected = isDoctorGoogleCalendarConnected(user.id);
  response.json({
    connected,
    email: user.googleCalendarEmail || null,
    connectedAt: user.googleCalendarConnectedAt || null,
  });
});

meetRouter.post("/doctor/google-calendar/disconnect", requireRole("doctor"), (request, response) => {
  const user = currentUser(request);
  clearDoctorTokens(user.id);
  audit(user.id, "doctor.google_calendar.disconnect", user.id);
  response.json({ ok: true, connected: false });
});

meetRouter.get("/doctor/google-calendar/callback", async (request, response) => {
  const code = String(request.query.code || "");
  const stateRaw = String(request.query.state || "");
  const error = request.query.error;

  let doctorUserId = "";
  let returnUrl = "";
  if (stateRaw) {
    try {
      const parsed = JSON.parse(Buffer.from(stateRaw, "base64url").toString());
      doctorUserId = parsed.doctorUserId || "";
      returnUrl = parsed.returnUrl || "";
    } catch {
      /* ignore invalid state */
    }
  }

  const defaultFrontend = process.env.FRONTEND_URL || "http://localhost:5174";
  const baseTarget = returnUrl || `${defaultFrontend}/app/profile`;

  if (error || !code) {
    const sep = baseTarget.includes("?") ? "&" : "?";
    return response.redirect(`${baseTarget}${sep}google_calendar_error=${encodeURIComponent(String(error || "cancelled"))}`);
  }

  try {
    if (!doctorUserId) {
      throw new Error("Invalid OAuth state parameter.");
    }

    const tokens = await exchangeCodeForTokens(code);
    saveDoctorTokens(doctorUserId, tokens);
    audit(doctorUserId, "doctor.google_calendar.connect", doctorUserId);

    const sep = baseTarget.includes("?") ? "&" : "?";
    return response.redirect(`${baseTarget}${sep}google_calendar_success=true`);
  } catch (err: any) {
    const sep = baseTarget.includes("?") ? "&" : "?";
    return response.redirect(`${baseTarget}${sep}google_calendar_error=${encodeURIComponent(err.message || "exchange_failed")}`);
  }
});

// ----------------------------------------------------
// Appointment Acceptance & Google Meet Creation
// ----------------------------------------------------

meetRouter.post("/appointments/:id/accept", requireRole("doctor"), async (request, response) => {
  const appointmentId = param(request, "id");
  const access = getAuthorizedAppointment(request, appointmentId);
  if (!access || !access.isDoctor) {
    return response.status(403).json({ error: "Only the treating doctor can accept this appointment." });
  }

  const appt = access.appt;
  if (appt.status === "cancelled" || appt.status === "rejected") {
    return response.status(409).json({ error: `Cannot accept appointment with status "${appt.status}".` });
  }

  const alreadyAccepted = appt.status === "confirmed";
  if (!alreadyAccepted) {
    appt.status = "confirmed";
    appt.statusHistory = appt.statusHistory || [];
    appt.statusHistory.push({ status: "confirmed", at: nowIso(), by: "doctor" });
  }

  // If online mode, create Google Meet conference
  if (appt.mode === "online") {
    appt.meetProvider = "google_meet";
    appt.meetStatus = "preparing";
    save();

    const meetRes = await createGoogleMeetConference(appt);
    if (meetRes.status === "ready") {
      appt.googleMeetUrl = meetRes.meetUrl;
      appt.googleEventId = meetRes.eventId;
      appt.meetStatus = "ready";
      appt.meetError = null;
      appt.videoLink = meetRes.meetUrl;
      appt.videoNote = "Google Meet conference ready. Join when both participants are ready.";
      notify(appt.patientId, "Google Meet Consultation Ready", `Dr. ${appt.doctorName} accepted your consultation. Google Meet session is prepared.`);
    } else if (meetRes.status === "auth_required") {
      appt.meetStatus = "auth_required";
      appt.meetError = meetRes.error || "Doctor Google Calendar connection required.";
      appt.videoNote = "Awaiting doctor Google Calendar connection to generate Google Meet link.";
      notify(access.user.id, "Google Calendar Authorization Required", `Please connect Google Calendar to generate Google Meet for ${appt.patientName}.`);
    } else {
      appt.meetStatus = "failed";
      appt.meetError = meetRes.error || "Google Meet generation failed.";
      appt.videoNote = "Could not generate Google Meet link automatically. Doctor can retry.";
    }
  } else {
    notify(appt.patientId, "Appointment Accepted", `Dr. ${appt.doctorName} confirmed your in-person consultation on ${new Date(appt.start).toLocaleString()}.`);
  }

  audit(access.user.id, "appointment.accept", appt.id, { mode: appt.mode, meetStatus: appt.meetStatus });
  save();

  response.json({
    appointment: appt,
    lobbyStatus: computeLobbyStatus(appt),
    googleMeetUrl: appt.googleMeetUrl,
  });
});

meetRouter.post("/appointments/:id/reject", requireRole("doctor"), (request, response) => {
  const appointmentId = param(request, "id");
  const access = getAuthorizedAppointment(request, appointmentId);
  if (!access || !access.isDoctor) {
    return response.status(403).json({ error: "Only the treating doctor can reject this appointment." });
  }

  const appt = access.appt;
  if (appt.status === "completed" || appt.status === "cancelled") {
    return response.status(409).json({ error: `Cannot reject appointment with status "${appt.status}".` });
  }

  const body = parseBody(z.object({ reason: z.string().trim().max(300).optional() }).strict(), request, response) || {};
  appt.status = "rejected";
  appt.statusHistory = appt.statusHistory || [];
  appt.statusHistory.push({ status: "rejected", at: nowIso(), by: "doctor", reason: body.reason });

  const slot = findById("slots", appt.slotId);
  if (slot) {
    const slotEndTime = new Date(slot.start).getTime() + (slot.durationMin || 30) * 60_000;
    slot.status = slotEndTime > Date.now() ? "open" : "closed";
    delete slot.appointmentId;
    delete slot.patientId;
  }

  notify(appt.patientId, "Appointment Rejected", `Dr. ${appt.doctorName} was unable to accept your appointment request${body.reason ? `: ${body.reason}` : "."} Please select another slot.`);
  audit(access.user.id, "appointment.reject", appt.id, { reason: body.reason });
  save();

  response.json({ appointment: appt, lobbyStatus: "rejected" });
});

meetRouter.post("/appointments/:id/retry-meet", requireRole("doctor", "patient"), async (request, response) => {
  const appointmentId = param(request, "id");
  const access = getAuthorizedAppointment(request, appointmentId);
  if (!access) {
    return response.status(403).json({ error: "Access denied." });
  }

  const appt = access.appt;
  if (appt.mode !== "online") {
    return response.status(400).json({ error: "Only online appointments support Google Meet." });
  }
  if (appt.status !== "confirmed") {
    return response.status(400).json({ error: "Appointment must be confirmed to create Google Meet." });
  }

  appt.meetStatus = "preparing";
  save();

  const meetRes = await createGoogleMeetConference(appt);
  if (meetRes.status === "ready") {
    appt.googleMeetUrl = meetRes.meetUrl;
    appt.googleEventId = meetRes.eventId;
    appt.meetStatus = "ready";
    appt.meetError = null;
    appt.videoLink = meetRes.meetUrl;
    notify(appt.patientId, "Google Meet Ready", `Google Meet session for your appointment with Dr. ${appt.doctorName} is ready.`);
  } else {
    appt.meetStatus = meetRes.status;
    appt.meetError = meetRes.error;
  }
  save();

  response.json({
    appointment: appt,
    lobbyStatus: computeLobbyStatus(appt),
    googleMeetUrl: appt.googleMeetUrl,
  });
});

// ----------------------------------------------------
// Consultation Lobby, Readiness & Notifications
// ----------------------------------------------------

meetRouter.get("/appointments/:id/meet-status", requireRole("patient", "doctor"), (request, response) => {
  const appointmentId = param(request, "id");
  const access = getAuthorizedAppointment(request, appointmentId);
  if (!access) {
    return response.status(403).json({ error: "Access denied to this appointment." });
  }

  const appt = access.appt;
  const lobbyStatus = computeLobbyStatus(appt);

  // Time window checks: can join 15 minutes before scheduled start until 60 minutes after duration
  const now = Date.now();
  const startMs = new Date(appt.start).getTime();
  const endMs = startMs + (appt.durationMin || 30) * 60_000 + 30 * 60_000;
  const earlyJoinWindowMs = 15 * 60_000;
  const isTimeEligible = now >= startMs - earlyJoinWindowMs && now <= endMs;
  const isEarly = now < startMs - earlyJoinWindowMs;
  const isOverdue = now > endMs;

  const bothReady = Boolean(appt.patientReady && appt.doctorReady);
  const canJoin = Boolean(appt.status === "confirmed" && appt.googleMeetUrl && appt.meetStatus === "ready" && (bothReady || appt.consultationStartedAt));

  response.json({
    appointmentId: appt.id,
    mode: appt.mode,
    status: appt.status,
    lobbyStatus,
    meetProvider: appt.meetProvider || "google_meet",
    meetStatus: appt.meetStatus || "none",
    meetError: appt.meetError || null,
    // Google Meet URL is only exposed if authenticated participant
    googleMeetUrl: appt.googleMeetUrl || null,
    start: appt.start,
    durationMin: appt.durationMin,
    patientName: appt.patientName,
    doctorName: appt.doctorName,
    patientReady: Boolean(appt.patientReady),
    patientReadyAt: appt.patientReadyAt || null,
    doctorReady: Boolean(appt.doctorReady),
    doctorReadyAt: appt.doctorReadyAt || null,
    patientRequestedJoinAt: appt.patientRequestedJoinAt || null,
    doctorRequestedJoinAt: appt.doctorRequestedJoinAt || null,
    consultationStartedAt: appt.consultationStartedAt || null,
    consultationCompletedAt: appt.consultationCompletedAt || null,
    bothReady,
    canJoin,
    isTimeEligible,
    isEarly,
    isOverdue,
    doctorGoogleConnected: isDoctorGoogleCalendarConnected(appt.doctorUserId),
  });
});

meetRouter.post("/appointments/:id/readiness", requireRole("patient", "doctor"), (request, response) => {
  const appointmentId = param(request, "id");
  const access = getAuthorizedAppointment(request, appointmentId);
  if (!access) {
    return response.status(403).json({ error: "Access denied." });
  }

  const body = parseBody(z.object({ ready: z.boolean() }).strict(), request, response);
  if (!body) return;

  const appt = access.appt;
  if (appt.status !== "confirmed") {
    return response.status(400).json({ error: "Cannot mark readiness on an unconfirmed appointment." });
  }

  if (access.isDoctor) {
    appt.doctorReady = body.ready;
    appt.doctorReadyAt = body.ready ? nowIso() : null;
  } else {
    appt.patientReady = body.ready;
    appt.patientReadyAt = body.ready ? nowIso() : null;
  }

  const lobbyStatus = computeLobbyStatus(appt);
  if (appt.patientReady && appt.doctorReady) {
    notify(appt.patientId, "Both Participants Ready", `Dr. ${appt.doctorName} is ready. You can now join your Google Meet consultation.`);
    notify(appt.doctorUserId, "Both Participants Ready", `${appt.patientName} is ready. You can now join your Google Meet consultation.`);
  }

  audit(access.user.id, "consultation.readiness", appt.id, { role: access.user.role, ready: body.ready });
  save();

  response.json({
    appointmentId: appt.id,
    patientReady: appt.patientReady,
    doctorReady: appt.doctorReady,
    lobbyStatus,
    bothReady: Boolean(appt.patientReady && appt.doctorReady),
  });
});

meetRouter.post("/appointments/:id/request-join", requireRole("patient", "doctor"), (request, response) => {
  const appointmentId = param(request, "id");
  const access = getAuthorizedAppointment(request, appointmentId);
  if (!access) {
    return response.status(403).json({ error: "Access denied." });
  }

  const appt = access.appt;
  if (appt.status !== "confirmed") {
    return response.status(400).json({ error: "Appointment must be confirmed to request join." });
  }

  if (access.isDoctor) {
    appt.doctorRequestedJoinAt = nowIso();
    appt.doctorReady = true;
    appt.doctorReadyAt = appt.doctorReadyAt || nowIso();
    notify(
      appt.patientId,
      "Doctor is Ready to Consult",
      `Your doctor Dr. ${appt.doctorName} is ready for your Smart Diagno online consultation. Open your appointment to join Google Meet.`
    );
  } else {
    appt.patientRequestedJoinAt = nowIso();
    appt.patientReady = true;
    appt.patientReadyAt = appt.patientReadyAt || nowIso();
    notify(
      appt.doctorUserId,
      "Patient is Ready to Consult",
      `Your patient ${appt.patientName} is ready for the scheduled Smart Diagno online consultation.`
    );
  }

  save();
  audit(access.user.id, "consultation.request_join", appt.id, { role: access.user.role });

  response.json({
    ok: true,
    message: access.isDoctor ? "Patient notified to join." : "Doctor requested to join.",
    doctorRequestedJoinAt: appt.doctorRequestedJoinAt,
    patientRequestedJoinAt: appt.patientRequestedJoinAt,
    lobbyStatus: computeLobbyStatus(appt),
  });
});

meetRouter.post("/appointments/:id/start-consultation", requireRole("patient", "doctor"), (request, response) => {
  const appointmentId = param(request, "id");
  const access = getAuthorizedAppointment(request, appointmentId);
  if (!access) {
    return response.status(403).json({ error: "Access denied." });
  }

  const appt = access.appt;
  if (!appt.consultationStartedAt) {
    appt.consultationStartedAt = nowIso();
    save();
  }
  response.json({ ok: true, consultationStartedAt: appt.consultationStartedAt });
});

meetRouter.post("/appointments/:id/complete-consultation", requireRole("doctor"), (request, response) => {
  const appointmentId = param(request, "id");
  const access = getAuthorizedAppointment(request, appointmentId);
  if (!access || !access.isDoctor) {
    return response.status(403).json({ error: "Only the treating doctor can complete this consultation." });
  }

  const appt = access.appt;
  appt.status = "completed";
  appt.consultationCompletedAt = nowIso();
  appt.statusHistory = appt.statusHistory || [];
  appt.statusHistory.push({ status: "completed", at: nowIso(), by: "doctor" });

  notify(appt.patientId, "Consultation Completed", `Your consultation with Dr. ${appt.doctorName} has ended. You can review prescriptions or records in your dashboard.`);
  audit(access.user.id, "consultation.complete", appt.id);
  save();

  response.json({ ok: true, appointment: appt, lobbyStatus: "completed" });
});
