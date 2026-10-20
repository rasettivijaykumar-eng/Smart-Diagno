import { useEffect, useState, type ReactNode } from "react";
import { Bell, Boxes, CalendarDays, ClipboardList, FileText, HeartPulse, Home, LogOut, MessageCircleHeart, MessageSquare, Pill, Settings, ShieldCheck, ShoppingBag, Stethoscope, Store, Users, Flag, ScrollText, Clock, UserCog } from "lucide-react";
import { get, post } from "./api";
import { AdminOverview, AuditLog, Complaints, Users as AdminUsers, Verifications } from "./Admin";
import { AuthPage } from "./AuthPage";
import { Availability, DoctorAppointments, DoctorOverview, DoctorPrescriptions, DoctorProfile } from "./Doctor";
import { Landing, Brand } from "./Landing";
import { Appointments, Assistant, Health, Medicines, Orders, PatientDoctors, PatientOverview, PatientSettings } from "./Patient";
import { Inventory, PharmacyOrders, PharmacyOverview, PharmacyProfile } from "./Pharmacy";
import { PharmacyChats } from "./PharmacyChat";
import { PublicDoctors, VerifyPrescription } from "./PublicPages";
import { useAuth } from "./auth";
import { Link, navigate, useLocation } from "./router";
import { Alert, Badge, humanize, Loading, fmtDateTime, useLoad } from "./ui";

type Section = { path: string; label: string; icon: ReactNode };
const nav: Record<string, Section[]> = {
  patient: [
    { path: "", label: "Overview", icon: <Home size={18} /> }, { path: "assistant", label: "Assistant", icon: <MessageCircleHeart size={18} /> },
    { path: "doctors", label: "Doctors", icon: <Stethoscope size={18} /> }, { path: "appointments", label: "Appointments", icon: <CalendarDays size={18} /> },
    { path: "health", label: "Health", icon: <HeartPulse size={18} /> }, { path: "medicines", label: "Medicines", icon: <Pill size={18} /> },
    { path: "orders", label: "Orders", icon: <ShoppingBag size={18} /> }, { path: "settings", label: "Settings", icon: <Settings size={18} /> },
  ],
  doctor: [
    { path: "", label: "Overview", icon: <Home size={18} /> }, { path: "appointments", label: "Appointments", icon: <CalendarDays size={18} /> },
    { path: "availability", label: "Availability", icon: <Clock size={18} /> }, { path: "prescriptions", label: "Prescriptions", icon: <FileText size={18} /> },
    { path: "profile", label: "Profile", icon: <UserCog size={18} /> },
  ],
  pharmacy: [
    { path: "", label: "Overview", icon: <Home size={18} /> }, { path: "orders", label: "Orders", icon: <ShoppingBag size={18} /> },
    { path: "messages", label: "Messages", icon: <MessageSquare size={18} /> },
    { path: "inventory", label: "Inventory", icon: <Boxes size={18} /> }, { path: "profile", label: "Shop", icon: <Store size={18} /> },
  ],
  admin: [
    { path: "", label: "Overview", icon: <Home size={18} /> }, { path: "verifications", label: "Verification", icon: <ShieldCheck size={18} /> },
    { path: "users", label: "Users", icon: <Users size={18} /> }, { path: "complaints", label: "Complaints", icon: <Flag size={18} /> },
    { path: "audit", label: "Audit", icon: <ScrollText size={18} /> },
  ],
};

function Notifications() {
  const [open, setOpen] = useState(false);
  const data = useLoad(() => get<{ notifications: any[] }>("/notifications"), []);
  useEffect(() => { const t = setInterval(() => data.reload(), 60_000); return () => clearInterval(t); }, [data]);
  const unread = data.data?.notifications.filter((n) => !n.read).length ?? 0;
  const toggle = async () => {
    const next = !open; setOpen(next);
    if (next) { await data.reload(); if (unread) { await post("/notifications/read").catch(() => undefined); } }
  };
  return (
    <div className="notif">
      <button className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} onClick={toggle}><Bell size={19} />{unread > 0 && <span className="notif-count">{unread}</span>}</button>
      {open && (
        <div className="notif-pop" role="region" aria-label="Notifications">
          <strong>Notifications</strong><small className="muted">In-app only. Email, SMS and push aren't configured.</small>
          {data.loading && !data.data ? <Loading /> : data.data?.notifications.length ? <ul>{data.data.notifications.slice(0, 15).map((n) => <li key={n.id} className={n.read ? "" : "unread"}><b>{n.title}</b><span>{n.body}</span><small>{fmtDateTime(n.createdAt)}</small></li>)}</ul> : <p className="muted">Nothing yet.</p>}
        </div>
      )}
    </div>
  );
}

