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
  const patient = new Client(), other = new Client(), doctor = new Client(), pharmacy = new Client(), unverifiedPharmacy = new Client(), admin = new Client();
  let pharmacyProfileId = "", slotId = "", appointmentId = "", rxId = "", orderId = "";

  it("registers accounts, rejects weak passwords and wrong logins", async () => {
    assert.equal((await patient.call("POST", "/api/auth/register", { name: "Pat One", email: "pat@test.local", password: "short", role: "patient" })).status, 400);
    assert.equal((await patient.call("POST", "/api/auth/register", { name: "Pat One", email: "pat@test.local", password: PASSWORD, role: "patient" })).status, 201);
    assert.equal((await other.call("POST", "/api/auth/register", { name: "Pat Two", email: "pat2@test.local", password: PASSWORD, role: "patient" })).status, 201);
    assert.equal((await doctor.call("POST", "/api/auth/register", { name: "Dr Test", email: "doc@test.local", password: PASSWORD, role: "doctor", specialty: "General Physician", licenseNo: "L1", qualifications: "MBBS" })).status, 201);
    assert.equal((await pharmacy.call("POST", "/api/auth/register", { name: "Pharma", email: "ph@test.local", password: PASSWORD, role: "pharmacy", country: "India", businessName: "Test Pharmacy", licenseNo: "P1", address: "Somewhere", postalCode: "517581", placeId: "test-place", lat: 12.9716, lng: 77.5946 })).status, 201);
    assert.equal((await unverifiedPharmacy.call("POST", "/api/auth/register", { name: "Unverified Pharma", email: "unverified-ph@test.local", password: PASSWORD, role: "pharmacy", country: "India", businessName: "Unverified Pharmacy", address: "Somewhere else" })).status, 400);
    assert.equal((await unverifiedPharmacy.call("POST", "/api/auth/register", { name: "Unverified Pharma", email: "unverified-ph@test.local", password: PASSWORD, role: "pharmacy", country: "India", businessName: "Unverified Pharmacy", address: "Somewhere else", postalCode: "51758" })).status, 400);
    assert.equal((await unverifiedPharmacy.call("POST", "/api/auth/register", { name: "Unverified Pharma", email: "unverified-ph@test.local", password: PASSWORD, role: "pharmacy", country: "India", businessName: "Unverified Pharmacy", address: "Somewhere else", postalCode: "517581" })).status, 201);
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
    assert.equal((await pharmacy.call("GET", "/api/pharmacy/profile")).body.profile.postalCode, "517581");
  });

  it("keeps one saved patient-to-pharmacy conversation and notifies both participants", async () => {
    const opened = await patient.call("GET", `/api/pharmacy-chats/shop/${pharmacyProfileId}`);
    assert.equal(opened.status, 200);
    const chatId = opened.body.chat.id;
    assert.equal(opened.body.chat.messages.length, 0);
    assert.equal((await patient.call("POST", `/api/pharmacy-chats/shop/${pharmacyProfileId}/messages`, { text: "Do you have this medicine?" })).status, 201);

    const pharmacyChats = await pharmacy.call("GET", "/api/pharmacy-chats");
    assert.equal(pharmacyChats.body.chats.length, 1);
    assert.equal(pharmacyChats.body.chats[0].id, chatId);
    assert.equal(pharmacyChats.body.chats[0].unreadCount, 1);
    assert.equal((await pharmacy.call("GET", "/api/notifications")).body.notifications.some((notification: any) => notification.title === "New patient message"), true);
    assert.equal((await other.call("GET", `/api/pharmacy-chats/${chatId}`)).status, 404);
    assert.equal((await unverifiedPharmacy.call("GET", `/api/pharmacy-chats/${chatId}`)).status, 404);

    assert.equal((await pharmacy.call("POST", `/api/pharmacy-chats/${chatId}/messages`, { text: "Yes, please share the quantity you need." })).status, 201);
    const conversation = await patient.call("GET", `/api/pharmacy-chats/${chatId}`);
    assert.equal(conversation.body.chat.messages.length, 2);
    assert.equal(conversation.body.chat.messages[1].senderRole, "pharmacy");
    assert.equal((await patient.call("GET", `/api/pharmacy-chats/shop/${pharmacyProfileId}`)).body.chat.id, chatId);
    assert.equal((await patient.call("GET", "/api/pharmacy-chats")).body.chats.length, 1);
    assert.equal((await pharmacy.call("GET", "/api/pharmacy-chats/another-chat-id")).status, 404);
  });

  it("requires a location for nearby search and applies the 20 km radius", async () => {
    const anon = new Client();
    assert.equal((await anon.call("GET", "/api/doctors?nearby=true")).status, 400);
    await doctor.call("PUT", "/api/doctor/profile", { specialty: "General Physician", qualifications: "MBBS", clinic: "Clinic", address: "Addr", lat: 12.9716, lng: 77.5946, fee: 400, languages: ["English"], modes: ["offline", "online"] });
    assert.equal((await anon.call("GET", "/api/doctors?nearby=true&lat=12.98&lng=77.60")).body.doctors.length, 1);
    assert.equal((await anon.call("GET", "/api/doctors?nearby=true&lat=19.07&lng=72.87")).body.doctors.length, 0);
    assert.match((await anon.call("GET", "/api/doctors?lat=12.98&lng=77.60")).body.doctors[0].directionsUrl, /google\.com\/maps\/dir/);
    const nearbyPharmacies = await anon.call("GET", "/api/pharmacies?lat=12.98&lng=77.60&radiusKm=20");
    assert.equal(nearbyPharmacies.body.pharmacies.length, 1);
    assert.equal(nearbyPharmacies.body.pharmacies[0].id, pharmacyProfileId);
    assert.equal((await anon.call("GET", "/api/pharmacies?lat=19.07&lng=72.87&radiusKm=20")).body.pharmacies.length, 0);
  });

  it("finds map-listed pharmacies through the Nominatim fallback and enforces its radius", async () => {
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = async (input, _init) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return originalFetch(input, _init);
      providerCalls++;
      if (url.startsWith("https://nominatim.openstreetmap.org/search?")) {
        return new Response(JSON.stringify([
          {
            osm_type: "node", osm_id: 123, type: "pharmacy", name: "Nearby Pharmacy",
            lat: "17.385", lon: "78.459", display_name: "Nearby Pharmacy, Hyderabad",
            address: { road: "Main Road", city: "Hyderabad" },
          },
          {
            osm_type: "node", osm_id: 124, type: "pharmacy", name: "Far Pharmacy",
            lat: "18.2", lon: "78.459", display_name: "Far Pharmacy, Telangana",
            address: { road: "Far Road", city: "Outside radius" },
          },
          {
            osm_type: "node", osm_id: 125, type: "pharmacy", name: "",
            lat: "17.39", lon: "78.46", display_name: "Unnamed Pharmacy, Hyderabad",
            address: { road: "Nearby Road", city: "Hyderabad" },
          },
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("", { status: 503 });
    };
    try {
      const client = new Client();
      const path = "/api/places/pharmacies?lat=17.3843&lng=78.4583&radiusKm=29";
      const response = await client.call("GET", path);
      assert.equal(response.status, 200);
      assert.equal(response.body.mapListingsAvailable, true);
      assert.equal(typeof response.body.googlePlacesConfigured, "boolean");
      assert.equal(response.body.shops.length, 2);
      assert.equal(response.body.shops[0].name, "Nearby Pharmacy");
      assert.equal(response.body.shops[0].source, "openstreetmap");
      assert.equal(response.body.shops[1].name, "Unnamed Pharmacy");
      const defaultRadius = await client.call("GET", "/api/places/pharmacies?lat=17.3843&lng=78.4583");
      assert.equal(defaultRadius.body.radiusKm, 29);
      assert.equal(defaultRadius.body.shops.length, 2);
      const callsAfterInitialSearch = providerCalls;
      assert.equal((await client.call("GET", path)).body.shops.length, 2);
      assert.equal(providerCalls, callsAfterInitialSearch);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("limits pharmacy registration results to the selected village and postal code", async () => {
    const originalFetch = globalThis.fetch;
    const originalMapsKey = process.env.GOOGLE_MAPS_API_KEY;
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return originalFetch(input, init);
      if (url.startsWith("https://nominatim.openstreetmap.org/search?")) {
        const params = new URL(url).searchParams;
        assert.match(params.get("q") ?? "", /Narayanavanam.*India/);
        assert.doesNotMatch(params.get("q") ?? "", /517581/);
        return new Response(JSON.stringify([{
          lat: "13.4251452",
          lon: "79.5875358",
          display_name: "Narayanavanam, Tirupati, Andhra Pradesh, 517581, India",
          address: { postcode: "517581" },
          boundingbox: ["13.40", "13.45", "79.55", "79.62"],
        }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("https://places.googleapis.com/v1/places:searchNearby")) {
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body.includedTypes, ["pharmacy"]);
        assert.ok(body.locationRestriction.circle.radius >= 100);
        assert.ok(body.locationRestriction.circle.radius < 50_000);
        assert.deepEqual(body.locationRestriction.circle.center, { latitude: 13.4251452, longitude: 79.5875358 });
        assert.match(String((init?.headers as Record<string, string>)["X-Goog-FieldMask"]), /places\.primaryType/);
        assert.match(String((init?.headers as Record<string, string>)["X-Goog-FieldMask"]), /places\.addressComponents/);
        return new Response(JSON.stringify({
          places: [
            { id: "local-google", primaryType: "pharmacy", types: ["pharmacy", "store"], displayName: { text: "Google Local Pharmacy" }, formattedAddress: "Narayanavanam, Andhra Pradesh 517581, India", addressComponents: [{ longText: "517581", types: ["postal_code"] }], location: { latitude: 13.42, longitude: 79.58 } },
            { id: "wrong-postal", primaryType: "pharmacy", types: ["pharmacy"], displayName: { text: "Wrong Postal Pharmacy" }, formattedAddress: "Narayanavanam, Andhra Pradesh 517502, India", addressComponents: [{ longText: "517502", types: ["postal_code"] }], location: { latitude: 13.42, longitude: 79.58 } },
            { id: "outside", primaryType: "pharmacy", types: ["pharmacy"], displayName: { text: "Outside Village Pharmacy" }, formattedAddress: "Andhra Pradesh 517581, India", addressComponents: [{ longText: "517581", types: ["postal_code"] }], location: { latitude: 13.50, longitude: 79.58 } },
            { id: "clinic", primaryType: "medical_clinic", types: ["medical_clinic", "pharmacy"], displayName: { text: "Dr. Raju Pharmacy and Clinic" }, formattedAddress: "Narayanavanam, Andhra Pradesh 517581, India", addressComponents: [{ longText: "517581", types: ["postal_code"] }], location: { latitude: 13.42, longitude: 79.58 } },
            { id: "bricks", primaryType: "hardware_store", types: ["hardware_store"], displayName: { text: "K.C. Babu Bricks" }, formattedAddress: "Narayanavanam, Andhra Pradesh 517581, India", addressComponents: [{ longText: "517581", types: ["postal_code"] }], location: { latitude: 13.42, longitude: 79.58 } },
            { id: "misclassified-bricks", primaryType: "pharmacy", types: ["pharmacy"], displayName: { text: "K.C. Babu Bricks" }, formattedAddress: "Narayanavanam, Andhra Pradesh 517581, India", addressComponents: [{ longText: "517581", types: ["postal_code"] }], location: { latitude: 13.42, longitude: 79.58 } },
            { id: "misclassified-palace", primaryType: "pharmacy", types: ["pharmacy"], displayName: { text: "Bhaskar Palace" }, formattedAddress: "Narayanavanam, Andhra Pradesh 517581, India", addressComponents: [{ longText: "517581", types: ["postal_code"] }], location: { latitude: 13.42, longitude: 79.58 } },
            { id: "postal-missing", primaryType: "pharmacy", types: ["pharmacy"], displayName: { text: "Pharmacy Without Listed Pincode" }, formattedAddress: "Narayanavanam, Andhra Pradesh, India", location: { latitude: 13.42, longitude: 79.58 } },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("https://places.googleapis.com/v1/places:searchText")) {
        const body = JSON.parse(String(init?.body));
        assert.match(body.textQuery, /517581/);
        assert.match(body.textQuery, /Narayanavanam/);
        assert.equal(body.strictTypeFiltering, true);
        const extra = body.textQuery.startsWith("medical store")
          ? [{ id: "text-medicals", primaryType: "pharmacy", displayName: { text: "Pin Medical Store" }, formattedAddress: "Narayanavanam, Andhra Pradesh 517581", addressComponents: [{ longText: "517581", types: ["postal_code"] }], location: { latitude: 13.421, longitude: 79.581 } }]
          : [];
        return new Response(JSON.stringify({
          places: [
            { id: "local-google", primaryType: "pharmacy", displayName: { text: "Google Local Pharmacy" }, formattedAddress: "Narayanavanam, Andhra Pradesh 517581, India", addressComponents: [{ longText: "517581", types: ["postal_code"] }], location: { latitude: 13.42, longitude: 79.58 } },
            ...extra,
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("https://overpass-api.de/") || url.startsWith("https://overpass.kumi.systems/")) {
        return new Response(JSON.stringify({ elements: [
          { type: "node", id: 1, lat: 13.42, lon: 79.58, tags: { name: "Local Medicals", amenity: "pharmacy", "addr:postcode": "517581" } },
          { type: "node", id: 2, lat: 13.42, lon: 79.58, tags: { name: "Other Postal Area Pharmacy", amenity: "pharmacy", "addr:postcode": "517502" } },
          { type: "node", id: 3, lat: 13.50, lon: 79.58, tags: { name: "Outside Village Pharmacy", amenity: "pharmacy", "addr:postcode": "517581" } },
          { type: "node", id: 4, lat: 13.42, lon: 79.58, tags: { name: "Similar Postal Code Pharmacy", amenity: "pharmacy", "addr:postcode": "5175811" } },
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("", { status: 503 });
    };
    try {
      await pharmacy.call("PUT", "/api/pharmacy/profile", { name: "Test Pharmacy", address: "Narayanavanam, Tirupati, Andhra Pradesh 517581", hours: "", delivery: false, lat: 13.422, lng: 79.582 });
      await unverifiedPharmacy.call("PUT", "/api/pharmacy/profile", { name: "Unverified Pharmacy", address: "Narayanavanam, Tirupati, Andhra Pradesh 517581", hours: "", delivery: false, lat: 13.423, lng: 79.583 });
      const client = new Client();
      assert.equal((await client.call("GET", "/api/places/pharmacies/search?country=India&state=Andhra%20Pradesh&district=Tirupati&village=Narayanavanam")).status, 400);
      assert.equal((await client.call("GET", "/api/places/pharmacies/search?country=India&state=Andhra%20Pradesh&district=Tirupati&village=Narayanavanam&postalCode=51758")).status, 400);
      const result = await client.call("GET", "/api/places/pharmacies/search?country=India&state=Andhra%20Pradesh&district=Tirupati&village=Narayanavanam&postalCode=517581");
      assert.equal(result.status, 200);
      assert.equal(result.body.center.lat, 13.4251452);
      assert.equal(result.body.mapListingsAvailable, true);
      assert.deepEqual(result.body.providers, { googlePlaces: "available", googleNearby: "available", googleTextSearch: "available", openStreetMap: "available" });
      assert.deepEqual(result.body.shops.map((shop: any) => shop.name), [
        "Test Pharmacy",
        "Unverified Pharmacy",
        "Google Local Pharmacy",
        "Dr. Raju Pharmacy and Clinic",
        "Pin Medical Store",
        "Local Medicals",
      ]);
      assert.equal(result.body.shops.find((shop: any) => shop.id === pharmacyProfileId).orderable, true);
      assert.equal(result.body.shops.find((shop: any) => shop.name === "Unverified Pharmacy").orderable, false);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalMapsKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
      else process.env.GOOGLE_MAPS_API_KEY = originalMapsKey;
    }
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

  it("supports consented medicine requests and privately serves validated attachments", async () => {
    const unverifiedId = (await unverifiedPharmacy.call("GET", "/api/pharmacy/profile")).body.profile.id;
    const unverified = await patient.call("POST", "/api/orders", { pharmacyId: unverifiedId, medicineRequests: ["Pain relief tablets"], consent: true });
    assert.equal(unverified.status, 403);

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]).toString("base64");
    const invalid = await patient.call("POST", "/api/orders", {
      pharmacyId: pharmacyProfileId, medicineRequests: ["Pain relief tablets"],
      attachments: [{ name: "invalid.png", mime: "image/png", data: Buffer.from("not a png").toString("base64") }],
      consent: true,
    });
    assert.equal(invalid.status, 400);

    const created = await patient.call("POST", "/api/orders", {
      pharmacyId: pharmacyProfileId, medicineRequests: ["Pain relief tablets", "Vitamin D"],
      attachments: [{ name: "report.png", mime: "image/png", data: png }], consent: true,
    });
    assert.equal(created.status, 201);
    const request = created.body.order;
    assert.equal(request.prescription, null);
    assert.deepEqual(request.medicineRequests, ["Pain relief tablets", "Vitamin D"]);
    assert.equal(request.attachments.length, 1);
    assert.equal(JSON.stringify(request).includes(png), false);
    const filePath = request.attachments[0].url;
    assert.equal((await other.call("GET", filePath)).status, 404);
    assert.equal((await patient.call("GET", filePath)).status, 200);
    assert.equal((await pharmacy.call("GET", filePath)).status, 200);

    assert.equal((await pharmacy.call("PATCH", `/api/orders/${request.id}/status`, { status: "under_review" })).status, 200);
    const quote = await pharmacy.call("POST", `/api/orders/${request.id}/quote`, { items: [{ name: "Pain relief tablets", qty: 1, unitPrice: 12 }], deliveryFee: 3 });
    assert.equal(quote.status, 200);
    assert.equal(quote.body.order.quote.total, 15);
    assert.equal((await patient.call("PATCH", `/api/orders/${request.id}/patient`, { action: "confirm" })).status, 200);

    const attachmentOnly = await patient.call("POST", "/api/orders", {
      pharmacyId: pharmacyProfileId,
      attachments: [{ name: "report.png", mime: "image/png", data: png }], consent: true,
    });
    assert.equal(attachmentOnly.status, 201);
    assert.equal((await pharmacy.call("POST", `/api/orders/${attachmentOnly.body.order.id}/quote`, {
      items: [{ name: "Recommended medicine", qty: 1, unitPrice: 8 }],
    })).status, 200);
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
