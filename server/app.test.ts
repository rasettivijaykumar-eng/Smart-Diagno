import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

process.env.DATA_DIR = ":memory:";
process.env.SEED_DEMO = "false";
process.env.ADMIN_EMAIL = "admin@test.local";
process.env.ADMIN_PASSWORD = "Admin-pass-12345";
const { app } = await import("./app.ts");

let baseUrl = "";
let server: ReturnType<typeof app.listen>;
before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => server.close());

class Client {
  cookie = "";
  async call(method: string, path: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: { "content-type": "application/json", cookie: this.cookie }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    return { status: response.status, body: (await response.json().catch(() => null)) as any };
  }
}

const PASSWORD = "Str0ng-password";
const inTwoDays = () => new Date(Date.now() + 2 * 86_400_000).toISOString();

describe("Smart Diagno platform", () => {
  const patient = new Client(), other = new Client(), doctor = new Client(), pharmacy = new Client(), admin = new Client();
  let pharmacyProfileId = "", slotId = "", appointmentId = "", rxId = "", orderId = "";

  it("registers accounts, rejects weak passwords and wrong logins", async () => {
    assert.equal((await patient.call("POST", "/api/auth/register", { name: "Pat One", email: "pat@test.local", password: "short", role: "patient" })).status, 400);
    assert.equal((await patient.call("POST", "/api/auth/register", { name: "Pat One", email: "pat@test.local", password: PASSWORD, role: "patient" })).status, 201);
    assert.equal((await other.call("POST", "/api/auth/register", { name: "Pat Two", email: "pat2@test.local", password: PASSWORD, role: "patient" })).status, 201);
    assert.equal((await doctor.call("POST", "/api/auth/register", { name: "Dr Test", email: "doc@test.local", password: PASSWORD, role: "doctor", specialty: "General Physician", licenseNo: "L1", qualifications: "MBBS" })).status, 201);
    assert.equal((await pharmacy.call("POST", "/api/auth/register", { name: "Pharma", email: "ph@test.local", password: PASSWORD, role: "pharmacy", businessName: "Test Pharmacy", licenseNo: "P1", address: "Somewhere" })).status, 201);
    assert.equal((await new Client().call("POST", "/api/auth/login", { email: "pat@test.local", password: "wrong-password-1" })).status, 401);
    assert.equal((await admin.call("POST", "/api/auth/login", { email: "admin@test.local", password: "Admin-pass-12345" })).status, 200);
    // Registration can never create an elevated role.
    assert.equal((await new Client().call("POST", "/api/auth/register", { name: "Eve", email: "eve@test.local", password: PASSWORD, role: "admin" })).status, 400);
  });

  it("blocks private APIs without a session or role", async () => {
    assert.equal((await new Client().call("GET", "/api/records")).status, 401);
    assert.equal((await patient.call("GET", "/api/admin/users")).status, 403);
    assert.equal((await patient.call("GET", "/api/doctor/slots")).status, 403);
  });

  it("keeps unverified doctors out of listings and privileged actions", async () => {
    assert.equal((await new Client().call("GET", "/api/doctors")).body.doctors.length, 0);
    assert.equal((await doctor.call("POST", "/api/doctor/slots", { start: inTwoDays(), mode: "offline" })).status, 403);
  });

  it("lets only an admin verify, then exposes the doctor publicly", async () => {
    const doctorUserId = (await doctor.call("GET", "/api/me")).body.user.id;
    assert.equal((await patient.call("POST", `/api/admin/verifications/${doctorUserId}`, { decision: "verified" })).status, 403);
    assert.equal((await admin.call("POST", `/api/admin/verifications/${doctorUserId}`, { decision: "verified" })).status, 200);
    const list = (await new Client().call("GET", "/api/doctors")).body.doctors;
    assert.equal(list.length, 1);
    assert.equal(list[0].listingStatus, "registered-verified");
    const phUserId = (await pharmacy.call("GET", "/api/me")).body.user.id;
    await admin.call("POST", `/api/admin/verifications/${phUserId}`, { decision: "verified" });
    pharmacyProfileId = (await pharmacy.call("GET", "/api/pharmacy/profile")).body.profile.id;
  });

  it("requires a location for nearby search and applies the 20 km radius", async () => {
    const anon = new Client();
    assert.equal((await anon.call("GET", "/api/doctors?nearby=true")).status, 400);
    await doctor.call("PUT", "/api/doctor/profile", { specialty: "General Physician", qualifications: "MBBS", clinic: "Clinic", address: "Addr", lat: 12.9716, lng: 77.5946, fee: 400, languages: ["English"], modes: ["offline", "online"] });
    assert.equal((await anon.call("GET", "/api/doctors?nearby=true&lat=12.98&lng=77.60")).body.doctors.length, 1);
    assert.equal((await anon.call("GET", "/api/doctors?nearby=true&lat=19.07&lng=72.87")).body.doctors.length, 0);
    assert.match((await anon.call("GET", "/api/doctors?lat=12.98&lng=77.60")).body.doctors[0].directionsUrl, /google\.com\/maps\/dir/);
  });

  it("prevents double booking of a slot", async () => {
    slotId = (await doctor.call("POST", "/api/doctor/slots", { start: inTwoDays(), mode: "offline" })).body.slot.id;
    assert.equal((await doctor.call("POST", "/api/doctor/slots", { start: inTwoDays(), mode: "offline" })).status, 409);
    const book = (client: Client) => client.call("POST", "/api/appointments", { slotId, reason: "Check-up", shareHistory: false });
    const first = await book(patient);
    assert.equal(first.status, 201);
    appointmentId = first.body.appointment.id;
    assert.equal((await book(other)).status, 409);
  });

  it("supports both slot mode and direct appointment booking without predefined slots", async () => {
    // 1. Doctor creates a slot with mode "both"
    const inFiveDays = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const bothSlotRes = await doctor.call("POST", "/api/doctor/slots", { start: inFiveDays, mode: "both" });
    assert.equal(bothSlotRes.status, 201);
    assert.equal(bothSlotRes.body.slot.mode, "both");

    // 2. Patient books this slot choosing "online"
    const patientBookBoth = await patient.call("POST", "/api/appointments", {
      slotId: bothSlotRes.body.slot.id,
      mode: "online",
      reason: "Online consultation preference",
      shareHistory: false,
    });
    assert.equal(patientBookBoth.status, 201);
    assert.equal(patientBookBoth.body.appointment.mode, "online");

    // 3. Patient books directly with doctorId when no predefined slot exists
    const docProfile = (await doctor.call("GET", "/api/doctor/profile")).body.profile;
    const directStart = new Date(Date.now() + 6 * 86_400_000).toISOString();
    const directBook = await other.call("POST", "/api/appointments", {
      doctorId: docProfile.id,
      start: directStart,
      mode: "offline",
      reason: "Direct booking request",
      shareHistory: true,
    });
    assert.equal(directBook.status, 201);
    assert.equal(directBook.body.appointment.doctorId, docProfile.id);
    assert.equal(directBook.body.appointment.mode, "offline");
  });

  it("only shares patient history with explicit consent", async () => {
    const patientId = (await patient.call("GET", "/api/me")).body.user.id;
    await patient.call("POST", "/api/records", { type: "condition", title: "Asthma", date: "2024-01-01" });
    assert.equal((await doctor.call("GET", `/api/doctor/patients/${patientId}`)).status, 403);
    assert.equal((await other.call("GET", "/api/records")).body.records.length, 0);
  });

  it("validates uploads by file signature", async () => {
    const bad = await patient.call("POST", "/api/records", { type: "report", title: "Scan", date: "2024-01-01", file: { name: "x.pdf", mime: "application/pdf", data: Buffer.from("not a pdf").toString("base64") } });
    assert.equal(bad.status, 400);
    const good = await patient.call("POST", "/api/records", { type: "report", title: "Scan", date: "2024-01-01", file: { name: "x.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.4 test").toString("base64") } });
    assert.equal(good.status, 201);
    assert.equal((await other.call("GET", `/api/records/${good.body.record.id}/file`)).status, 404);
    assert.equal((await patient.call("GET", `/api/records/${good.body.record.id}/file`)).status, 200);
  });

  it("restricts prescriptions to the verified treating doctor", async () => {
    const item = { name: "Test medicine", dose: "1 unit", route: "oral", frequency: "twice daily", durationDays: 5, times: ["08:00", "20:00"] };
    assert.equal((await patient.call("POST", "/api/prescriptions", { appointmentId, items: [item] })).status, 403);
    const created = await doctor.call("POST", "/api/prescriptions", { appointmentId, items: [item] });
    assert.equal(created.status, 201);
    rxId = created.body.prescription.id;
    assert.equal((await other.call("GET", "/api/prescriptions")).body.prescriptions.length, 0);
    assert.equal((await patient.call("PUT", `/api/prescriptions/${rxId}`, { items: [item] })).status, 403);
  });

  it("records skipped doses and rejects out-of-schedule or foreign requests", async () => {
    const scheduledAt = new Date().toISOString();
    const skipped = await patient.call("POST", "/api/dose-logs", { prescriptionId: rxId, itemIndex: 0, scheduledAt, status: "skipped" });
    assert.equal(skipped.status, 201);
    assert.equal(skipped.body.doseLog.status, "skipped");
    assert.equal((await patient.call("POST", "/api/dose-logs", { prescriptionId: rxId, itemIndex: 0, scheduledAt: "2001-01-01T00:00:00Z", status: "taken" })).status, 400);
    assert.equal((await other.call("POST", "/api/dose-logs", { prescriptionId: rxId, itemIndex: 0, scheduledAt, status: "taken" })).status, 404);
  });

  it("requires consent to share, then runs the quote-to-delivery flow", async () => {
    assert.equal((await patient.call("POST", `/api/prescriptions/${rxId}/share`, { pharmacyId: pharmacyProfileId, consent: false })).status, 400);
    const shared = await patient.call("POST", `/api/prescriptions/${rxId}/share`, { pharmacyId: pharmacyProfileId, consent: true });
    assert.equal(shared.status, 201);
    orderId = shared.body.order.id;
    assert.equal((await pharmacy.call("PATCH", `/api/orders/${orderId}/status`, { status: "preparing" })).status, 409);
    assert.equal((await pharmacy.call("PATCH", `/api/orders/${orderId}/status`, { status: "under_review" })).status, 200);
    const quote = await pharmacy.call("POST", `/api/orders/${orderId}/quote`, { items: [{ name: "Test medicine", qty: 2, unitPrice: 10 }], deliveryFee: 5 });
    assert.equal(quote.body.order.quote.total, 25);
    assert.equal((await other.call("PATCH", `/api/orders/${orderId}/patient`, { action: "confirm" })).status, 404);
    assert.equal((await patient.call("PATCH", `/api/orders/${orderId}/patient`, { action: "confirm" })).status, 200);
    for (const status of ["preparing", "dispatched", "out_for_delivery", "delivered"]) {
      assert.equal((await pharmacy.call("PATCH", `/api/orders/${orderId}/status`, { status })).status, 200);
    }
  });

  it("verifies prescriptions without leaking patient data and supports revocation", async () => {
    const rx = (await patient.call("GET", "/api/prescriptions")).body.prescriptions[0];
    const anon = new Client();
    const path = `/api/verify-prescription${rx.verifyPath.replace("/verify", "")}`;
    const ok = await anon.call("GET", path);
    assert.equal(ok.body.result, "valid");
    assert.equal(JSON.stringify(ok.body).includes("Pat"), false);
    assert.equal((await anon.call("GET", `/api/verify-prescription/${rx.id}/forged`)).body.result, "invalid");
    await doctor.call("POST", `/api/prescriptions/${rxId}/revoke`, { reason: "Entered in error" });
    assert.equal((await anon.call("GET", path)).body.result, "revoked");
  });

  it("gives emergency guidance for urgent free text and never diagnoses", async () => {
    const anon = new Client();
    const urgent = await anon.call("POST", "/api/guidance", { concern: "I have crushing chest pain and feel faint" });
    assert.equal(urgent.body.kind, "urgent");
    assert.equal(urgent.body.doctors.length, 0);
    const normal = await anon.call("POST", "/api/guidance", { concern: "mild headache since morning" });
    assert.equal(normal.body.kind, "navigation");
    assert.match(normal.body.disclaimer, /No diagnosis/);
    assert.ok(normal.body.suggestedSpecialties.includes("General Physician"));
    assert.equal((await anon.call("POST", "/api/guidance", { concern: "x" })).status, 400);
  });

  it("medicine checks never claim authenticity", async () => {
    const result = await patient.call("POST", "/api/medicine-verification", { productName: "Unknown thing" });
    assert.equal(result.body.status, "unable_to_verify");
  });

  it("supports doctor-patient consultation chat with QR fee request, payment proof and verification", async () => {
    const anon = new Client();
    // Anonymous user cannot access consultation
    assert.equal((await anon.call("GET", `/api/consultations/${appointmentId}`)).status, 401);

    // Patient can access consultation and chat is initialized
    const patientChatRes = await patient.call("GET", `/api/consultations/${appointmentId}`);
    assert.equal(patientChatRes.status, 200);
    assert.ok(patientChatRes.body.chat);
    assert.equal(patientChatRes.body.chat.appointmentId, appointmentId);

    // Doctor can also access the same consultation
    const docChatRes = await doctor.call("GET", `/api/consultations/${appointmentId}`);
    assert.equal(docChatRes.status, 200);

    // Patient sends a message
    const msgRes = await patient.call("POST", `/api/consultations/${appointmentId}/messages`, { text: "Hello Doctor, I have joined the consultation." });
    assert.equal(msgRes.status, 201);
    assert.equal(msgRes.body.message.text, "Hello Doctor, I have joined the consultation.");

    // Doctor sends a reply
    const docMsgRes = await doctor.call("POST", `/api/consultations/${appointmentId}/messages`, { text: "Hello! How can I help you today?" });
    assert.equal(docMsgRes.status, 201);

    // Sample PNG header bytes for QR image and payment screenshot
    const pngSample = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]).toString("base64");

    // Doctor uploads QR code with fee amount
    const feeRes = await doctor.call("POST", `/api/consultations/${appointmentId}/fee-request`, {
      amount: 500,
      note: "Consultation fee ₹500. Please scan QR to pay.",
      qrImage: {
        name: "doctor_qr.png",
        mime: "image/png",
        data: pngSample,
      },
    });
    assert.equal(feeRes.status, 201);
    assert.equal(feeRes.body.feeDetails.amount, 500);
    assert.equal(feeRes.body.feeDetails.status, "pending");

    // Patient cannot send fee request (doctor only)
    assert.equal((await patient.call("POST", `/api/consultations/${appointmentId}/fee-request`, {
      amount: 500,
      qrImage: { name: "x.png", mime: "image/png", data: pngSample },
    })).status, 403);

    // Patient uploads payment screenshot and UTR number
    const payRes = await patient.call("POST", `/api/consultations/${appointmentId}/payment-proof`, {
      utr: "UTR123456789012",
      note: "Paid via UPI",
      screenshot: {
        name: "payment_receipt.png",
        mime: "image/png",
        data: pngSample,
      },
    });
    assert.equal(payRes.status, 201);
    assert.equal(payRes.body.feeDetails.status, "submitted");
    assert.equal(payRes.body.feeDetails.paymentProof.utr, "UTR123456789012");

    // Doctor verifies payment
    const verifyRes = await doctor.call("POST", `/api/consultations/${appointmentId}/verify-payment`);
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.feeDetails.status, "verified");

    // Chat persists for future read
    const futureRead = await patient.call("GET", `/api/consultations/${appointmentId}`);
    assert.equal(futureRead.status, 200);
    assert.equal(futureRead.body.chat.feeDetails.status, "verified");
    assert.equal(futureRead.body.chat.feeDetails.paymentProof.utr, "UTR123456789012");
    assert.ok(futureRead.body.chat.messages.length >= 5);
  });

  it("supports Google Calendar connection status and online appointment Meet lobby workflow", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";

    // Check doctor calendar status
    const statusRes = await doctor.call("GET", "/api/doctor/google-calendar/status");
    assert.equal(statusRes.status, 200);
    assert.equal(typeof statusRes.body.connected, "boolean");

    // Doctor auth url
    const authUrlRes = await doctor.call("GET", "/api/doctor/google-calendar/auth-url");
    assert.equal(authUrlRes.status, 200);
    assert.ok(authUrlRes.body.url.includes("accounts.google.com"));

    // Doctor creates an online slot and patient books it
    const onlineSlot = (await doctor.call("POST", "/api/doctor/slots", { start: new Date(Date.now() + 86400000 * 3).toISOString(), mode: "online" })).body.slot;
    const bookRes = await patient.call("POST", "/api/appointments", {
      slotId: onlineSlot.id,
      reason: "Online video consultation for persistent fever",
      shareHistory: false,
    });
    assert.equal(bookRes.status, 201);
    const onlineApptId = bookRes.body.appointment.id;

    // Doctor accepts appointment
    const acceptRes = await doctor.call("POST", `/api/appointments/${onlineApptId}/accept`);
    assert.equal(acceptRes.status, 200);
    assert.equal(acceptRes.body.appointment.status, "confirmed");

    // Check meet status from patient view
    const meetStatusRes = await patient.call("GET", `/api/appointments/${onlineApptId}/meet-status`);
    assert.equal(meetStatusRes.status, 200);
    assert.equal(meetStatusRes.body.mode, "online");
    assert.equal(meetStatusRes.body.patientReady, false);
    assert.equal(meetStatusRes.body.doctorReady, false);

    // Patient marks ready
    const pReady = await patient.call("POST", `/api/appointments/${onlineApptId}/readiness`, { ready: true });
    assert.equal(pReady.status, 200);
    assert.equal(pReady.body.patientReady, true);

    // Doctor marks ready
    const dReady = await doctor.call("POST", `/api/appointments/${onlineApptId}/readiness`, { ready: true });
    assert.equal(dReady.status, 200);
    assert.equal(dReady.body.doctorReady, true);

    // Patient sends join request notification
    const reqJoin = await patient.call("POST", `/api/appointments/${onlineApptId}/request-join`);
    assert.equal(reqJoin.status, 200);

    // Doctor marks consultation completed
    const completeRes = await doctor.call("POST", `/api/appointments/${onlineApptId}/complete-consultation`);
    assert.equal(completeRes.status, 200);
    assert.equal(completeRes.body.appointment.status, "completed");
    assert.equal(completeRes.body.lobbyStatus, "completed");
  });

  it("blocks cross-origin writes", async () => {
    const response = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 403);
  });
});