function Dashboard() {
  const { user, profile, logout } = useAuth();
  const { path, search } = useLocation();
  if (!user) return null;
  const items = nav[user.role];
  const section = path.replace(/^\/app\/?/, "").split("/")[0];
  const current = items.find((i) => i.path === section);
  const pending = (user.role === "doctor" || user.role === "pharmacy") && profile && profile.verification !== "verified";

  const body = (): ReactNode => {
    if (!current) return <Alert kind="warn">That page doesn't exist. <Link to="/app">Go to your dashboard</Link>.</Alert>;
    const key = `${user.role}:${section}`;
    switch (key) {
      case "patient:": return <PatientOverview />;
      case "patient:assistant": return <Assistant />;
      case "patient:doctors": return <PatientDoctors search={search} />;
      case "patient:appointments": return <Appointments />;
      case "patient:health": return <Health />;
      case "patient:medicines": return <Medicines />;
      case "patient:orders": return <Orders />;
      case "patient:settings": return <PatientSettings />;
      case "doctor:": return <DoctorOverview />;
      case "doctor:appointments": return <DoctorAppointments />;
      case "doctor:availability": return <Availability />;
      case "doctor:prescriptions": return <DoctorPrescriptions />;
      case "doctor:profile": return <DoctorProfile />;
      case "pharmacy:": return <PharmacyOverview />;
      case "pharmacy:orders": return <PharmacyOrders />;
      case "pharmacy:messages": return <PharmacyChats />;
      case "pharmacy:inventory": return <Inventory />;
      case "pharmacy:profile": return <PharmacyProfile />;
      case "admin:": return <AdminOverview />;
      case "admin:verifications": return <Verifications />;
      case "admin:users": return <AdminUsers />;
      case "admin:complaints": return <Complaints />;
      case "admin:audit": return <AuditLog />;
      default: return null;
    }
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Dashboard">
          {items.map((i) => <Link key={i.path} to={`/app${i.path ? "/" + i.path : ""}`} className={i.path === section ? "active" : ""} aria-current={i.path === section ? "page" : undefined}>{i.icon}<span>{i.label}</span></Link>)}
        </nav>
        <p className="sidebar-note">Not for emergencies. In an emergency call your local emergency number.</p>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <div><span className="small-kicker">{humanize(user.role)} dashboard</span><h1>{current?.label ?? "Not found"}</h1></div>
          <div className="topbar-right"><span className="user-chip">{user.name}</span><Notifications />
            <button className="outline-button" onClick={async () => { await logout(); navigate("/"); }}><LogOut size={15} /> Sign out</button></div>
        </header>
        <main id="main" className="content">
          {pending && <Alert kind="warn"><strong>Verification {profile.verification === "rejected" ? "was not approved" : "pending"}.</strong> You can complete your profile now, but listings, bookings, prescribing and orders stay disabled until an administrator verifies you. <Badge tone="warn">{humanize(profile.verification)}</Badge>{profile.verificationNote ? ` Note: ${profile.verificationNote}` : ""}</Alert>}
          {body()}
        </main>
      </div>
      <nav className="tabbar" aria-label="Dashboard (mobile)">
        {items.slice(0, 5).map((i) => <Link key={i.path} to={`/app${i.path ? "/" + i.path : ""}`} className={i.path === section ? "active" : ""} aria-current={i.path === section ? "page" : undefined}>{i.icon}<span>{i.label}</span></Link>)}
      </nav>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  const { path } = useLocation();

  useEffect(() => {
    if (!loading && !user && path.startsWith("/app")) navigate("/login", true);
  }, [loading, user, path]);

  if (loading) return <div className="boot"><Loading label="Loading Smart Diagno…" /></div>;
  const verify = path.match(/^\/verify\/([^/]+)\/([^/]+)$/);
  if (verify) return <VerifyPrescription id={verify[1]} token={verify[2]} />;
  if (path === "/login") return <AuthPage mode="login" />;
  if (path === "/register") return <AuthPage mode="register" />;
  if (path === "/doctors") return <PublicDoctors />;
  if (path.startsWith("/app")) return user ? <Dashboard /> : null;
  if (path !== "/") return <div className="boot"><ClipboardList size={28} /><h1>Page not found</h1><Link to="/" className="button">Back to home</Link></div>;
  return <Landing />;
}
