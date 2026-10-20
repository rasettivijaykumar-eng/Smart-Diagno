import { useEffect, useState } from "react";
import { CalendarCheck, CalendarDays, MessageSquare, Plus, Stethoscope, Trash2, Video } from "lucide-react";
import { del, get, patch, post, put } from "./api";
import { useAuth } from "./auth";
import { ConsultationChatModal } from "./ConsultationChat";
import { GoogleCalendarConnect, GoogleMeetLobbyModal } from "./GoogleMeetLobby";
import { Alert, Badge, Empty, Field, fmtDate, fmtDateTime, humanize, Loading, Modal, Panel, statusTone, SubmitButton, useAction, useLoad } from "./ui";
import { Link, navigate } from "./router";

export function DoctorOverview() {
  const { profile } = useAuth();
  const [chatApptId, setChatApptId] = useState<string | null>(null);
  const [meetApptId, setMeetApptId] = useState<string | null>(null);
  const appts = useLoad(() => get<{ appointments: any[] }>("/appointments"), []);
  const meetAction = useAction();
  const upcoming = (appts.data?.appointments ?? []).filter((a) => a.status === "confirmed");
  const startMeet = async (appointment: any) => {
    if (!appointment.googleMeetUrl) {
      setMeetApptId(appointment.id);
      return;
    }
    window.open(appointment.googleMeetUrl, "_blank", "noopener,noreferrer");
    const res = await meetAction.run(() => post(`/appointments/${appointment.id}/request-join`));
    if (res) appts.reload();
  };
  return (
    <div className="grid-2">
      <Panel title="Verification">
        <Badge tone={statusTone(profile?.verification ?? "pending")}>{humanize(profile?.verification ?? "pending")}</Badge>
        <p>{profile?.verification === "verified" ? "You can publish availability, accept bookings and prescribe." : "Until an administrator verifies your credentials you won't appear in listings, and you can't accept bookings or prescribe."}</p>
        {profile?.verificationNote && <small>Note: {profile.verificationNote}</small>}
      </Panel>
      <Panel title="Upcoming appointments" action={<Link to="/app/appointments" className="text-link">All</Link>}>
        {meetAction.error && <Alert kind="error">{meetAction.error}</Alert>}
        {appts.loading ? <Loading /> : upcoming.length === 0 ? <Empty icon={<CalendarDays size={22} />} title="No upcoming appointments" /> :
          <ul className="list">{upcoming.slice(0, 5).map((a) => (
            <li key={a.id}>
              <div><strong>{a.patientName}</strong><small>{fmtDateTime(a.start)} · {a.mode === "online" ? "Online" : "In person"}</small></div>
              <div className="row-actions">
                {a.mode === "online" && (
                  <button className="button button-small" onClick={() => startMeet(a)} disabled={meetAction.busy}>
                    <Video size={13} /> {a.googleMeetUrl ? "Start Google Meet" : "Set up Google Meet"}
                  </button>
                )}
                <button className="button button-small" onClick={() => setChatApptId(a.id)}>
                  <MessageSquare size={13} /> Chat
                </button>
              </div>
            </li>
          ))}</ul>}
      </Panel>
      {chatApptId && <ConsultationChatModal appointmentId={chatApptId} onClose={() => setChatApptId(null)} />}
      {meetApptId && <GoogleMeetLobbyModal appointmentId={meetApptId} onClose={() => setMeetApptId(null)} />}
    </div>
  );
}

