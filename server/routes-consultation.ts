import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { audit, db, findById, inMemory, insert, newId, notify, nowIso, save, uploadDir, type Row } from "./store.ts";
import { currentUser, doctorProfile, requireRole } from "./security.ts";
import { param, parseBody } from "./helpers.ts";

export const consultationRouter = Router();

const fileMagic: Record<string, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

function getAppointmentForUser(request: any, appointmentId: string) {
  const user = currentUser(request);
  const appt = findById("appointments", appointmentId);
  if (!appt) return null;

  const isPatient = user.role === "patient" && appt.patientId === user.id;
  const isDoctor = user.role === "doctor" && (appt.doctorUserId === user.id || doctorProfile(user.id)?.id === appt.doctorId);

  if (!isPatient && !isDoctor) return null;
  return { appt, user, isPatient, isDoctor };
}

function getOrCreateConsultationChat(appt: Row) {
  let chat = db.consultationChats.find((c) => c.appointmentId === appt.id);
  if (!chat) {
    chat = insert("consultationChats", {
      appointmentId: appt.id,
      patientId: appt.patientId,
      doctorId: appt.doctorId,
      doctorUserId: appt.doctorUserId,
      doctorName: appt.doctorName,
      patientName: appt.patientName,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      feeDetails: null,
      messages: [
        {
          id: newId("msg"),
          senderId: "system",
          senderRole: "system",
          senderName: "Smart Diagno",
          type: "system",
          text: `Consultation session created for ${appt.patientName} with ${appt.doctorName}. Appointment scheduled for ${new Date(appt.start).toLocaleString()}.`,
          at: nowIso(),
        },
      ],
    });
  }
  return chat;
}

function processImageUpload(fileId: string, file: { name: string; mime: "image/png" | "image/jpeg"; data: string }) {
  const cleanData = file.data.includes(",") ? file.data.split(",")[1] : file.data;
  const bytes = Buffer.from(cleanData, "base64");
  const magic = fileMagic[file.mime];

  if (bytes.length === 0 || bytes.length > 3.5 * 1024 * 1024 || !magic || !magic.every((byte, index) => bytes[index] === byte)) {
    throw new Error("File must be a valid PNG or JPEG image under 3.5 MB.");
  }

  const safeName = file.name.replace(/[^\w.\- ]/g, "_");
  const dataUrl = `data:${file.mime};base64,${cleanData}`;

  if (!inMemory) {
    const filePath = path.join(uploadDir, `${fileId}.bin`);
    fs.writeFileSync(filePath, bytes);
  }

  return {
    id: fileId,
    name: safeName,
    mime: file.mime,
    size: bytes.length,
    dataUrl,
  };
}

// Get consultation chat for an appointment
consultationRouter.get("/consultations/:appointmentId", requireRole("patient", "doctor"), (request, response) => {
  const appointmentId = param(request, "appointmentId");
  const access = getAppointmentForUser(request, appointmentId);
  if (!access) {
    return response.status(403).json({ error: "Access denied. You are not a participant in this consultation." });
  }

  const chat = getOrCreateConsultationChat(access.appt);
  response.json({
    chat,
    appointment: {
      id: access.appt.id,
      patientId: access.appt.patientId,
      patientName: access.appt.patientName,
      doctorId: access.appt.doctorId,
      doctorName: access.appt.doctorName,
      start: access.appt.start,
      durationMin: access.appt.durationMin,
      mode: access.appt.mode,
      status: access.appt.status,
      reason: access.appt.reason,
    },
  });
});

// Post a text message
consultationRouter.post("/consultations/:appointmentId/messages", requireRole("patient", "doctor"), (request, response) => {
  const appointmentId = param(request, "appointmentId");
  const access = getAppointmentForUser(request, appointmentId);
  if (!access) {
    return response.status(403).json({ error: "Access denied. You are not a participant in this consultation." });
  }

  const body = parseBody(z.object({ text: z.string().trim().min(1).max(2000) }).strict(), request, response);
  if (!body) return;

  const chat = getOrCreateConsultationChat(access.appt);
  const msg = {
    id: newId("msg"),
    senderId: access.user.id,
    senderRole: access.user.role,
    senderName: access.user.name,
    type: "text",
    text: body.text,
    at: nowIso(),
  };

  chat.messages.push(msg);
  chat.updatedAt = nowIso();
  save();

  const recipientId = access.isDoctor ? access.appt.patientId : access.appt.doctorUserId;
  notify(recipientId, `Message from ${access.user.name}`, body.text.slice(0, 80));
  audit(access.user.id, "consultation.message", appointmentId);

  response.status(201).json({ message: msg, chat });
});

