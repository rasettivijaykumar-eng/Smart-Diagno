import {
  CalendarCheck,
  ChevronDown,
  ClipboardList,
  Cross,
  HeartPulse,
  MapPin,
  MessageCircleHeart,
  Pill,
  Scan,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import { useAuth } from "./auth";
import {
  AmbientParticles,
  DnaHelix,
  EcgWaveform,
  HealthScanner,
  OrbitalRings,
  useMotionVisible,
  useSectionReveal,
} from "./motion";
import { Link } from "./router";

const features = [
  { icon: <HeartPulse size={22} />, title: "Symptom guidance", text: "Describe how you feel and get cautious, general context and the specialties worth considering. It never diagnoses or prescribes." },
  { icon: <Stethoscope size={22} />, title: "Verified doctors", text: "Only registered doctors whose credentials an administrator has reviewed can accept bookings. Search by specialty or within 20 km." },
  { icon: <CalendarCheck size={22} />, title: "Online & in-person booking", text: "Pick from real published slots. Each slot can be booked once, so there are no double bookings." },
  { icon: <ClipboardList size={22} />, title: "Health timeline", text: "Conditions, reports, lab results, symptoms and prescriptions in one dated timeline, with the source of every entry." },
  { icon: <Pill size={22} />, title: "Prescription reminders", text: "Reminders come only from prescriptions your doctor issued. Mark doses taken or skipped, and see which went unacknowledged." },
  { icon: <MapPin size={22} />, title: "Pharmacy coordination", text: "Share a prescription with a verified pharmacy with your consent, review their quotation and follow the order status." },
];

const steps = [
  ["Describe or search", "Tell the assistant what's bothering you, or search verified doctors directly."],
  ["Book a consultation", "Choose a real slot, online or in person, and decide whether to share your history."],
  ["Get a prescription", "Your doctor issues it digitally. Only they can create or change it."],
  ["Follow and fulfil", "Use reminders, then share it with a pharmacy you choose and confirm their quote."],
];

const faqs = [
  ["Can the assistant diagnose me or recommend medicine?", "No. It offers general information, highlights warning signs and suggests specialties. Diagnosis and prescriptions come only from a qualified, verified doctor."],
  ["Who can see my health records?", "Only you. A doctor can view your history only for a consultation where you chose to share it, and every access is logged. Pharmacies see only the prescription you share with them."],
  ["Are all doctors listed here verified?", "Yes. Only registered doctors who passed verification appear and can be booked. Anything else is not shown as bookable."],
  ["Will reminders ring when the app is closed?", "Not reliably. Reminders and browser notifications work while Smart Diagno is open; browsers may block or delay background alerts, and push, SMS and email are not enabled."],
  ["Can I pay or track delivery live?", "Not yet. Quotations and order status are managed with the pharmacy; online payment and live tracking are not configured."],
  ["Is this for emergencies?", "No. In an emergency, call your local emergency number or go to the nearest emergency department."],
];

export function Brand() {
  return <Link to="/" className="brand" aria-label="Smart Diagno home"><img className="brand-logo" src="/smart-diagno-logo.png" alt="Smart Diagno" /></Link>;
}

function useHeaderScroll(headerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const updateScrolledState = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
    updateScrolledState();
    window.addEventListener("scroll", updateScrolledState, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolledState);
  }, [headerRef]);
}

export function SiteHeader() {
  const { user } = useAuth();
  const headerRef = useRef<HTMLElement>(null);
  useHeaderScroll(headerRef);
  return (
    <header ref={headerRef} className="site-header"><div className="site-header-inner">
      <Brand />
      <nav aria-label="Primary" className="site-nav">
        <a href="/#features">Features</a><a href="/#how">How it works</a><a href="/#privacy">Privacy</a><a href="/#faq">FAQ</a><Link to="/doctors">Find doctors</Link>
      </nav>
      <div className="site-actions">{user ? <Link to="/app" className="button button-small">Open dashboard</Link> : <><Link to="/login" className="text-link">Sign in</Link><Link to="/register" className="button button-small">Get started</Link></>}</div>
    </div></header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer"><div className="footer-inner">
      <Brand />
      <p>Smart Diagno helps you navigate care. It does not diagnose, prescribe, or replace emergency services.</p>
      <small>Legal, clinical and privacy review is required before real-world use.</small>
    </div></footer>
  );
}

