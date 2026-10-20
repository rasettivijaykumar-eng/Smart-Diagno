import { db, insert, save } from "./store.ts";
import { hashPassword } from "./security.ts";

const DEMO_PASSWORD = "Demo@12345";

export function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  // Remove duplicate admin accounts – keep only the most recent one
  const adminAccounts = db.users.filter((u) => u.role === "admin" && u.email === email);
  if (adminAccounts.length > 1) {
    adminAccounts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const keepId = adminAccounts[0].id;
    db.users = db.users.filter((u) => !(u.role === "admin" && u.email === email && u.id !== keepId));
    save();
    console.log(`Removed ${adminAccounts.length - 1} duplicate administrator account(s).`);
  }

  if (!db.users.some((u) => u.email === email)) {
    insert("users", { name: "Administrator", email, role: "admin", passwordHash: hashPassword(password), status: "active", preferences: {} });
    console.log(`Created administrator account ${email}`);
  }
}

// Fictitious demo accounts and listings for local exploration only. Never created in production or when MongoDB is configured.
export function seedDemo() {
  // Never seed demo data when MongoDB is connected – MongoDB is the real database.
  if (process.env.MONGODB_URI) return;
  if (process.env.NODE_ENV === "production" || process.env.SEED_DEMO === "false" || db.users.length > 0 || db.meta.demoSeeded) return;
  const mk = (name: string, email: string, role: string) =>
    insert("users", { name, email, role, passwordHash: hashPassword(DEMO_PASSWORD), status: "active", preferences: {} });
  mk("Demo Admin", "admin@demo.smartdiagno.test", "admin");
  mk("Demo Patient", "patient@demo.smartdiagno.test", "patient");

  const doctors = [
    ["Dr. Arvind Rao", "doctor@demo.smartdiagno.test", "General Physician", "Nizam's Institute of Medical Sciences (NIMS)", 17.4222, 78.4518, ["online", "offline"]],
    ["Dr. S. Iyer", "doctor2@demo.smartdiagno.test", "Dermatology", "CARE Hospitals Banjara Hills", 17.4125, 78.4486, ["offline"]],
    ["Dr. K. Mehta", "doctor3@demo.smartdiagno.test", "Cardiology", "Continental Hospitals Gachibowli", 17.4173, 78.3489, ["online", "offline"]],
  ] as const;
  for (const [name, email, specialty, clinic, lat, lng, modes] of doctors) {
    const user = mk(name, email, "doctor");
    const doctor = insert("doctors", {
      userId: user.id, name, specialty, licenseNo: "DEMO-0000", qualifications: "Demo qualification (fictitious)", clinic: `${clinic} (fictitious)`,
      address: "Demo address — not a real location", lat, lng, fee: 500, languages: ["English"], modes: [...modes], verification: "verified", demo: true,
    });
    for (let day = 1; day <= 5; day++) for (const hour of [10, 10.5, 11]) {
      const start = new Date();
      start.setDate(start.getDate() + day);
      start.setHours(Math.floor(hour), (hour % 1) * 60, 0, 0);
      insert("slots", { doctorId: doctor.id, start: start.toISOString(), mode: modes[0] === "online" && hour === 11 ? "online" : "offline", durationMin: 30, status: "open" });
    }
  }
  insert("doctors", {
    userId: mk("Demo Dr. Pending", "doctor.pending@demo.smartdiagno.test", "doctor").id, name: "Demo Dr. Pending", specialty: "Pediatrics", licenseNo: "DEMO-PENDING",
    qualifications: "Awaiting review", clinic: "", address: "", fee: null, languages: [], modes: ["offline"], verification: "pending", demo: true,
  });

  const pharmacy = insert("pharmacies", {
    userId: mk("Demo Pharmacy Owner", "pharmacy@demo.smartdiagno.test", "pharmacy").id, name: "Demo Pharmacy (fictitious)", licenseNo: "DEMO-PH-0000",
    address: "Demo address — not a real location", lat: 12.9784, lng: 77.6408, hours: "09:00–21:00", delivery: true, verification: "verified", demo: true,
  });
  for (const [name, price, stock] of [["Demo Paracetamol 500 mg tablets", 20, 100], ["Demo Amoxicillin 500 mg capsules", 80, 40], ["Demo Oral rehydration salts", 15, 60]] as const) {
    insert("inventory", { pharmacyId: pharmacy.id, name, price, stock, prescriptionOnly: name.includes("Amoxicillin") });
  }
  insert("pharmacies", {
    userId: mk("Demo Pending Pharmacy", "pharmacy.pending@demo.smartdiagno.test", "pharmacy").id, name: "Demo Pending Pharmacy", licenseNo: "DEMO-PENDING",
    address: "Pending", hours: "", delivery: false, verification: "pending", demo: true,
  });
  db.meta.demoSeeded = true;
  db.meta.demoPassword = DEMO_PASSWORD;
  db.meta.demoEmails = {
    patient: "patient@demo.smartdiagno.test", doctor: "doctor@demo.smartdiagno.test", pharmacy: "pharmacy@demo.smartdiagno.test", admin: "admin@demo.smartdiagno.test",
  };
  save();
  console.log("Seeded fictitious demo accounts (password: Demo@12345). Not for production.");
}
