import type { Request, Response } from "express";
import type { ZodTypeAny, z } from "zod";

// Parses a request body; sends a 400 and returns null when invalid.
export function parseBody<T extends ZodTypeAny>(schema: T, request: Request, response: Response): z.infer<T> | null {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Please check the highlighted details and try again.", details: parsed.error.flatten().fieldErrors });
    return null;
  }
  return parsed.data;
}

export const publicUser = (user: Record<string, any>) => ({
  id: user.id, name: user.name, email: user.email, role: user.role, status: user.status,
  authMethod: user.googleSub ? "google" : "password", preferences: user.preferences ?? {},
});

export const param = (request: Request, name: string) => String(request.params[name] ?? "");