export function DoctorProfile() {
  const { refresh } = useAuth();
  const prof = useLoad(() => get<{ profile: any }>("/doctor/profile"), []);
  const hospitals = useLoad(() => get<{ hospitals: any[] }>("/places/hospitals"), []);
  const [f, setF] = useState<any>(null);
  const [hospFilter, setHospFilter] = useState("");
  const action = useAction();

  if (prof.loading) return <Loading />;
  if (prof.error) return <Alert kind="error">{prof.error}</Alert>;
  const p = f ?? {
    ...prof.data!.profile,
    languages: (prof.data!.profile.languages ?? []).join(", "),
    fee: prof.data!.profile.fee ?? "",
    lat: prof.data!.profile.lat ?? "",
    lng: prof.data!.profile.lng ?? "",
    placeId: prof.data!.profile.placeId ?? "",
  };

  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...p, [k]: e.target.value });
  const toggleMode = (m: string) => setF({ ...p, modes: p.modes.includes(m) ? p.modes.filter((x: string) => x !== m) : [...p.modes, m] });
  const num = (v: string) => (v === "" || Number.isNaN(Number(v)) ? null : Number(v));

  const selectHospital = (h: any) => {
    setF({
      ...p,
      clinic: h.name,
      address: h.address,
      placeId: h.id,
      lat: String(h.lat),
      lng: String(h.lng),
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      specialty: p.specialty,
      qualifications: p.qualifications,
      clinic: p.clinic ?? "",
      address: p.address ?? "",
      placeId: p.placeId || null,
      lat: num(String(p.lat)),
      lng: num(String(p.lng)),
      fee: num(String(p.fee)),
      languages: String(p.languages).split(",").map((s) => s.trim()).filter(Boolean),
      modes: p.modes,
    };
    if (await action.run(() => put("/doctor/profile", body), "Profile saved.")) {
      prof.reload();
      setF(null);
      refresh();
    }
  };

  return (
    <Panel title="Professional profile">
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <Field label="Specialty"><input value={p.specialty} onChange={set("specialty")} required /></Field>
          <Field label="Qualifications"><input value={p.qualifications} onChange={set("qualifications")} required /></Field>
          <Field label="Clinic / Hospital name"><input value={p.clinic ?? ""} onChange={set("clinic")} /></Field>
          <Field label="Address"><input value={p.address ?? ""} onChange={set("address")} /></Field>
          <Field label="Consultation fee (₹)"><input inputMode="decimal" value={p.fee} onChange={set("fee")} placeholder="e.g. 500" /></Field>
          <Field label="Languages (comma separated)"><input value={p.languages} onChange={set("languages")} /></Field>
        </div>

        {/* 1-Click Hospital Selector */}
        <div className="hospital-picker">
          <div className="hospital-picker-head">
            <strong>Choose or switch your hospital / clinic</strong>
            <small>Select the hospital you practice at. Patients searching this hospital on Google Maps and Smart Diagno will see your listing.</small>
          </div>

          {p.clinic && (
            <div style={{ background: "#eefcf8", border: "1.5px solid var(--teal)", borderRadius: "10px", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--teal)", textTransform: "uppercase" }}>✓ Active Hospital Linked</span>
                <strong style={{ display: "block", color: "var(--navy)", fontSize: "14px", marginTop: "2px" }}>{p.clinic}</strong>
                <small style={{ color: "var(--muted)", fontSize: "12px" }}>{p.address}</small>
              </div>
            </div>
          )}

          <input
            type="text"
            value={hospFilter}
            onChange={(e) => setHospFilter(e.target.value)}
            placeholder="Search hospitals by name or area..."
            style={{ padding: "8px 12px", borderRadius: "8px", border: "1.5px solid var(--line)", fontSize: "13px" }}
          />
          {hospitals.loading ? (
            <Loading label="Loading hospitals…" />
          ) : (
            <div className="hospital-picker-list">
              {(hospitals.data?.hospitals ?? [])
                .filter((h) => !hospFilter || h.name.toLowerCase().includes(hospFilter.toLowerCase()) || h.address.toLowerCase().includes(hospFilter.toLowerCase()))
                .slice(0, 8)
                .map((h) => (
                  <div
                    key={h.id}
                    className={`hospital-picker-card ${p.placeId === h.id || p.clinic === h.name ? "selected" : ""}`}
                    onClick={() => selectHospital(h)}
                  >
                    <div style={{ flex: 1, paddingRight: "8px" }}>
                      <strong>{h.name}</strong>
                      <small>{h.address}</small>
                    </div>
                    <span className="outline-button button-small" style={{ fontSize: "11px", pointerEvents: "none" }}>
                      {p.placeId === h.id || p.clinic === h.name ? "Linked ✓" : "Click to link"}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>

        <fieldset className="check-group">
          <legend>Consultation formats</legend>
          {["online", "offline"].map((m) => (
            <label key={m} className="check-row">
              <input type="checkbox" checked={p.modes.includes(m)} onChange={() => toggleMode(m)} />
              <span>{m === "online" ? "Online Consultation" : "In-Person Clinic Visit"}</span>
            </label>
          ))}
        </fieldset>

        <small className="muted">Medical licence {p.licenseNo} (set at registration, reviewed by an administrator).</small>
        {action.error && <Alert kind="error">{action.error}</Alert>}
        {action.done && <Alert kind="success">{action.done}</Alert>}
        <SubmitButton busy={action.busy} disabled={p.modes.length === 0}>Save profile</SubmitButton>
      </form>

      {/* Google Calendar Connect for Google Meet */}
      <div style={{ marginTop: 28 }}>
        <GoogleCalendarConnect
          onConnected={() => {
            // Check for google_calendar_success query param from OAuth redirect
            const params = new URLSearchParams(window.location.search);
            if (params.get("google_calendar_success")) {
              navigate("/app/profile");
            }
          }}
        />
      </div>
    </Panel>
  );
}

export function Availability() {
  const slots = useLoad(() => get<{ slots: any[] }>("/doctor/slots"), []);
  const getInitialSlotTime = () => {
    const d = new Date(Date.now() + 10 * 60_000);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [f, setF] = useState({ start: getInitialSlotTime(), mode: "both", durationMin: 30 });
  const action = useAction();

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await action.run(() => post("/doctor/slots", { start: new Date(f.start).toISOString(), mode: f.mode, durationMin: Number(f.durationMin) }))) {
      slots.reload();
      // Auto-advance start time by durationMin so doctor can quickly add next slot
      setF((prev) => {
        const next = new Date(new Date(prev.start).getTime() + Number(prev.durationMin) * 60_000);
        const pad = (n: number) => String(n).padStart(2, "0");
        return { ...prev, start: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}` };
      });
    }
  };

  const remove = async (id: string) => { if (await action.run(() => del(`/doctor/slots/${id}`))) slots.reload(); };

  return (
    <div className="grid-2">
      <Panel title="Add a slot">
        <form className="stack" onSubmit={add}>
          <Field label="Start">
            <input
              type="datetime-local"
              value={f.start}
              onChange={(e) => setF({ ...f, start: e.target.value })}
              required
            />
          </Field>
          <Field label="Format">
            <select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
              <option value="both">Both (In-person & Online)</option>
              <option value="offline">In person</option>
              <option value="online">Online</option>
            </select>
          </Field>
          <Field label="Duration (minutes)">
            <input type="number" min={10} max={120} step={5} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} />
          </Field>
          {action.error && <Alert kind="error">{action.error}</Alert>}
          <SubmitButton busy={action.busy}><Plus size={15} /> Add slot</SubmitButton>
        </form>
      </Panel>
      <Panel title="Your slots">
        {slots.loading ? <Loading /> : slots.error ? <Alert kind="error">{slots.error}</Alert> : slots.data!.slots.length === 0 ? <Empty title="No slots" text="Patients can only book slots you publish here." /> :
          <ul className="list">{slots.data!.slots.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{fmtDateTime(s.start)}</strong>
                <small>{s.mode === "both" ? "🏥 In-person & 🎥 Online" : s.mode === "online" ? "🎥 Online" : "🏥 In person"} · {s.durationMin} min</small>
              </div>
              <div className="row-actions">
                <Badge tone={s.status === "open" ? "good" : s.status === "booked" ? "info" : "neutral"}>{humanize(s.status)}</Badge>
                {s.status !== "booked" && <button className="icon-btn" aria-label="Remove slot" onClick={() => remove(s.id)}><Trash2 size={15} /></button>}
              </div>
            </li>
          ))}</ul>}
      </Panel>
    </div>
  );
}

export function DoctorAppointments() {
  const list = useLoad(() => get<{ appointments: any[] }>("/appointments"), []);
  const [history, setHistory] = useState<string | null>(null);
  const [prescribe, setPrescribe] = useState<any | null>(null);
  const [chatApptId, setChatApptId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("chat"));
  const [meetApptId, setMeetApptId] = useState<string | null>(null);
  const action = useAction();

  // Check for google_calendar_success/error on profile page redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_calendar_success")) {
      window.history.replaceState({}, "", "/app/appointments");
      list.reload();
    }
  }, []);

  const handleAccept = async (id: string) => {
    const res = await action.run(() => post<{ appointment: any; googleMeetUrl?: string }>(`/appointments/${id}/accept`));
    if (res) {
      list.reload();
      if (res.googleMeetUrl) {
        setMeetApptId(id);
      }
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt("Reason for rejecting? (optional)");
    if (reason === null) return; // cancelled
    const res = await action.run(() => post(`/appointments/${id}/reject`, { reason: reason || undefined }));
    if (res) list.reload();
  };

  const handleStartMeet = async (appointment: any) => {
    if (!appointment.googleMeetUrl) {
      setMeetApptId(appointment.id);
      return;
    }
    window.open(appointment.googleMeetUrl, "_blank", "noopener,noreferrer");
    const res = await action.run(() => post(`/appointments/${appointment.id}/request-join`));
    if (res) list.reload();
  };

  if (list.loading) return <Loading />;
  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  return (
    <Panel title="Appointments">
      {action.error && <Alert kind="error">{action.error}</Alert>}
      {list.data!.appointments.length === 0 ? <Empty icon={<Stethoscope size={22} />} title="No appointments" text="Booked consultations appear here." /> :
        <ul className="list">{[...list.data!.appointments].reverse().map((a) => (
          <li key={a.id}>
            <div>
              <strong>{a.patientName}</strong>
              <small>{fmtDateTime(a.start)} · {a.mode === "online" ? "🎥 Online" : "In person"}</small>
              <small>Reason (patient-reported): {a.reason}</small>
              <small>{a.canViewHistory ? "Patient shared their history" : "History not shared"}</small>
              {a.mode === "online" && a.status === "confirmed" && a.googleMeetUrl && (
                <small className="meet-link-hint">✅ Google Meet ready</small>
              )}
              {a.mode === "online" && a.status === "confirmed" && a.meetStatus === "auth_required" && (
                <small className="meet-auth-hint">⚠️ Connect Google Calendar in Profile to create Meet link</small>
              )}
            </div>
            <div className="row-actions">
              <Badge tone={statusTone(a.status)}>{humanize(a.status)}</Badge>
              <button className="button button-small" onClick={() => setChatApptId(a.id)}>
                <MessageSquare size={14} /> Chat
              </button>
              {a.mode === "online" && a.status === "confirmed" && (
                <button className="button button-small" onClick={() => a.googleMeetUrl ? handleStartMeet(a) : setMeetApptId(a.id)} disabled={action.busy}>
                  <Video size={14} /> {a.googleMeetUrl ? "Start Google Meet" : "Set up Google Meet"}
                </button>
              )}
              {a.mode === "online" && a.status === "completed" && (
                <button className="button button-small" onClick={() => setMeetApptId(a.id)}>
                  <Video size={14} /> Meet Lobby
                </button>
              )}
              {(a.status === "pending" || a.status === "awaiting_confirmation") && (
                <>
                  <button className="button button-small" onClick={() => handleAccept(a.id)} disabled={action.busy}>
                    <CalendarCheck size={14} /> Accept
                  </button>
                  <button className="outline-button" onClick={() => handleReject(a.id)} disabled={action.busy}>
                    Reject
                  </button>
                </>
              )}
              {a.canViewHistory && <button className="outline-button" onClick={() => setHistory(a.patientId)}>History</button>}
              {["confirmed", "completed"].includes(a.status) && <button className="outline-button" onClick={() => setPrescribe(a)}>Prescribe</button>}
              {a.status === "confirmed" && <><button className="outline-button" onClick={() => confirm("Cancel this appointment?") && action.run(() => patch(`/appointments/${a.id}`, { status: "cancelled" })).then((ok) => ok && list.reload())}>Cancel</button></>}
            </div>
          </li>
        ))}
        </ul>}
      {history && <HistoryModal patientId={history} onClose={() => setHistory(null)} />}
      {prescribe && <PrescribeModal appointment={prescribe} onClose={() => setPrescribe(null)} />}
      {chatApptId && (
        <ConsultationChatModal
          appointmentId={chatApptId}
          onClose={() => {
            setChatApptId(null);
            if (window.location.search.includes("chat=")) {
              window.history.replaceState({}, "", "/app/appointments");
            }
          }}
        />
      )}
      {meetApptId && (
        <GoogleMeetLobbyModal
          appointmentId={meetApptId}
          onClose={() => setMeetApptId(null)}
          onComplete={() => { setMeetApptId(null); list.reload(); }}
        />
      )}
    </Panel>
  );
}

function HistoryModal({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const data = useLoad(() => get<{ patient: { name: string }; timeline: any[]; symptomLogs: any[] }>(`/doctor/patients/${patientId}`), []);
  return (
    <Modal title="Patient history (shared with consent)" onClose={onClose}>
      {data.loading ? <Loading /> : data.error ? <Alert kind="error">{data.error}</Alert> : <>
        <p><strong>{data.data!.patient.name}</strong> — your access is logged. Patient-entered data is not clinically verified.</p>
        {data.data!.timeline.length === 0 ? <Empty title="Nothing recorded" /> : <ol className="timeline">{data.data!.timeline.map((t) => <li key={t.type + t.id}><time>{fmtDate(t.date)}</time><div><Badge>{humanize(t.type)}</Badge><strong>{t.title}</strong>{t.detail && <p>{t.detail}</p>}<small>Source: {t.source}</small></div></li>)}</ol>}
      </>}
    </Modal>
  );
}

const blankItem = { name: "", dose: "", route: "Oral", frequency: "", timing: "", color: "", durationDays: 5, times: "08:00", instructions: "" };

export function PrescribeModal({ appointment, existing, onClose, onDone }: { appointment?: any; existing?: any; onClose: () => void; onDone?: () => void }) {
  const [items, setItems] = useState<any[]>(existing ? existing.items.map((i: any) => ({ ...blankItem, ...i, times: i.times.join(", ") })) : [{ ...blankItem }]);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [done, setDone] = useState<any>(null);
  const action = useAction();
  const upd = (n: number, k: string, v: string | number) => setItems(items.map((it, i) => (i === n ? { ...it, [k]: v } : it)));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = items.map((i) => ({
      name: i.name, dose: i.dose, route: i.route, frequency: i.frequency, durationDays: Number(i.durationDays),
      times: String(i.times).split(/[,\s]+/).filter(Boolean),       ...(i.timing ? { timing: i.timing } : {}), ...(i.color ? { color: i.color } : {}), ...(i.instructions ? { instructions: i.instructions } : {}),
    }));
    const body = existing ? { items: payload, notes } : { appointmentId: appointment.id, items: payload, notes };
    const res = await action.run(() => (existing ? put<{ prescription: any }>(`/prescriptions/${existing.id}`, body) : post<{ prescription: any }>("/prescriptions", body)));
    if (res) { setDone(res.prescription); onDone?.(); }
  };
  return (
    <Modal title={existing ? `Revise ${existing.id}` : `Prescribe for ${appointment.patientName}`} onClose={onClose}>
      {done ? <div className="stack"><Alert kind="success">Prescription {done.id} {existing ? "revised" : "issued"}. The patient was notified.</Alert><button className="button" onClick={onClose}>Close</button></div> : (
        <form className="stack" onSubmit={submit}>
          <Alert>You are the issuing clinician. Enter exactly what the patient should follow; reminders are generated from these values. No AI is involved.</Alert>
          {items.map((it, n) => (
            <fieldset key={n} className="item-box"><legend>Medicine {n + 1}</legend>
              <div className="grid-2">
                <Field label="Name"><input value={it.name} onChange={(e) => upd(n, "name", e.target.value)} required /></Field><Field label="Dose"><input value={it.dose} onChange={(e) => upd(n, "dose", e.target.value)} required /></Field>
                <Field label="Route"><input value={it.route} onChange={(e) => upd(n, "route", e.target.value)} required /></Field><Field label="Frequency"><input value={it.frequency} onChange={(e) => upd(n, "frequency", e.target.value)} placeholder="e.g. twice daily" required /></Field>
                <Field label="Timing"><input value={it.timing} onChange={(e) => upd(n, "timing", e.target.value)} placeholder="e.g. after food" /></Field><Field label="Duration (days)"><input type="number" min={1} max={365} value={it.durationDays} onChange={(e) => upd(n, "durationDays", e.target.value)} required /></Field>
                <Field label="Tablet color (optional)"><input value={it.color} onChange={(e) => upd(n, "color", e.target.value)} maxLength={40} placeholder="e.g. white" /></Field>
                <Field label="Reminder times (24h, comma separated)"><input value={it.times} onChange={(e) => upd(n, "times", e.target.value)} placeholder="08:00, 20:00" required /></Field><Field label="Instructions"><input value={it.instructions} onChange={(e) => upd(n, "instructions", e.target.value)} /></Field>
              </div>
              {items.length > 1 && <button type="button" className="outline-button" onClick={() => setItems(items.filter((_, i) => i !== n))}>Remove</button>}
            </fieldset>))}
          <button type="button" className="outline-button" onClick={() => setItems([...items, { ...blankItem }])}><Plus size={14} /> Add medicine</button>
          <Field label="Notes for patient"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
          {action.error && <Alert kind="error">{action.error}</Alert>}
          <SubmitButton busy={action.busy}>{existing ? "Save revision" : "Approve & issue prescription"}</SubmitButton>
        </form>)}
    </Modal>
  );
}

export function DoctorPrescriptions() {
  const list = useLoad(() => get<{ prescriptions: any[] }>("/prescriptions"), []);
  const [edit, setEdit] = useState<any>(null);
  const action = useAction();
  const revoke = async (id: string) => {
    const reason = prompt("Reason for revoking this prescription?");
    if (reason && reason.trim().length >= 3 && await action.run(() => post(`/prescriptions/${id}/revoke`, { reason }))) list.reload();
  };
  if (list.loading) return <Loading />;
  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  return (
    <Panel title="Prescriptions you issued" kicker="Create new ones from an appointment">
      {action.error && <Alert kind="error">{action.error}</Alert>}
      {list.data!.prescriptions.length === 0 ? <Empty title="None yet" text="Open Appointments and choose Prescribe during or after a consultation." /> :
        <ul className="rx-list">{list.data!.prescriptions.map((p) => (
          <li key={p.id} className="rx-card"><header><div><strong>{p.id}</strong><small>{p.patientName} · {fmtDate(p.issuedAt)} · {p.revisions.length} revision(s)</small></div><Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge></header>
            <ul className="bullets">{p.items.map((i: any, n: number) => <li key={n}><strong>{i.name}</strong> — {i.dose}, {i.route}, {i.frequency}, {i.durationDays} days{i.color ? ` · tablet color ${i.color}` : ""} · reminders {i.times.join(", ")}</li>)}</ul>
            {p.status === "active" && <div className="row-actions"><button className="outline-button" onClick={() => setEdit(p)}>Revise</button><button className="outline-button" onClick={() => revoke(p.id)}>Revoke</button></div>}
            {p.status === "revoked" && <small>Revoked: {p.revokeReason}</small>}</li>))}</ul>}
      {edit && <PrescribeModal existing={edit} onClose={() => setEdit(null)} onDone={() => list.reload()} />}
    </Panel>
  );
}
