# Smart Diagno

Healthcare navigation platform: symptom guidance (no diagnosis or prescribing), verified-doctor discovery and booking, health timeline, prescriptions, medicine reminders, and pharmacy quotes/orders. Roles: patient, doctor, pharmacy, admin.

## Run

```
npm install
npm run build
npm start          # http://localhost:3001 (API + built site)
# or: npm run dev  # server + Vite dev server
npm test           # 15 end-to-end API tests
```

Copy `.env.example` to `.env` and set values. In production set `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `SEED_DEMO=false`.

## Demo accounts (non-production only)

Password `Demo@12345`, emails `@demo.smartdiagno.test`:
`patient@`, `doctor@` (also `doctor2@`, `doctor3@`, `doctor.pending@`), `pharmacy@` (also `pharmacy.pending@`), `admin@`.

## Pages

`/` landing, `/login`, `/register`, `/doctors` public search, `/verify/:id/:token` prescription check, `/app/...` role dashboards.

## Key rules enforced on the server

- Only verified doctors can take bookings or issue prescriptions; only verified pharmacies receive prescriptions/orders.
- Doctors see patient history only with consent; prescription sharing needs explicit consent and is audited.
- Admins have no health-data endpoints; privileged actions are audit-logged.
- Reminders come only from doctor-issued prescriptions.

## Limitations

- Data is stored in a JSON file (`data/db.json`), not MongoDB; swap `server/store.ts` for Mongoose to scale.
- Gemini chat and Google sign-in need `GEMINI_API_KEY` / `GOOGLE_CLIENT_ID` and are untested without keys.
- Not implemented: email/SMS/push, video consults, payments, live delivery tracking, geocoding (manual location is lat/lng), manufacturer medicine verification, unregistered public doctor listings.
- Browser reminders may not fire when the browser or device is inactive.
- Needs legal and clinical review before any production use; no compliance is claimed.
