import crypto from "node:crypto";
import { db, findById, nowIso, save, type Row } from "./store.ts";
import { sessionSecret } from "./store.ts";

export interface GoogleCalendarTokens {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
  tokenType?: string;
  scope?: string;
  email?: string;
}

// In-memory or encrypted token store associated with doctor userId
const doctorGoogleTokens = new Map<string, GoogleCalendarTokens>();

// Simple server-side token encryption using sessionSecret
function encryptToken(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", crypto.scryptSync(sessionSecret(), "gcal_salt", 32), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptToken(encryptedString: string): string | null {
  try {
    const [ivHex, tagHex, dataHex] = encryptedString.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", crypto.scryptSync(sessionSecret(), "gcal_salt", 32), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") + decipher.final("utf8");
  } catch {
    return null;
  }
}

export function getDoctorTokens(doctorUserId: string): GoogleCalendarTokens | null {
  if (doctorGoogleTokens.has(doctorUserId)) {
    return doctorGoogleTokens.get(doctorUserId)!;
  }
  const user = findById("users", doctorUserId);
  if (user?.googleCalendarTokensEncrypted) {
    const raw = decryptToken(user.googleCalendarTokensEncrypted);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        doctorGoogleTokens.set(doctorUserId, parsed);
        return parsed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function saveDoctorTokens(doctorUserId: string, tokens: GoogleCalendarTokens): void {
  doctorGoogleTokens.set(doctorUserId, tokens);
  const user = findById("users", doctorUserId);
  if (user) {
    user.googleCalendarTokensEncrypted = encryptToken(JSON.stringify(tokens));
    user.googleCalendarConnected = true;
    user.googleCalendarConnectedAt = nowIso();
    if (tokens.email) user.googleCalendarEmail = tokens.email;
    save();
  }
}

export function clearDoctorTokens(doctorUserId: string): void {
  doctorGoogleTokens.delete(doctorUserId);
  const user = findById("users", doctorUserId);
  if (user) {
    delete user.googleCalendarTokensEncrypted;
    user.googleCalendarConnected = false;
    delete user.googleCalendarEmail;
    delete user.googleCalendarConnectedAt;
    save();
  }
}

export function isDoctorGoogleCalendarConnected(doctorUserId: string): boolean {
  return Boolean(getDoctorTokens(doctorUserId) || process.env.GOOGLE_CALENDAR_SERVICE_REFRESH_TOKEN);
}

export function getGoogleOAuthClientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3001";
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${frontendUrl}/api/doctor/google-calendar/callback`;
  return { clientId, clientSecret, redirectUri };
}

// Generate Google OAuth consent URL for doctor
export function generateDoctorAuthUrl(doctorUserId: string, returnUrl?: string): string {
  const { clientId, redirectUri } = getGoogleOAuthClientConfig();
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured in the environment.");
  }
  const statePayload = Buffer.from(JSON.stringify({ doctorUserId, returnUrl, t: Date.now() })).toString("base64url");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.events",
    access_type: "offline",
    prompt: "consent",
    state: statePayload,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Exchange authorization code for tokens
export async function exchangeCodeForTokens(code: string): Promise<GoogleCalendarTokens> {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthClientConfig();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client ID and secret must be configured.");
  }
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Failed to exchange Google OAuth code.");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiryDate: Date.now() + (data.expires_in ?? 3600) * 1000,
    tokenType: data.token_type,
    scope: data.scope,
  };
}

// Refresh Google access token if expired
async function getFreshAccessToken(tokens: GoogleCalendarTokens, doctorUserId?: string): Promise<string> {
  if (tokens.accessToken && tokens.expiryDate && tokens.expiryDate > Date.now() + 60_000) {
    return tokens.accessToken;
  }
  const refreshToken = tokens.refreshToken || process.env.GOOGLE_CALENDAR_SERVICE_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error("No refresh token available. Doctor must reconnect Google Calendar.");
  }
  const { clientId, clientSecret } = getGoogleOAuthClientConfig();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials missing.");
  }
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || "Could not refresh Google access token.");
  }
  tokens.accessToken = data.access_token;
  tokens.expiryDate = Date.now() + (data.expires_in ?? 3600) * 1000;
  if (doctorUserId) saveDoctorTokens(doctorUserId, tokens);
  return tokens.accessToken;
}

export interface GoogleMeetResult {
  meetUrl: string;
  eventId: string;
  status: "ready" | "failed" | "auth_required";
  error?: string;
}

/**
 * Creates a Google Calendar event with a Google Meet video conference
 * using the official Google Calendar API conferenceData.createRequest.
 */
export async function createGoogleMeetConference(appointment: Row): Promise<GoogleMeetResult> {
  // Idempotency: if meeting is already created and valid, return existing
  if (appointment.googleMeetUrl && appointment.meetStatus === "ready") {
    return {
      meetUrl: appointment.googleMeetUrl,
      eventId: appointment.googleEventId,
      status: "ready",
    };
  }

  // Check if mock mode is explicitly requested or when in test environment without credentials
  const isMock = process.env.GOOGLE_MEET_MOCK === "true" || process.env.NODE_ENV === "test";

  let tokens = getDoctorTokens(appointment.doctorUserId);
  const hasSystemTokens = Boolean(process.env.GOOGLE_CALENDAR_SERVICE_REFRESH_TOKEN);

  if (!tokens && !hasSystemTokens && !isMock) {
    return {
      meetUrl: "",
      eventId: "",
      status: "auth_required",
      error: "Doctor has not connected their Google Calendar account. Authorization is required to generate a Google Meet link.",
    };
  }

  // Handle mock generation for local test suite without requiring real Google Cloud keys
  if (isMock && !tokens && !hasSystemTokens) {
    const mockCode = `smd-${appointment.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3)}-${appointment.id.slice(-4)}`.toLowerCase();
    const mockUrl = `https://meet.google.com/${mockCode}`;
    const mockEventId = `gcal_evt_${appointment.id}`;
    return {
      meetUrl: mockUrl,
      eventId: mockEventId,
      status: "ready",
    };
  }

  try {
    const accessToken = await getFreshAccessToken(tokens || { accessToken: "" }, appointment.doctorUserId);
    const startIso = new Date(appointment.start).toISOString();
    const endIso = new Date(new Date(appointment.start).getTime() + (appointment.durationMin || 30) * 60_000).toISOString();

    const eventPayload = {
      summary: `Smart Diagno Consultation: Dr. ${appointment.doctorName} & ${appointment.patientName}`,
      description: `Smart Diagno Confidential Healthcare Online Consultation.\nAppointment ID: ${appointment.id}\nMode: Telehealth Online Video Consultation.`,
      start: { dateTime: startIso },
      end: { dateTime: endIso },
      conferenceData: {
        createRequest: {
          requestId: `smd_${appointment.id}_${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    };

    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventPayload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || "Google Calendar API event creation failed.");
    }

    const meetEntry = data.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video");
    const meetUrl = meetEntry?.uri || data.hangoutLink;

    if (!meetUrl) {
      throw new Error("Google Calendar created event, but no Google Meet conference URI was returned.");
    }

    return {
      meetUrl,
      eventId: data.id,
      status: "ready",
    };
  } catch (err: any) {
    console.error("Google Meet creation error:", err.message);
    return {
      meetUrl: "",
      eventId: "",
      status: "failed",
      error: err.message || "Failed to create Google Meet session.",
    };
  }
}

/**
 * Cancels or deletes the Google Calendar event if appointment is cancelled.
 */
export async function deleteGoogleMeetConference(appointment: Row): Promise<void> {
  if (!appointment.googleEventId) return;
  const tokens = getDoctorTokens(appointment.doctorUserId);
  if (!tokens) return;
  try {
    const accessToken = await getFreshAccessToken(tokens, appointment.doctorUserId);
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(appointment.googleEventId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Best effort deletion
  }
}