// Doctor uploads QR code and fee amount
const feeRequestSchema = z.object({
  amount: z.number().int().min(1).max(1_000_000),
  note: z.string().trim().max(500).optional(),
  qrImage: z.object({
    name: z.string().trim().min(1).max(120),
    mime: z.enum(["image/png", "image/jpeg"]),
    data: z.string().max(5_000_000),
  }),
}).strict();

consultationRouter.post("/consultations/:appointmentId/fee-request", requireRole("doctor"), (request, response) => {
  const appointmentId = param(request, "appointmentId");
  const access = getAppointmentForUser(request, appointmentId);
  if (!access || !access.isDoctor) {
    return response.status(403).json({ error: "Only the assigned doctor can request fees for this appointment." });
  }

  const body = parseBody(feeRequestSchema, request, response);
  if (!body) return;

  let qrFileRecord;
  try {
    const fileId = newId("qr");
    qrFileRecord = processImageUpload(fileId, body.qrImage);
  } catch (err: any) {
    return response.status(400).json({ error: err.message || "Invalid QR image file." });
  }

  const chat = getOrCreateConsultationChat(access.appt);
  const feeDetails = {
    amount: body.amount,
    currency: "INR",
    note: body.note || "Please scan the QR code to complete payment for your consultation.",
    qrFile: qrFileRecord,
    requestedAt: nowIso(),
    status: "pending" as const,
    paymentProof: null,
    verifiedAt: null,
  };

  chat.feeDetails = feeDetails;
  const msg = {
    id: newId("msg"),
    senderId: access.user.id,
    senderRole: "doctor",
    senderName: access.user.name,
    type: "fee_request",
    text: body.note || `Consultation fee: ₹${body.amount}. Please scan the QR code to pay.`,
    feeAmount: body.amount,
    qrFile: qrFileRecord,
    at: nowIso(),
  };

  chat.messages.push(msg);
  chat.updatedAt = nowIso();
  save();

  notify(access.appt.patientId, "Doctor fee request & QR code", `${access.appt.doctorName} requested ₹${body.amount} for consultation. Please scan the QR code in your chat.`);
  audit(access.user.id, "consultation.fee_request", appointmentId, { amount: body.amount });

  response.status(201).json({ feeDetails, chat, message: msg });
});

// Patient submits payment screenshot and UTR number
const paymentProofSchema = z.object({
  utr: z.string().trim().min(4).max(64),
  note: z.string().trim().max(500).optional(),
  screenshot: z.object({
    name: z.string().trim().min(1).max(120),
    mime: z.enum(["image/png", "image/jpeg"]),
    data: z.string().max(5_000_000),
  }),
}).strict();

consultationRouter.post("/consultations/:appointmentId/payment-proof", requireRole("patient"), (request, response) => {
  const appointmentId = param(request, "appointmentId");
  const access = getAppointmentForUser(request, appointmentId);
  if (!access || !access.isPatient) {
    return response.status(403).json({ error: "Only the patient can submit payment proof for this appointment." });
  }

  const body = parseBody(paymentProofSchema, request, response);
  if (!body) return;

  let proofFileRecord;
  try {
    const fileId = newId("pay");
    proofFileRecord = processImageUpload(fileId, body.screenshot);
  } catch (err: any) {
    return response.status(400).json({ error: err.message || "Invalid payment screenshot file." });
  }

  const chat = getOrCreateConsultationChat(access.appt);
  const paymentProof = {
    utr: body.utr,
    note: body.note || "",
    screenshot: proofFileRecord,
    submittedAt: nowIso(),
  };

  if (chat.feeDetails) {
    chat.feeDetails.status = "submitted";
    chat.feeDetails.paymentProof = paymentProof;
  } else {
    chat.feeDetails = {
      amount: 0,
      currency: "INR",
      qrFile: null,
      status: "submitted",
      requestedAt: nowIso(),
      paymentProof,
      verifiedAt: null,
    };
  }

  const msg = {
    id: newId("msg"),
    senderId: access.user.id,
    senderRole: "patient",
    senderName: access.user.name,
    type: "payment_proof",
    text: `Payment proof submitted. UTR: ${body.utr}${body.note ? ` (${body.note})` : ""}`,
    paymentProof,
    at: nowIso(),
  };

  chat.messages.push(msg);
  chat.updatedAt = nowIso();
  save();

  notify(access.appt.doctorUserId, "Payment proof submitted", `${access.appt.patientName} submitted payment screenshot with UTR ${body.utr}.`);
  audit(access.user.id, "consultation.payment_proof", appointmentId, { utr: body.utr });

  response.status(201).json({ feeDetails: chat.feeDetails, chat, message: msg });
});

