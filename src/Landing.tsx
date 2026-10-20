import { Activity, CalendarCheck, ChevronDown, ClipboardList, HeartPulse, MapPin, Pill, ShieldCheck, Stethoscope } from "lucide-react";
import { useEffect } from "react";
import { useAuth } from "./auth";
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
  return <Link to="/" className="brand"><span className="brand-mark"><Activity size={19} strokeWidth={2.4} /></span><span>smart<span className="brand-light">diagno</span></span></Link>;
}

export function SiteHeader() {
  const { user } = useAuth();
  return (
    <header className="site-header"><div className="site-header-inner">
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

export function Landing() {
  const { user } = useAuth();
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".feature, .steps li, .privacy-grid li, .section-head, .panel-card, .faq-list details"));
    els.forEach((el, i) => { el.classList.add("sr"); el.style.transitionDelay = `${(i % 4) * 90}ms`; });
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <div className="landing-wrap">
      <div className="blobs" aria-hidden="true"><span className="blob b1" /><span className="blob b2" /><span className="blob b3" /><span className="blob b4" /></div>
      <div className="crosses" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <span key={i} className="cross" />)}</div>
      <a className="skip-link" href="#main">Skip to content</a>
      <SiteHeader />
      <main id="main">
        <section className="hero"><div className="hero-inner">
          <div className="hero-copy reveal">
            <span className="eyebrow"><span className="eyebrow-line" /> Care navigation, not diagnosis</span>
            <h1>A clearer next step in your <em>healthcare journey.</em></h1>
            <p className="hero-description">Find a verified doctor, book a consultation, keep your health history in one place, follow your doctor's prescription and coordinate with a pharmacy — with your consent at every step.</p>
            <div className="hero-actions">
              {user ? <Link to="/app" className="button">Open your dashboard</Link> : <><Link to="/register" className="button">Create free account</Link><Link to="/login" className="text-link">Sign in</Link></>}
              <Link to="/doctors" className="text-link">Browse doctors</Link>
            </div>
            <p className="hero-assurance"><ShieldCheck size={15} /> Not for emergencies — call your local emergency number.</p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <span className="float-chip c1"><Stethoscope size={16} /> Verified doctors</span>
            <span className="float-chip c2"><Pill size={16} /> Smart reminders</span>
            <span className="float-chip c3"><HeartPulse size={16} /> Health timeline</span>
            <div className="hero-card">
              <div className="hero-card-row"><span className="dot ok" /> Dr. verified by administrator</div>
              <div className="hero-card-row"><span className="dot" /> Slot booked once, never twice</div>
              <div className="hero-card-row"><span className="dot" /> Prescription issued by your doctor</div>
              <div className="hero-card-row"><span className="dot" /> Shared with a pharmacy you choose</div>
              <svg className="ecg" viewBox="0 0 300 60" preserveAspectRatio="none"><path d="M0 30 H70 L85 30 L95 8 L110 52 L122 16 L132 30 H190 L205 30 L215 12 L228 46 L238 30 H300" /></svg>
              <small>Illustrative workflow — no patient data shown.</small>
            </div>
          </div>
        </div></section>

        <section id="features" className="section"><div className="section-head"><span className="eyebrow">What you can do</span><h2>Everything from symptom to pharmacy, in one place</h2></div>
          <ul className="feature-grid">{features.map((f) => <li key={f.title} className="feature reveal"><span className="feature-icon">{f.icon}</span><h3>{f.title}</h3><p>{f.text}</p></li>)}</ul>
        </section>

        <section id="how" className="section section-tint"><div className="section-head"><span className="eyebrow">How it works</span><h2>Four steps</h2></div>
          <ol className="steps">{steps.map(([t, d], i) => <li key={t} className="reveal"><span className="step-n">{i + 1}</span><h3>{t}</h3><p>{d}</p></li>)}</ol>
        </section>

        <section className="section split">
          <div><span className="eyebrow">For clinicians & pharmacies</span><h2>Built for the whole care team</h2>
            <p>Doctors publish availability, review shared history and issue digital prescriptions. Pharmacies review prescriptions patients share, send itemised quotations and update order status. Both must be verified by an administrator before using these workflows.</p>
            <div className="hero-actions"><Link to="/register" className="button">Register as doctor or pharmacy</Link></div></div>
          <div className="panel-card"><h3>Verification first</h3><ul className="bullets"><li>Credentials reviewed before listing</li><li>Unverified accounts can't book, prescribe or take orders</li><li>Rules enforced on the server, not just hidden buttons</li></ul></div>
        </section>

        <section id="privacy" className="section section-dark"><div className="section-head"><span className="eyebrow">Privacy & safety</span><h2>You stay in control of your health data</h2></div>
          <ul className="privacy-grid">
            <li><ShieldCheck size={20} /><h3>Consent-based sharing</h3><p>You decide whether a doctor sees your history and which pharmacy receives a prescription.</p></li>
            <li><ShieldCheck size={20} /><h3>Audited access</h3><p>Doctor and administrator access to sensitive data is logged.</p></li>
            <li><ShieldCheck size={20} /><h3>Export and delete</h3><p>Download your data or delete your account at any time from Settings.</p></li>
            <li><ShieldCheck size={20} /><h3>Honest limits</h3><p>No fabricated ratings, statistics or integrations. Unavailable features say so.</p></li>
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
