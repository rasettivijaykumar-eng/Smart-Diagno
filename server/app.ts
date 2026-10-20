import fs from "node:fs";
import path from "node:path";
import express from "express";
import { authenticate, originGuard } from "./security.ts";
import { publicRouter } from "./routes-public.ts";
import { guidanceRouter } from "./routes-guidance.ts";
import { careRouter } from "./routes-care.ts";
import { pharmacyRouter } from "./routes-pharmacy.ts";
import { adminRouter } from "./routes-admin.ts";
import { placesRouter } from "./routes-places.ts";
import { chatRouter } from "./routes-chat.ts";
import { consultationRouter } from "./routes-consultation.ts";
import { meetRouter } from "./routes-meet.ts";
import { ensureAdmin, seedDemo } from "./seed.ts";

ensureAdmin();
seedDemo();

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  next();
});
app.use("/api", (_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
app.use("/api/records", express.json({ limit: "3mb" }));
app.use("/api/consultations", express.json({ limit: "6mb" }));
app.use(express.json({ limit: "16kb" }));
app.use(originGuard);
app.use(authenticate);

app.get("/health", (_request, response) => {
  response.json({ status: "ok", integrations: "not-configured" });
});

app.use("/api", publicRouter);
app.use("/api", guidanceRouter);
app.use("/api", placesRouter);
app.use("/api", chatRouter);
app.use("/api", consultationRouter);
app.use("/api", meetRouter);
app.use("/api", careRouter);
app.use("/api", pharmacyRouter);
app.use("/api", adminRouter);
app.use("/api", (_request, response) => response.status(404).json({ error: "Not found" }));

// Serve the built frontend when present (npm run build && npm start).
const dist = path.resolve("dist");
if (fs.existsSync(path.join(dist, "index.html"))) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_request, response) => response.sendFile(path.join(dist, "index.html")));
}

app.use((_request, response) => response.status(404).json({ error: "Not found" }));

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof SyntaxError) return response.status(400).json({ error: "Invalid JSON request." });
  if ((error as any)?.type === "entity.too.large") return response.status(413).json({ error: "Request is too large." });
  console.error("Request failed", error instanceof Error ? error.message : "Unknown error");
  return response.status(500).json({ error: "Something went wrong. Please try again." });
});