function HeroArt() {
  const [hudRef, visible] = useMotionVisible<HTMLDivElement>();
  return (
    <div ref={hudRef} className={`hero-art hero-hud${visible ? "" : " motion-paused"}`} aria-hidden="true">
      <AmbientParticles count={12} />
      <OrbitalRings />
      <DnaHelix style={{ top: 24, right: 18 }} />
      <DnaHelix className="m-delay-2" style={{ bottom: 48, left: 4, width: 40, height: 100, opacity: 0.55 }} />

      <span className="m-med-icon m-float" style={{ top: 18, left: 28 }}><Stethoscope size={18} /></span>
      <span className="m-med-icon m-med-icon--teal m-drift m-delay-1" style={{ top: 90, right: 8 }}><ShieldCheck size={18} /></span>
      <span className="m-med-icon m-med-icon--green m-float-slow m-delay-2" style={{ bottom: 110, left: 8 }}><Pill size={18} /></span>
      <span className="m-med-icon m-med-icon--red m-float-fast m-delay-3" style={{ bottom: 36, right: 56 }}><HeartPulse size={18} /></span>
      <span className="m-med-icon m-drift m-delay-4" style={{ top: 200, left: -6 }}><Scan size={16} /></span>
      <span className="m-med-icon m-med-icon--teal m-float m-delay-2" style={{ top: 48, left: "42%" }}><Cross size={16} /></span>

      <div className="m-ui-card m-float" style={{ top: 0, left: -8 }}>
        <span className="m-ui-card-icon"><MessageCircleHeart size={14} /></span>
        <span>AI Health Assistant<small>Illustrative workflow</small></span>
      </div>
      <div className="m-ui-card m-float-slow m-delay-1" style={{ top: 56, right: -12 }}>
        <span className="m-ui-card-icon" style={{ background: "linear-gradient(120deg,#0fa89a,#2bb673)" }}><Stethoscope size={14} /></span>
        <span>Doctor Consultation<small>Illustrative — no patient data</small></span>
      </div>
      <div className="m-ui-card m-drift m-delay-2" style={{ bottom: 72, left: -20 }}>
        <span className="m-ui-card-icon" style={{ background: "linear-gradient(120deg,#0b2f5b,#0a6ed1)" }}><ClipboardList size={14} /></span>
        <span>Health Report Analysis<small>Illustrative sample</small></span>
      </div>
      <div className="m-ui-card m-float-fast m-delay-3" style={{ bottom: 8, right: 12 }}>
        <span className="m-ui-card-icon" style={{ background: "linear-gradient(120deg,#00b3d7,#0fa89a)" }}><CalendarCheck size={14} /></span>
        <span>Appointment Reminder<small>Illustrative only</small></span>
      </div>

      <span className="float-chip c1"><Stethoscope size={16} /> Verified doctors</span>
      <span className="float-chip c2"><Pill size={16} /> Smart reminders</span>
      <span className="float-chip c3"><HeartPulse size={16} /> Health timeline</span>

      <div className="hero-hud-core">
        <div className="hero-card">
          <HealthScanner active={false} label="" />
          <div className="hero-card-row"><span className="dot ok" /> Dr. verified by administrator</div>
          <div className="hero-card-row"><span className="dot" /> Slot booked once, never twice</div>
          <div className="hero-card-row"><span className="dot" /> Prescription issued by your doctor</div>
          <div className="hero-card-row"><span className="dot" /> Shared with a pharmacy you choose</div>
          <EcgWaveform />
          <small>Illustrative workflow — no patient data shown.</small>
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  const { user } = useAuth();
  const wrapRef = useRef<HTMLDivElement>(null);
  useSectionReveal(wrapRef);

  return (
    <div className="landing-wrap" ref={wrapRef}>
      <div className="blobs" aria-hidden="true"><span className="blob b1" /><span className="blob b2" /><span className="blob b3" /><span className="blob b4" /></div>
      <div className="crosses" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <span key={i} className="cross" />)}</div>
      <a className="skip-link" href="#main">Skip to content</a>
      <SiteHeader />
      <main id="main">
        <section className="hero"><div className="hero-inner">
          <div className="hero-copy reveal">
            <img className="hero-copy-logo" src="/smart-diagno-logo.png" alt="Smart Diagno" />
            <span className="eyebrow"><span className="eyebrow-line" /> CARE NAVIGATION · SMART DIAGNOSIS.</span>
            <h1>Your next step in care, <em className="m-em-grad">made clearer.</em></h1>
            <p className="hero-description">Find a verified doctor, book a consultation, keep your health history close, and coordinate with a pharmacy — with your consent at every step.</p>
            <div className="hero-actions">
              {user ? <Link to="/app" className="button">Open your dashboard</Link> : <><Link to="/register" className="button">Create free account</Link><Link to="/login" className="text-link">Sign in</Link></>}
              <Link to="/doctors" className="text-link">Browse doctors</Link>
            </div>
            <p className="hero-assurance"><ShieldCheck size={15} /> Not for emergencies — call your local emergency number.</p>
          </div>
          <HeroArt />
        </div></section>

        <section id="features" className="section"><div className="section-head"><span className="eyebrow">What you can do</span><h2>Everything from symptom to pharmacy, in one place</h2></div>
          <ul className="feature-grid">{features.map((f) => <li key={f.title} className="feature reveal"><span className="feature-icon">{f.icon}</span><h3>{f.title}</h3><p>{f.text}</p></li>)}</ul>
        </section>

        <section id="how" className="section section-tint">
          <div className="section-head"><span className="eyebrow">How it works</span><h2>Four steps</h2></div>
          <div className="how-steps-wrap">
            <ol className="steps">{steps.map(([t, d], i) => <li key={t} className="reveal"><span className="step-n">{i + 1}</span><h3>{t}</h3><p>{d}</p></li>)}</ol>
          </div>
        </section>

        <section className="section split">
          <div><span className="eyebrow">For clinicians & pharmacies</span><h2>Built for the whole care team</h2>
            <p>Doctors publish availability, review shared history and issue digital prescriptions. Pharmacies review prescriptions patients share, send itemised quotations and update order status. Both must be verified by an administrator before using these workflows.</p>
            <div className="hero-actions"><Link to="/register" className="button">Register as doctor or pharmacy</Link></div></div>
          <div className="panel-card m-care-panel">
            <AmbientParticles count={6} />
            <HealthScanner active={false} label="" />
            <h3>Verification first</h3>
            <ul className="bullets"><li>Credentials reviewed before listing</li><li>Unverified accounts can't book, prescribe or take orders</li><li>Rules enforced on the server, not just hidden buttons</li></ul>
            <small className="muted" style={{ position: "relative", zIndex: 1 }}>Illustrative accent — no clinical claim.</small>
          </div>
        </section>

        <section id="privacy" className="section section-dark"><div className="section-head"><span className="eyebrow">Privacy & safety</span><h2>You stay in control of your health data</h2></div>
          <ul className="privacy-grid">
            <li><span className="privacy-icon-wrap"><span className="privacy-ring" /><ShieldCheck size={20} /></span><h3>Consent-based sharing</h3><p>You decide whether a doctor sees your history and which pharmacy receives a prescription.</p></li>
            <li><span className="privacy-icon-wrap"><span className="privacy-ring" /><ShieldCheck size={20} /></span><h3>Audited access</h3><p>Doctor and administrator access to sensitive data is logged.</p></li>
            <li><span className="privacy-icon-wrap"><span className="privacy-ring" /><ShieldCheck size={20} /></span><h3>Export and delete</h3><p>Download your data or delete your account at any time from Settings.</p></li>
            <li><span className="privacy-icon-wrap"><span className="privacy-ring" /><ShieldCheck size={20} /></span><h3>Honest limits</h3><p>No fabricated ratings, statistics or integrations. Unavailable features say so.</p></li>
          </ul>
        </section>

        <section id="faq" className="section"><div className="section-head"><span className="eyebrow">FAQ</span><h2>Questions, answered plainly</h2></div>
          <div className="faq-list">{faqs.map(([q, a]) => <details key={q}><summary>{q}<ChevronDown size={16} /></summary><p>{a}</p></details>)}</div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