// Doctor verifies and confirms the payment
consultationRouter.post("/consultations/:appointmentId/verify-payment", requireRole("doctor"), (request, response) => {
  const appointmentId = param(request, "appointmentId");
  const access = getAppointmentForUser(request, appointmentId);
  if (!access || !access.isDoctor) {
    return response.status(403).json({ error: "Only the assigned doctor can verify payment for this appointment." });
  }

  const chat = getOrCreateConsultationChat(access.appt);
  if (!chat.feeDetails) {
    return response.status(400).json({ error: "No fee request or payment proof exists to verify." });
  }

  chat.feeDetails.status = "verified";
  chat.feeDetails.verifiedAt = nowIso();

  const msg = {
    id: newId("msg"),
    senderId: access.user.id,
    senderRole: "system",
    senderName: access.user.name,
    type: "payment_verified",
    text: `Payment of ₹${chat.feeDetails.amount || ""} successfully verified and confirmed by Dr. ${access.user.name}. Consultation fee received.`,
    at: nowIso(),
  };

  chat.messages.push(msg);
  chat.updatedAt = nowIso();
  save();

  notify(access.appt.patientId, "Payment verified by Doctor", `Dr. ${access.user.name} verified and confirmed your consultation fee payment.`);
  audit(access.user.id, "consultation.payment_verified", appointmentId);

  response.json({ feeDetails: chat.feeDetails, chat, message: msg });
});

// File access endpoint
consultationRouter.get("/consultations/:appointmentId/files/:fileId", requireRole("patient", "doctor"), (request, response) => {
  const appointmentId = param(request, "appointmentId");
  const fileId = param(request, "fileId");
  const access = getAppointmentForUser(request, appointmentId);
  if (!access) {
    return response.status(403).json({ error: "Access denied." });
  }

  if (inMemory) {
    const chat = getOrCreateConsultationChat(access.appt);
    let found: any = null;
    if (chat.feeDetails?.qrFile?.id === fileId) found = chat.feeDetails.qrFile;
    if (chat.feeDetails?.paymentProof?.screenshot?.id === fileId) found = chat.feeDetails.paymentProof.screenshot;
    if (!found) {
      for (const m of chat.messages) {
        if (m.qrFile?.id === fileId) { found = m.qrFile; break; }
        if (m.paymentProof?.screenshot?.id === fileId) { found = m.paymentProof.screenshot; break; }
      }
    }
    if (!found || !found.dataUrl) return response.status(404).json({ error: "File not found." });
    const parts = found.dataUrl.split(",");
    const bytes = Buffer.from(parts[1], "base64");
    response.setHeader("Content-Type", found.mime);
    response.setHeader("Content-Disposition", `inline; filename="${found.name}"`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    return response.send(bytes);
  }

  const filePath = path.join(uploadDir, `${fileId}.bin`);
  if (!fs.existsSync(filePath)) {
    return response.status(404).json({ error: "File not found." });
  }

  const bytes = fs.readFileSync(filePath);
  // Detect mime type
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const mime = isPng ? "image/png" : "image/jpeg";
  response.setHeader("Content-Type", mime);
  response.setHeader("Content-Disposition", `inline; filename="${fileId}.${isPng ? "png" : "jpg"}"`);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.send(bytes);
});
