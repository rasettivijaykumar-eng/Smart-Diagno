import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Bell, Boxes, CalendarDays, ClipboardList, FileText, HeartPulse, Home, LogOut, MessageCircleHeart, MessageSquare, Pill, Settings, ShieldCheck, ShoppingBag, Stethoscope, Store, Users, Flag, ScrollText, Clock, UserCog, Menu, X } from "lucide-react";
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const background = shellRef.current?.querySelectorAll<HTMLElement>(".shell-main, .tabbar");
    background?.forEach((element) => element.setAttribute("inert", ""));
    document.body.style.overflow = "hidden";
    drawerRef.current?.querySelector<HTMLElement>(".mobile-drawer-close")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    const mobileViewport = window.matchMedia("(max-width: 820px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (!event.matches) setMobileNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    mobileViewport.addEventListener("change", closeOnDesktop);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      mobileViewport.removeEventListener("change", closeOnDesktop);
      document.body.style.overflow = previousOverflow;
      background?.forEach((element) => element.removeAttribute("inert"));
      (menuButtonRef.current ?? previousFocus)?.focus();
    };
  }, [mobileNavOpen]);

  if (!user) return null;
  const items = nav[user.role];
  const section = path.replace(/^\/app\/?/, "").split("/")[0];
  const current = items.find((i) => i.path === section);
  const pending = (user.role === "doctor" || user.role === "pharmacy") && profile && profile.verification !== "verified";

  const trapDrawerFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || !drawerRef.current) return;
    const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

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
    <div className="shell" ref={shellRef}>
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Dashboard">
          {items.map((i) => <Link key={i.path} to={`/app${i.path ? "/" + i.path : ""}`} className={i.path === section ? "active" : ""} aria-current={i.path === section ? "page" : undefined}>{i.icon}<span>{i.label}</span></Link>)}
        </nav>
        <p className="sidebar-note">Not for emergencies. In an emergency call your local emergency number.</p>
      </aside>
      <div className="shell-main" aria-hidden={mobileNavOpen ? true : undefined}>
        <header className="topbar">
          <div className="topbar-heading">
            <button
              ref={menuButtonRef}
              type="button"
              className="mobile-menu-button"
              aria-label="Open dashboard navigation"
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-dashboard-drawer"
              onClick={() => setMobileNavOpen(true)}
            ><Menu size={20} /></button>
            <div><span className="small-kicker">{humanize(user.role)} dashboard</span><h1>{current?.label ?? "Not found"}</h1></div>
          </div>
          <div className="topbar-right"><span className="user-chip">{user.name}</span><Notifications />
            <button className="outline-button" aria-label="Sign out" onClick={async () => { await logout(); navigate("/"); }}><LogOut size={15} /> Sign out</button></div>
        </header>
        <main id="main" className="content">
          {pending && <Alert kind="warn"><strong>Verification {profile.verification === "rejected" ? "was not approved" : "pending"}.</strong> You can complete your profile now, but listings, bookings, prescribing and orders stay disabled until an administrator verifies you. <Badge tone="warn">{humanize(profile.verification)}</Badge>{profile.verificationNote ? ` Note: ${profile.verificationNote}` : ""}</Alert>}
          {body()}
        </main>
      </div>
      <nav className="tabbar" aria-label="Dashboard (mobile)" aria-hidden={mobileNavOpen ? true : undefined}>
        {items.slice(0, 5).map((i) => <Link key={i.path} to={`/app${i.path ? "/" + i.path : ""}`} className={i.path === section ? "active" : ""} aria-current={i.path === section ? "page" : undefined}>{i.icon}<span>{i.label}</span></Link>)}
      </nav>
      {mobileNavOpen && (
        <div
          className="mobile-drawer-backdrop"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileNavOpen(false); }}
        >
          <aside
            id="mobile-dashboard-drawer"
            ref={drawerRef}
            className="mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Dashboard navigation"
            onKeyDown={trapDrawerFocus}
          >
            <header className="mobile-drawer-header">
              <div className="mobile-drawer-brand"><Brand /><strong>Smart Diagno</strong></div>
              <button type="button" className="icon-btn mobile-drawer-close" aria-label="Close dashboard navigation" onClick={() => setMobileNavOpen(false)}>
                <X size={20} />
              </button>
            </header>
            <nav aria-label="Dashboard">
              {items.map((i) => (
                <Link
                  key={i.path}
                  to={`/app${i.path ? "/" + i.path : ""}`}
                  className={i.path === section ? "active" : ""}
                  aria-current={i.path === section ? "page" : undefined}
                  onClickCapture={() => setMobileNavOpen(false)}
                >{i.icon}<span>{i.label}</span></Link>
              ))}
            </nav>
            <p className="sidebar-note">Not for emergencies. In an emergency call your local emergency number.</p>
          </aside>
        </div>
      )}
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
