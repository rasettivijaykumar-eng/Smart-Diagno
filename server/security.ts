import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db, findById, sessionSecret, type Row } from "./store.ts";

export const COOKIE = "sd_session";
const SESSION_MS = 1000 * 60 * 60 * 12;

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sign = (value: string) => crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");

export function createSessionToken(userId: string) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readSession(token: string | undefined) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
    return parsed.exp > Date.now() ? (parsed.uid as string) : null;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined) {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function setSessionCookie(response: Response, userId: string) {
  response.cookie(COOKIE, createSessionToken(userId), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: SESSION_MS, path: "/",
  });
}

export const clearSessionCookie = (response: Response) => response.clearCookie(COOKIE, { path: "/" });

export const currentUser = (request: Request) => (request as any).user as Row;

export function authenticate(request: Request, _response: Response, next: NextFunction) {
  const uid = readSession(parseCookies(request.headers.cookie)[COOKIE]);
  const user = uid ? findById("users", uid) : undefined;
  if (user && user.status !== "suspended") (request as any).user = user;
  next();
}

export function requireRole(...roles: string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const user = (request as any).user as Row | undefined;
    if (!user) return response.status(401).json({ error: "Please sign in to continue." });
    if (!roles.includes(user.role)) return response.status(403).json({ error: "You do not have access to this resource." });
    next();
  };
}

export const doctorProfile = (userId: string) => db.doctors.find((row) => row.userId === userId);
export const pharmacyProfile = (userId: string) => db.pharmacies.find((row) => row.userId === userId);

export function requireVerified(request: Request, response: Response, next: NextFunction) {
  const user = currentUser(request);
  const profile = user.role === "doctor" ? doctorProfile(user.id) : user.role === "pharmacy" ? pharmacyProfile(user.id) : null;
  if (!profile || profile.verification !== "verified") {
    return response.status(403).json({ error: "This action requires completed administrator verification." });
  }
  next();
}

// Reject cross-site state-changing requests when the browser sends an Origin header.
export function originGuard(request: Request, response: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  const origin = request.headers.origin;
  if (origin) {
    let host = "";
    try { host = new URL(origin).host; } catch { /* invalid origin */ }
    const allowed = process.env.FRONTEND_URL ? new URL(process.env.FRONTEND_URL).host : null;
    // The Vite dev proxy rewrites Host to the API port, so accept local dev origins outside production.
    const devLocal = process.env.NODE_ENV !== "production" && /^(localhost|127\.0\.0\.1):\d+$/.test(host);
    if (host !== request.headers.host && host !== allowed && !devLocal) return response.status(403).json({ error: "Cross-origin request blocked." });
  }
  next();
}

const attempts = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) { attempts.set(key, { count: 1, reset: now + windowMs }); return true; }
  entry.count += 1;
  return entry.count <= max;
}
export const clearRateLimit = (key: string) => attempts.delete(key);

export function signToken(value: string) {
  return sign(`rx:${value}`).slice(0, 24);
}

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = (n: number) => (n * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function directionsUrl(row: Row) {
  if (typeof row.lat === "number" && typeof row.lng === "number") {
    return `https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}`;
  }
  return null;
}
