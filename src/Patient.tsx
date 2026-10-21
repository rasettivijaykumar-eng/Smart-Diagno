import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Activity, AlertTriangle, Bell, Building2, CalendarDays, Download, Eye, EyeOff, FileText, HeartPulse, HelpCircle, Info, LocateFixed, MapPin, MessageSquare, Navigation, Pill, Plus, Search, Send, ShieldAlert, Sparkles, Star, Stethoscope, Trash2, Upload, UserPlus, Video, Volume2, X } from "lucide-react";
import { del, get, patch, post, put } from "./api";
import { useAuth } from "./auth";
import { COUNTRIES, INDIA_STATES } from "./locationData";
import { BookingModal, DoctorSearch } from "./DoctorSearch";
import { ConsultationChatModal } from "./ConsultationChat";
import { GoogleMeetLobbyModal } from "./GoogleMeetLobby";
import { PatientPharmacyChats, PharmacyConversation } from "./PharmacyChat";
import { HealthScanner } from "./motion";
import { Link, navigate } from "./router";
import { detectDeviceLocation, PHARMACY_SEARCH_RADIUS_KM } from "./location";
import { Alert, Badge, Empty, Field, fmtDate, fmtDateTime, humanize, Loading, Modal, Panel, statusTone, SubmitButton, useAction, useLoad } from "./ui";

type Appt = { id: string; doctorName: string; start: string; mode: string; status: string; reason: string; durationMin: number; videoNote?: string };
type RxItem = { name: string; dose: string; route: string; frequency: string; timing?: string; color?: string; durationDays: number; times: string[]; instructions?: string };
type Rx = { id: string; doctorName: string; status: string; issuedAt: string; items: RxItem[]; notes: string; verifyPath: string; revokeReason?: string };
type DoseLog = { prescriptionId: string; itemIndex: number; scheduledAt: string; status: "taken" | "skipped"; respondedAt: string };
type MedicineReminder = { id: string; medicine: string; color?: string; time: string; repeat: "daily" };

/* ---------- Overview ---------- */
export function PatientOverview() {
  const [chatApptId, setChatApptId] = useState<string | null>(null);
  const appts = useLoad(() => get<{ appointments: Appt[] }>("/appointments"), []);
  const alerts = useLoad(() => get<{ alerts: Array<{ level: string; message: string }> }>("/health-alerts"), []);
  const rx = useLoad(() => get<{ prescriptions: Rx[] }>("/prescriptions"), []);
  const orders = useLoad(() => get<{ orders: any[] }>("/orders"), []);
  const upcoming = (appts.data?.appointments ?? []).filter((a) => a.status === "confirmed" && new Date(a.start) > new Date());
  const activeOrders = (orders.data?.orders ?? []).filter((o) => !["delivered", "cancelled", "rejected"].includes(o.status));
  return (
    <div className="grid-2">
      <Panel title="Upcoming appointments" action={<Link to="/app/doctors" className="text-link">Find a doctor</Link>}>
        {appts.loading ? <Loading /> : upcoming.length === 0 ? <Empty icon={<CalendarDays size={22} />} title="Nothing booked" text="Search verified doctors and book a consultation." /> :
          <ul className="list">{upcoming.slice(0, 4).map((a) => (
            <li key={a.id}>
              <div><strong>{a.doctorName}</strong><small>{fmtDateTime(a.start)} · {a.mode === "online" ? "Online" : "In person"}</small></div>
              <div className="row-actions">
                <Badge tone="good">Confirmed</Badge>
                <button className="button button-small" onClick={() => setChatApptId(a.id)}>
                  <MessageSquare size={13} /> Chat
                </button>
              </div>
            </li>
          ))}</ul>}
      </Panel>
      {chatApptId && <ConsultationChatModal appointmentId={chatApptId} onClose={() => setChatApptId(null)} />}
      <Panel title="Health alerts" action={<Link to="/app/health" className="text-link">Symptom log</Link>}>
        {alerts.loading ? <Loading /> : alerts.error || !alerts.data ? <Alert kind="error">{alerts.error ?? "Couldn't load alerts."}</Alert> : alerts.data.alerts.length === 0 ? <Empty title="No alerts" text="Alerts appear when your symptom log matches simple, fixed rules. They are not diagnoses." /> :
          <ul className="list">{alerts.data.alerts.map((a, i) => <li key={i}><Alert kind={a.level === "urgent" ? "error" : "warn"}>{a.message}</Alert></li>)}</ul>}
      </Panel>
      <Panel title="Active prescriptions" action={<Link to="/app/medicines" className="text-link">Medicines</Link>}>
        {rx.loading ? <Loading /> : !rx.data ? <Alert kind="error">{rx.error ?? "Couldn't load."}</Alert> : (rx.data.prescriptions.filter((p) => p.status === "active")).length === 0 ? <Empty icon={<Pill size={22} />} title="No active prescriptions" text="Prescriptions issued by your doctor after a consultation appear here." /> :
          <ul className="list">{rx.data.prescriptions.filter((p) => p.status === "active").map((p) => <li key={p.id}><div><strong>{p.id}</strong><small>{p.items.map((i) => i.name).join(", ")}</small></div><Badge tone="good">Active</Badge></li>)}</ul>}
      </Panel>
      <Panel title="Pharmacy orders" action={<Link to="/app/orders" className="text-link">Orders</Link>}>
        {orders.loading ? <Loading /> : activeOrders.length === 0 ? <Empty title="No open orders" text="Share a prescription with a verified pharmacy to request a quotation." /> :
          <ul className="list">{activeOrders.map((o) => <li key={o.id}><div><strong>{o.pharmacyName}</strong><small>{o.prescription?.id}</small></div><Badge tone={statusTone(o.status)}>{humanize(o.status)}</Badge></li>)}</ul>}
      </Panel>
    </div>
  );
}

/* ---------- Assistant ---------- */
const urgentSigns: Array<[string, string]> = [
  ["chest-pain", "Chest pain or pressure"],
  ["trouble-breathing", "Severe trouble breathing"],
  ["stroke-signs", "Face drooping, arm weakness, slurred speech"],
  ["severe-bleeding", "Severe bleeding"],
  ["loss-consciousness", "Fainting or unresponsive"]
];

type ChatSummary = { id: string; title: string; updatedAt: string; count: number };
type ChatDetail = { id: string; title: string; updatedAt: string; messages: any[] };

const HYDERABAD_PRESETS = [
  { label: "Banjara Hills", lat: 17.4138, lng: 78.4325 },
  { label: "Secunderabad", lat: 17.4399, lng: 78.4983 },
  { label: "Gachibowli", lat: 17.4401, lng: 78.3489 },
  { label: "Madhapur", lat: 17.4484, lng: 78.3915 },
  { label: "Ameerpet", lat: 17.4374, lng: 78.4487 },
  { label: "Kukatpally", lat: 17.4849, lng: 78.3997 },
  { label: "Mehdipatnam", lat: 17.3930, lng: 78.4307 },
  { label: "LB Nagar", lat: 17.3460, lng: 78.5483 },
];

export function Assistant() {
  const { user } = useAuth();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<ChatDetail | null>(null);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [concern, setConcern] = useState("");
  const [signs, setSigns] = useState<string[]>([]);
  const [showSigns, setShowSigns] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number }>({ lat: 17.3843, lng: 78.4583 });
  const [locationLabel, setLocationLabel] = useState("Detecting location…");
  const [showAreaPicker, setShowAreaPicker] = useState(false);
  const [areaSearch, setAreaSearch] = useState("");
  const [areaSearching, setAreaSearching] = useState(false);
  const [bookingDoctor, setBookingDoctor] = useState<{ id: string; name: string } | null>(null);
  const [hospitalNotice, setHospitalNotice] = useState<{ hospital: any; reason: "auth" | "no-doctor" } | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  // Auto-detect real location via IP then refine with GPS if permitted
  useEffect(() => {
    // Step 1: Quick IP-based location from server
    get<{ lat: number; lng: number; label: string; source: string }>("/places/my-location")
      .then((data) => {
        if (data?.lat && data?.lng) {
          setCoords({ lat: data.lat, lng: data.lng });
          setLocationLabel(data.label || "Your area");
        }
      })
      .catch(() => {});

    // Step 2: Refine with GPS if available
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocationLabel("Live GPS location");
        },
        () => { /* keep IP-based */ },
        { timeout: 8000, enableHighAccuracy: true }
      );
    }
  }, []);

  // Reload active chat with fresh coords whenever coords change (auto-refreshes stale Bangalore hospitals)
  const selectChat = async (id: string, withCoords?: { lat: number; lng: number }) => {
    setActiveChatId(id);
    setLoadingChat(true);
    setError(null);
    const loc = withCoords ?? coords;
    const url = `/chats/${id}?lat=${loc.lat}&lng=${loc.lng}&radiusKm=20`;
    const res = await get<{ chat: ChatDetail }>(url).catch((err) => {
      setError(err?.message || "Failed to load chat.");
      return null;
    });
    if (res?.chat) {
      setActiveChat(res.chat);
    }
    setLoadingChat(false);
  };

  // Fetch chat history
  const fetchChats = async (selectFirst = false) => {
    setLoadingChats(true);
    const res = await get<{ chats: ChatSummary[] }>("/chats").catch(() => null);
    if (res?.chats) {
      setChats(res.chats);
      if (selectFirst && res.chats.length > 0 && !activeChatId) {
        selectChat(res.chats[0].id);
      }
    }
    setLoadingChats(false);
  };

  useEffect(() => {
    fetchChats(true);
  }, []);

  // When coords change and there's an active chat, reload it with new coords
  const coordsRef = useRef(coords);
  useEffect(() => {
    // Only trigger if coords actually changed meaningfully
    const prev = coordsRef.current;
    const dist = Math.sqrt((coords.lat - prev.lat) ** 2 + (coords.lng - prev.lng) ** 2);
    if (dist > 0.001 && activeChatId) {
      coordsRef.current = coords;
      selectChat(activeChatId, coords);
    }
  }, [coords]);

  // Keep message scrolling inside the chat panel rather than moving the whole page.
  useEffect(() => {
    if (!sending) return;
    const messages = messagesScrollRef.current;
    messages?.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
  }, [activeChat?.messages, sending]);

  // Create new chat
  const handleNewChat = async () => {
    setError(null);
    const res = await post<{ chat: ChatDetail }>("/chats", {}).catch((err) => {
      setError(err?.message || "Could not start a new chat.");
      return null;
    });
    if (res?.chat) {
      setChats((prev) => [{ id: res.chat.id, title: res.chat.title, updatedAt: res.chat.updatedAt, count: 0 }, ...prev]);
      setActiveChatId(res.chat.id);
      setActiveChat(res.chat);
      setConcern("");
      setSigns([]);
    }
  };

  // Delete chat
  const handleDeleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this chat consultation?")) return;
    const res = await del<{ ok: boolean }>(`/chats/${id}`).catch(() => null);
    if (res?.ok) {
      const remaining = chats.filter((c) => c.id !== id);
      setChats(remaining);
      if (activeChatId === id) {
        if (remaining.length > 0) {
          selectChat(remaining[0].id);
        } else {
          setActiveChatId(null);
          setActiveChat(null);
        }
      }
    }
  };

  // Send message in current chat (or create new if none active)
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!concern.trim() || sending) return;

    let chatId = activeChatId;
    if (!chatId) {
      const newChatRes = await post<{ chat: ChatDetail }>("/chats", {}).catch(() => null);
      if (!newChatRes?.chat) {
        setError("Failed to initialize conversation.");
        return;
      }
      chatId = newChatRes.chat.id;
      setActiveChatId(chatId);
      setActiveChat(newChatRes.chat);
      setChats((prev) => [{ id: newChatRes.chat.id, title: newChatRes.chat.title, updatedAt: newChatRes.chat.updatedAt, count: 0 }, ...prev]);
    }

    setSending(true);
    setError(null);

    const payload = {
      concern: concern.trim(),
      urgentSymptoms: signs,
      lat: coords.lat,
      lng: coords.lng,
    };

    const res = await post<{ title: string; updatedAt: string; messages: any[] }>(`/chats/${chatId}/messages`, payload).catch((err) => {
      setError(err?.message || "Failed to send message. Please try again.");
      return null;
    });

    if (res?.messages) {
      setActiveChat((prev) => prev ? { ...prev, title: res.title, updatedAt: res.updatedAt, messages: res.messages } : null);
      setChats((prev) => prev.map((c) => c.id === chatId ? { ...c, title: res.title, updatedAt: res.updatedAt, count: res.messages.length } : c));
      setConcern("");
      setSigns([]);
      setShowSigns(false);
    }
    setSending(false);
  };

  // Book appointment handler
  const handleBookHospital = (hospital: any) => {
    if (!user) {
      setHospitalNotice({ hospital, reason: "auth" });
      return;
    }
    if (hospital.doctors && hospital.doctors.length > 0) {
      setBookingDoctor(hospital.doctors[0]);
    } else {
      setHospitalNotice({ hospital, reason: "no-doctor" });
    }
  };

  return (
    <div className="stack-lg">
      <Alert kind="warn">
        This assistant cannot diagnose, prescribe, or advise on medicine doses. Its list of warning signs is not exhaustive. If you feel in danger, call your local emergency number now.
      </Alert>

      <div className="chat-layout">
        {/* Chat History Sidebar */}
        <aside className="chat-history-pane">
          <div className="chat-history-header">
            <h3><MessageSquare size={17} /> Consultation History</h3>
            <button type="button" className="button button-small" onClick={handleNewChat}>
              <Plus size={14} /> New
            </button>
          </div>

          {loadingChats ? (
            <Loading label="Loading history…" />
          ) : chats.length === 0 ? (
            <div style={{ padding: "16px 8px", textAlign: "center" }}>
              <p className="muted" style={{ fontSize: "13px", margin: "14px 0" }}>No past consultations. Start a new chat to describe your symptoms.</p>
              <button type="button" className="outline-button button-small" style={{ width: "100%" }} onClick={handleNewChat}>
                <Plus size={14} /> Start new chat
              </button>
            </div>
          ) : (
            <ul className="chat-history-list">
              {chats.map((c) => (
                <li key={c.id}>
                  <div className={`chat-history-item ${activeChatId === c.id ? "active" : ""}`}>
                    <button
                      type="button"
                      className="chat-history-select"
                      onClick={() => selectChat(c.id)}
                      aria-pressed={activeChatId === c.id}
                    >
                    <div className="chat-history-item-content">
                      <strong>{c.title}</strong>
                      <small>{fmtDateTime(c.updatedAt)} · {c.count} messages</small>
                    </div>
                    </button>
                    <button
                      type="button"
                      className="chat-history-delete"
                      title="Delete chat"
                      onClick={(e) => handleDeleteChat(c.id, e)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Chat Main Area */}
        <main className="chat-main-pane">
          <div className="chat-main-header">
            <h2>
              <HeartPulse size={18} color="var(--blue)" />
              {activeChat ? activeChat.title : "Smart Diagno Assistant"}
            </h2>
            <div className="badge-row">
              <Badge tone="good">Google Maps Hospitals</Badge>
              <Badge tone="info">20 km radius</Badge>
            </div>
          </div>

          {/* Location Bar */}
          <div className="chat-location-bar">
            <div className="chat-location-details">
              <MapPin size={15} color="var(--red)" />
              <span className="loc-text">
                <span className="loc-label">Showing hospitals within 20 km of</span>
                <strong className="loc-place">{locationLabel}</strong>
              </span>
            </div>
            <div className="chat-location-buttons">
              <button
                type="button"
                className="outline-button button-small"
                style={{ fontSize: "12px", gap: "5px" }}
                onClick={() => {
                  if (navigator.geolocation) {
                    setLocationLabel("Detecting GPS…");
                    navigator.geolocation.getCurrentPosition(
                      (pos) => {
                        const newCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                        setCoords(newCoords);
                        setLocationLabel("Live GPS location");
                        if (activeChatId) selectChat(activeChatId, newCoords);
                      },
                      () => setLocationLabel(locationLabel),
                      { timeout: 8000, enableHighAccuracy: true }
                    );
                  }
                }}
                title="Use your live GPS location"
              >
                <LocateFixed size={12} /> Use GPS
              </button>
              <button
                type="button"
                className="outline-button button-small"
                style={{ fontSize: "12px" }}
                onClick={() => setShowAreaPicker((v) => !v)}
              >
                {showAreaPicker ? "Close" : "Change Area"}
              </button>
            </div>
          </div>

          {/* Area Picker */}
          {showAreaPicker && (
            <div className="chat-area-picker-card">
              <div className="chat-area-picker-header">
                <strong>Search or pick an area within 20 km</strong>
                <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setShowAreaPicker(false)}>
                  <X size={14} />
                </button>
              </div>
              <form
                className="chat-area-search-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!areaSearch.trim()) return;
                  setAreaSearching(true);
                  try {
                    const data = await get<{ lat: number; lng: number; label: string }>(`/places/geocode?q=${encodeURIComponent(areaSearch)}`);
                    if (data?.lat) {
                      const newCoords = { lat: data.lat, lng: data.lng };
                      setCoords(newCoords);
                      setLocationLabel(data.label?.split(",").slice(0, 2).join(",").trim() || areaSearch);
                      setShowAreaPicker(false);
                      setAreaSearch("");
                      if (activeChatId) selectChat(activeChatId, newCoords);
                    }
                  } catch { /* ignore */ } finally {
                    setAreaSearching(false);
                  }
                }}
              >
                <input
                  value={areaSearch}
                  onChange={(e) => setAreaSearch(e.target.value)}
                  placeholder="Type area name, e.g. Hitech City, Kukatpally…"
                  autoFocus
                />
                <button type="submit" className="button button-small" disabled={areaSearching}>
                  {areaSearching ? "…" : <><Search size={13} /> Go</>}
                </button>
              </form>
              <div className="preset-chips">
                {HYDERABAD_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="chip"
                    style={{ fontSize: "12px", padding: "5px 12px", minHeight: 32 }}
                    onClick={() => {
                      const newCoords = { lat: p.lat, lng: p.lng };
                      setCoords(newCoords);
                      setLocationLabel(p.label + ", Hyderabad");
                      setShowAreaPicker(false);
                      if (activeChatId) selectChat(activeChatId, newCoords);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Decorative scanner — not a diagnosis indicator */}
          <div className="assistant-scan-slot" aria-hidden="true">
            <HealthScanner
              inline
              active={sending || loadingChat}
              label={sending ? "Waiting for assistant response — illustrative scan only" : "Illustrative scanner — not a medical reading"}
            />
          </div>

          {/* Messages Scroll Area */}
          <div className="chat-messages-scroll" ref={messagesScrollRef}>
            {loadingChat ? (
              <Loading label="Loading conversation…" />
            ) : !activeChat || activeChat.messages.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center", display: "grid", gap: "14px", justifyItems: "center" }}>
                <div style={{ background: "var(--paper)", padding: "18px", borderRadius: "50%", color: "var(--blue)" }}>
                  <HeartPulse size={38} />
                </div>
                <div>
                  <h3 style={{ margin: "0 0 6px 0", fontSize: "18px", color: "var(--navy)" }}>Describe what you are experiencing</h3>
                  <p className="muted" style={{ margin: 0, fontSize: "13.5px", maxWidth: "480px" }}>
                    Type your symptoms or questions below. Our assistant will provide medical guidance, recommended specialties, and automatically show nearby hospitals visible on Google Maps with direct directions and appointment booking.
                  </p>
                </div>
              </div>
            ) : (
              activeChat.messages.map((m: any, idx: number) => (
                <div key={m.id || idx} className={m.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}>
                  {m.role === "user" ? (
                    <div>
                      <p style={{ margin: 0 }}>{m.text}</p>
                      <time>{m.at ? fmtDateTime(m.at) : ""}</time>
                    </div>
                  ) : (
                    <div className="stack" style={{ gap: "14px" }}>
                      {m.result?.kind === "urgent" && (
                        <div className="urgent-card" role="alert" style={{ margin: 0 }}>
                          <AlertTriangle size={24} />
                          <div>
                            <h2>Seek emergency care now</h2>
                            <p>{m.result.message}</p>
                            <ul>{m.result.nextSteps?.map((s: string) => <li key={s}>{s}</li>)}</ul>
                          </div>
                        </div>
                      )}

                      {/* Clinical Analysis Box */}
                      {m.result && (
                        <div className="chat-clinical-box">
                          {/* 1. Severity & Triage Pill */}
                          {m.result.severityLabel && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                              <div className={`chat-severity-pill ${m.result.severity || "mild"}`}>
                                <Activity size={16} />
                                <span>{m.result.severityLabel}</span>
                              </div>
                              {m.result.severityReason && (
                                <small style={{ color: "var(--muted)", fontSize: "12px", maxWidth: "420px" }}>
                                  {m.result.severityReason}
                                </small>
                              )}
                            </div>
                          )}

                          {/* 2. Potential Conditions (What the disease may be) */}
                          {m.result.potentialDiseases && m.result.potentialDiseases.length > 0 && (
                            <div className="chat-section-card">
                              <h4 className="chat-section-title">
                                <Stethoscope size={16} color="var(--blue)" />
                                Potential Conditions (What the disease may be)
                              </h4>
                              <div className="chat-diseases-grid">
                                {m.result.potentialDiseases.map((d: any, i: number) => (
                                  <div key={i} className="chat-disease-card">
                                    <div className="chat-disease-header">
                                      <span className="chat-disease-name">{d.name}</span>
                                      <Badge tone={d.likelihood === "High" ? "good" : d.likelihood === "Moderate" ? "info" : "warn"}>
                                        {d.likelihood} Likelihood
                                      </Badge>
                                    </div>
                                    <p className="chat-disease-desc">{d.description}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 3. Underlying Causes */}
                          {m.result.causes && m.result.causes.length > 0 && (
                            <div className="chat-section-card">
                              <h4 className="chat-section-title">
                                <HelpCircle size={16} color="#d97706" />
                                Likely Causes & Biological Triggers
                              </h4>
                              <ul className="chat-causes-list">
                                {m.result.causes.map((c: string, i: number) => (
                                  <li key={i}>{c}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* 4. Safe Home Remedies & Self-Care (STRICT NO MEDICATIONS) */}
                          {m.result.remedies && (
                            <div className="chat-remedies-card">
                              <h4 className="chat-section-title" style={{ color: "#166534" }}>
                                <Sparkles size={16} color="#166534" />
                                Safe Home Remedies & Self-Care (Non-Medicinal)
                              </h4>

                              {/* Strict No-Medication Banner */}
                              <div className="chat-no-meds-banner">
                                <ShieldAlert size={20} color="#b45309" style={{ flexShrink: 0, marginTop: "2px" }} />
                                <div>
                                  <strong>Strict No-Medication Policy</strong>
                                  <p style={{ margin: "2px 0 0 0", fontSize: "12px" }}>
                                    {m.result.remedies.strictNoMeds ||
                                      "This assistant does NOT prescribe medicines, chemical drugs, or antibiotics. Antibiotics cannot treat viral infections and self-medication is unsafe. Always consult a certified doctor before taking any prescription medication."}
                                  </p>
                                </div>
                              </div>

                              {/* Self Care points */}
                              {m.result.remedies.selfCare && m.result.remedies.selfCare.length > 0 && (
                                <div>
                                  <strong style={{ fontSize: "12.5px", color: "#14532d", display: "block", marginBottom: "4px" }}>
                                    Recommended Home Measures:
                                  </strong>
                                  <ul className="chat-remedy-bullets">
                                    {m.result.remedies.selfCare.map((sc: string, i: number) => (
                                      <li key={i}>{sc}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {/* Lifestyle tips */}
                              {m.result.remedies.lifestyle && m.result.remedies.lifestyle.length > 0 && (
                                <div style={{ marginTop: "4px" }}>
                                  <strong style={{ fontSize: "12.5px", color: "#14532d", display: "block", marginBottom: "4px" }}>
                                    Lifestyle & Dietary Advice:
                                  </strong>
                                  <ul className="chat-remedy-bullets">
                                    {m.result.remedies.lifestyle.map((ls: string, i: number) => (
                                      <li key={i}>{ls}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}

                          {/* 5. Red-Flag Warning Signs */}
                          {m.result.redFlags && m.result.redFlags.length > 0 && (
                            <div className="chat-red-flags-card">
                              <h4>
                                <AlertTriangle size={15} />
                                When to seek emergency care immediately:
                              </h4>
                              <ul className="chat-red-flags-list">
                                {m.result.redFlags.map((rf: string, i: number) => (
                                  <li key={i}>{rf}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Fallback context box if older message */}
                          {!m.result.potentialDiseases && m.result.possibleContext && (
                            <div className="context-box">
                              <Badge tone="info">{m.result.contextSource === "ai-generated" ? "Clinical Guidance" : "General Information"}</Badge>
                              <p style={{ margin: "6px 0 0 0" }}>{m.result.possibleContext}</p>
                            </div>
                          )}

                          {/* Questions a doctor may ask */}
                          {m.result.followUpQuestions && m.result.followUpQuestions.length > 0 && (
                            <div>
                              <h4 style={{ margin: "0 0 6px 0", fontSize: "13px", color: "var(--navy)" }}>Questions a doctor may ask:</h4>
                              <ul className="bullets" style={{ margin: 0, paddingLeft: "18px", fontSize: "12.5px" }}>
                                {m.result.followUpQuestions.map((q: string, i: number) => <li key={i}>{q}</li>)}
                              </ul>
                            </div>
                          )}

                          {/* Specialties to consider */}
                          {m.result.suggestedSpecialties && m.result.suggestedSpecialties.length > 0 && (
                            <div>
                              <h4 style={{ margin: "0 0 6px 0", fontSize: "13px", color: "var(--navy)" }}>Specialties to consider:</h4>
                              <div className="badge-row">
                                {m.result.suggestedSpecialties.map((s: string) => (
                                  <button key={s} type="button" className="chip" onClick={() => navigate("/app/doctors?specialty=" + encodeURIComponent(s))}>
                                    {s}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Hospitals Section with Priority Badges */}
                      {m.result?.hospitals && m.result.hospitals.length > 0 && (
                        <div className="chat-hospitals-box">
                          <div className="chat-hospitals-header">
                            <h4><Building2 size={16} color="var(--blue)" /> Hospitals nearby (within 20 km)</h4>
                            <span className="muted" style={{ fontSize: "12px" }}>📍 {locationLabel}</span>
                          </div>

                          {/* Hospital Tier Recommendation Banner */}
                          {m.result.hospitalTierReason && (
                            <div className={`chat-hospital-priority-banner ${m.result.severity === "severe" || m.result.severity === "critical" ? "severe" : ""}`}>
                              <Info size={16} style={{ flexShrink: 0 }} />
                              <span>{m.result.hospitalTierReason}</span>
                            </div>
                          )}

                          <div className="chat-hospitals-grid">
                            {m.result.hospitals.map((h: any) => (
                              <div
                                key={h.id}
                                className={`chat-hospital-card ${h.priorityLevel === 1 ? "priority-1" : ""} ${h.priorityTone === "urgent" ? "urgent" : ""}`}
                              >
                                <div className="chat-hospital-card-top">
                                  {/* Priority badge */}
                                  {h.priorityBadge && (
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", marginBottom: "4px" }}>
                                      <span className={`chat-priority-badge ${h.priorityTone || "info"}`}>
                                        {h.priorityBadge}
                                      </span>
                                      <span className="chat-hospital-tier-tag">{h.tierLabel || "General Hospital"}</span>
                                    </div>
                                  )}

                                  <h5 className="chat-hospital-name">{h.name}</h5>
                                  <p className="chat-hospital-address">{h.address}</p>

                                  {/* Priority reason */}
                                  {h.priorityReason && (
                                    <p className="chat-hospital-reason">
                                      💡 {h.priorityReason}
                                    </p>
                                  )}

                                  <div className="chat-hospital-meta" style={{ marginTop: "6px" }}>
                                    <Badge tone="info">{h.distanceKm !== undefined ? `📍 ${h.distanceKm} km away` : "Nearby"}</Badge>
                                    {h.rating && <Badge tone="good"><Star size={11} fill="#f59e0b" color="#f59e0b" /> {h.rating}</Badge>}
                                    {h.doctors && h.doctors.length > 0 ? (
                                      <Badge tone="good">✅ {h.doctors.length} doctor{h.doctors.length > 1 ? "s" : ""} on platform</Badge>
                                    ) : (
                                      <Badge tone="warn">No registered doctors yet</Badge>
                                    )}
                                  </div>
                                </div>

                                <div className="chat-hospital-actions">
                                  <a
                                    className="outline-button button-small"
                                    href={h.directionsUrl || `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="Open Google Maps directions in new tab"
                                  >
                                    <Navigation size={13} /> Get Direction
                                  </a>
                                  <button
                                    type="button"
                                    className="button button-small"
                                    onClick={() => handleBookHospital(h)}
                                    title="Book an appointment"
                                  >
                                    <CalendarDays size={13} /> Book Appointment
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
            {sending && (
              <div className="chat-bubble-assistant" style={{ maxWidth: "260px" }}>
                <Loading label="Analyzing symptoms & finding hospitals…" />
              </div>
            )}
          </div>

          {/* Chat Input Bar */}
          <form className="chat-input-bar" onSubmit={handleSendMessage}>
            {error && <Alert kind="error">{error}</Alert>}

            {showSigns && (
              <div className="chat-urgent-panel">
                <strong style={{ fontSize: "12.5px", color: "var(--red)" }}>Are you experiencing any urgent red-flag symptoms?</strong>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  {urgentSigns.map(([id, label]) => (
                    <label key={id} className="check-row" style={{ fontSize: "12px" }}>
                      <input
                        type="checkbox"
                        checked={signs.includes(id)}
                        onChange={(e) => setSigns(e.target.checked ? [...signs, id] : signs.filter((s) => s !== id))}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="chat-input-row">
              <textarea
                rows={2}
                value={concern}
                onChange={(e) => setConcern(e.target.value)}
                placeholder="Describe your symptoms or ask a follow-up question..."
                required
                minLength={2}
                maxLength={500}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage(e);
                  }
                }}
              />
              <SubmitButton busy={sending} disabled={!concern.trim()}>
                <Send size={15} /> Send
              </SubmitButton>
            </div>

            <div className="chat-urgent-toggle">
              <button
                type="button"
                className="text-link"
                style={{ fontSize: "12px", border: 0, background: "none", cursor: "pointer", padding: 0 }}
                onClick={() => setShowSigns((prev) => !prev)}
              >
                {showSigns ? "Hide emergency symptoms checklist" : "⚠️ Report emergency symptoms (chest pain, breathing trouble, etc.)"}
              </button>
              <span className="muted" style={{ fontSize: "11px" }}>Press Enter to send · Shift+Enter for new line</span>
            </div>
          </form>
        </main>
      </div>

      {/* Booking Modal */}
      {bookingDoctor && (
        <BookingModal
          doctor={bookingDoctor}
          onClose={() => setBookingDoctor(null)}
          onBooked={(appt) => {
            setBookingDoctor(null);
            navigate(`/app/appointments?chat=${appt?.id ?? ""}`);
          }}
        />
      )}

      {/* Hospital Notice / Auth Required Modal */}
      {hospitalNotice && (
        <Modal
          title={hospitalNotice.reason === "auth" ? "Account Required" : `Book Appointment at ${hospitalNotice.hospital.name}`}
          onClose={() => setHospitalNotice(null)}
        >
          {hospitalNotice.reason === "auth" ? (
            <div className="stack">
              <Alert kind="warn">
                To book an appointment at <strong>{hospitalNotice.hospital.name}</strong>, please register as a patient or sign in to your account.
              </Alert>
              <p>Registration takes less than a minute and lets you schedule appointments, view prescriptions, and keep your health records.</p>
              <div className="badge-row" style={{ marginTop: "10px" }}>
                <Link to="/register" className="button">
                  <UserPlus size={15} /> Register as Patient
                </Link>
                <Link to="/login" className="outline-button">
                  Sign in
                </Link>
              </div>
            </div>
          ) : (
            <div className="stack">
              <p>
                Online direct slots are fulfilled through our verified doctors. <strong>{hospitalNotice.hospital.name}</strong> is visible and mapped directly on Google Maps.
              </p>
              <div className="quote" style={{ borderRadius: "8px" }}>
                <strong>{hospitalNotice.hospital.name}</strong>
                <p style={{ fontSize: "13px", color: "var(--muted)", margin: "4px 0" }}>{hospitalNotice.hospital.address}</p>
                {hospitalNotice.hospital.phone && <p style={{ fontSize: "13px" }}>Direct Phone: <strong>{hospitalNotice.hospital.phone}</strong></p>}
              </div>
              <div className="badge-row" style={{ marginTop: "12px" }}>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setHospitalNotice(null);
                    navigate("/app/doctors");
                  }}
                >
                  <Stethoscope size={15} /> Find Available Verified Doctors
                </button>
                <a
                  className="outline-button"
                  href={hospitalNotice.hospital.directionsUrl || `https://www.google.com/maps/dir/?api=1&destination=${hospitalNotice.hospital.lat},${hospitalNotice.hospital.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Navigation size={15} /> Open in Google Maps
                </a>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/* ---------- Doctors ---------- */
export function PatientDoctors({ search }: { search: string }) {
  const specialty = new URLSearchParams(search).get("specialty") ?? "";
  return <DoctorSearch initialSpecialty={specialty} onBooked={(appt) => navigate(`/app/appointments?chat=${appt?.id ?? ""}`)} />;
}

/* ---------- Appointments ---------- */
export function Appointments() {
  const list = useLoad(() => get<{ appointments: Appt[] }>("/appointments"), []);
  const [chatApptId, setChatApptId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("chat"));
  const [meetApptId, setMeetApptId] = useState<string | null>(null);
  const action = useAction();
  const cancel = async (id: string) => { if (confirm("Cancel this appointment?") && await action.run(() => patch(`/appointments/${id}`, { status: "cancelled" }))) list.reload(); };

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("chat");
    if (q) setChatApptId(q);
  }, []);

  if (list.loading) return <Loading />;
  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  const items = [...list.data!.appointments].reverse();
  return (
    <Panel title="Your appointments" action={<Link to="/app/doctors" className="outline-button">Book new</Link>}>
      {action.error && <Alert kind="error">{action.error}</Alert>}
      {items.length === 0 ? <Empty icon={<CalendarDays size={22} />} title="No appointments yet" text="Booked consultations and their history appear here." /> :
        <ul className="list">{items.map((a) => (
          <li key={a.id}>
            <div>
              <strong>{a.doctorName}</strong>
              <small>{fmtDateTime(a.start)} · {a.durationMin} min · {a.mode === "online" ? "🎥 Online" : "In person"}</small>
              <small>Reason: {a.reason}</small>
              {a.mode === "online" && a.status === "confirmed" && (a as any).videoNote && <small>{(a as any).videoNote}</small>}
              {a.mode === "online" && a.status === "confirmed" && (a as any).googleMeetUrl && (
                <small className="meet-link-hint">✅ Google Meet session ready — click Meet Lobby to join</small>
              )}
            </div>
            <div className="row-actions">
              <Badge tone={statusTone(a.status)}>{humanize(a.status)}</Badge>
              <button className="button button-small" onClick={() => setChatApptId(a.id)}>
                <MessageSquare size={14} /> Consultation Chat
              </button>
              {a.mode === "online" && ["confirmed", "completed"].includes(a.status) && (
                <button className="button button-small" onClick={() => setMeetApptId(a.id)}>
                  <Video size={14} /> Meet Lobby
                </button>
              )}
              {a.status === "confirmed" && <button className="outline-button" onClick={() => cancel(a.id)}>Cancel</button>}
            </div>
          </li>
        ))}
        </ul>}
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
        />
      )}
    </Panel>
  );
}

/* ---------- Health ---------- */
function SeverityChart({ logs }: { logs: Array<{ date: string; severity: number }> }) {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date)).slice(-20);
  if (sorted.length < 2) return <p className="muted">Add at least two entries for this symptom to see a chart.</p>;
  const w = 480, h = 150, pad = 24;
  const x = (i: number) => pad + (i * (w - pad * 2)) / (sorted.length - 1);
  const y = (v: number) => h - pad - ((v - 1) * (h - pad * 2)) / 9;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Severity over time: ${sorted.map((s) => `${fmtDate(s.date)} ${s.severity}`).join(", ")}`}>
        {[1, 5, 10].map((v) => <g key={v}><line x1={pad} x2={w - pad} y1={y(v)} y2={y(v)} className="grid" /><text x={4} y={y(v) + 4}>{v}</text></g>)}
        <polyline points={sorted.map((s, i) => `${x(i)},${y(s.severity)}`).join(" ")} className="line" />
        {sorted.map((s, i) => <circle key={i} cx={x(i)} cy={y(s.severity)} r={4} className="dot"><title>{fmtDate(s.date)}: {s.severity}/10</title></circle>)}
      </svg>
      <figcaption>Patient-reported severity (1–10) over time.</figcaption>
    </figure>
  );
}

export function Health() {
  const [tab, setTab] = useState<"timeline" | "records" | "symptoms">("timeline");
  return (
    <div className="stack-lg">
      <div className="tabs" role="tablist">{(["timeline", "records", "symptoms"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t === "symptoms" ? "Symptom log" : humanize(t)}</button>)}</div>
      {tab === "timeline" && <Timeline />}
      {tab === "records" && <Records />}
      {tab === "symptoms" && <Symptoms />}
    </div>
  );
}

function Timeline() {
  const data = useLoad(() => get<{ timeline: Array<{ id: string; date: string; type: string; title: string; detail?: string; source: string }> }>("/timeline"), []);
  if (data.loading) return <Loading />;
  if (data.error) return <Alert kind="error">{data.error}</Alert>;
  return (
    <Panel title="Health timeline" kicker="Newest first">
      {data.data!.timeline.length === 0 ? <Empty title="Your timeline is empty" text="Add records, log symptoms, or book a consultation to build it." /> :
        <ol className="timeline">{data.data!.timeline.map((t) => <li key={t.type + t.id}><time>{fmtDate(t.date)}</time><div><Badge>{humanize(t.type)}</Badge><strong>{t.title}</strong>{t.detail && <p>{t.detail}</p>}<small>Source: {t.source}</small></div></li>)}</ol>}
    </Panel>
  );
}

const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
  reader.onerror = () => reject(new Error("read failed"));
  reader.readAsDataURL(file);
});

function Records() {
  const list = useLoad(() => get<{ records: any[] }>("/records"), []);
  const [open, setOpen] = useState(false);
  const action = useAction();
  const remove = async (id: string) => { if (confirm("Delete this record?") && await action.run(() => del(`/records/${id}`))) list.reload(); };
  return (
    <Panel title="Medical records" action={<button className="button button-small" onClick={() => setOpen(true)}><Upload size={15} /> Add record</button>}>
      {action.error && <Alert kind="error">{action.error}</Alert>}
      {list.loading ? <Loading /> : list.error ? <Alert kind="error">{list.error}</Alert> : list.data!.records.length === 0 ? <Empty icon={<FileText size={22} />} title="No records yet" text="Add conditions, allergies, lab results or upload a report (PDF, PNG or JPEG up to 2 MB)." /> :
        <ul className="list">{list.data!.records.map((r) => (
          <li key={r.id}><div><strong>{r.title}</strong><small>{humanize(r.type)} · {fmtDate(r.date)}{r.type === "lab" && r.value ? ` · ${r.value} ${r.unit ?? ""}${r.refRange ? ` (ref ${r.refRange})` : ""}` : ""}</small>{r.notes && <small>{r.notes}</small>}<small>Entered by you · not clinically verified</small></div>
            <div className="row-actions">{r.file && <a className="outline-button" href={`/api/records/${r.id}/file`}><Download size={14} /> {r.file.name}</a>}<button className="icon-btn" aria-label={`Delete ${r.title}`} onClick={() => remove(r.id)}><Trash2 size={15} /></button></div></li>))}</ul>}
      {open && <RecordModal onClose={() => setOpen(false)} onSaved={() => { setOpen(false); list.reload(); }} />}
    </Panel>
  );
}

function RecordModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ type: "report", title: "", date: new Date().toISOString().slice(0, 10), value: "", unit: "", refRange: "", notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const action = useAction();
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (file && !["application/pdf", "image/png", "image/jpeg"].includes(file.type)) return alert("Please choose a PDF, PNG or JPEG file.");
    if (file && file.size > 2 * 1024 * 1024) return alert("File must be under 2 MB.");
    const body: any = { type: f.type, title: f.title, date: f.date };
    for (const k of ["value", "unit", "refRange", "notes"] as const) if (f[k]) body[k] = f[k];
    if (file) body.file = { name: file.name, mime: file.type, data: await toBase64(file) };
    if (await action.run(() => post("/records", body))) onSaved();
  };
  return (
    <Modal title="Add a record" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Type"><select value={f.type} onChange={set("type")}><option value="report">Report</option><option value="lab">Lab result</option><option value="condition">Condition</option><option value="allergy">Allergy</option><option value="note">Note</option></select></Field>
        <Field label="Title"><input value={f.title} onChange={set("title")} required minLength={2} /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set("date")} required max={new Date().toISOString().slice(0, 10)} /></Field>
        {f.type === "lab" && <div className="grid-3"><Field label="Value"><input value={f.value} onChange={set("value")} /></Field><Field label="Unit"><input value={f.unit} onChange={set("unit")} /></Field><Field label="Reference range"><input value={f.refRange} onChange={set("refRange")} /></Field></div>}
        <Field label="Notes"><textarea rows={2} value={f.notes} onChange={set("notes")} maxLength={1000} /></Field>
        <Field label="Attach original file (optional)" hint="PDF, PNG or JPEG, up to 2 MB. The original is stored unchanged; no values are extracted automatically."><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        {action.error && <Alert kind="error">{action.error}</Alert>}
        <SubmitButton busy={action.busy}>Save record</SubmitButton>
      </form>
    </Modal>
  );
}

function Symptoms() {
  const logs = useLoad(() => get<{ logs: any[] }>("/symptom-logs"), []);
  const alerts = useLoad(() => get<{ alerts: Array<{ level: string; message: string; rule: string }>; note: string }>("/health-alerts"), []);
  const [f, setF] = useState({ symptom: "", severity: 3, notes: "", label: "", value: "", unit: "" });
  const [selected, setSelected] = useState("");
  const action = useAction();
  const names = useMemo(() => [...new Set((logs.data?.logs ?? []).map((l) => l.symptom.toLowerCase()))], [logs.data]);
  useEffect(() => { if (!selected && names[0]) setSelected(names[0]); }, [names, selected]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: any = { symptom: f.symptom, severity: Number(f.severity) };
    if (f.notes) body.notes = f.notes;
    if (f.label && f.value !== "" && !Number.isNaN(Number(f.value))) body.measurement = { label: f.label, value: Number(f.value), unit: f.unit };
    const res = await action.run(() => post<{ urgentGuidance: boolean }>("/symptom-logs", body));
    if (res) { setF({ ...f, symptom: "", notes: "", label: "", value: "", unit: "" }); logs.reload(); alerts.reload(); }
  };
  const remove = async (id: string) => { if (await action.run(() => del(`/symptom-logs/${id}`))) { logs.reload(); alerts.reload(); } };
  return (
    <div className="grid-2">
      <Panel title="Log a symptom">
        <form className="stack" onSubmit={submit}>
          <Field label="Symptom"><input value={f.symptom} onChange={(e) => setF({ ...f, symptom: e.target.value })} required minLength={2} maxLength={100} /></Field>
          <Field label={`Severity: ${f.severity}/10`}><input type="range" min={1} max={10} value={f.severity} onChange={(e) => setF({ ...f, severity: Number(e.target.value) })} /></Field>
          {f.severity >= 9 && <Alert kind="error">If this is severe or sudden, seek urgent medical care now rather than waiting.</Alert>}
          <Field label="Notes"><textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={500} /></Field>
          <div className="grid-3"><Field label="Measurement (optional)"><input placeholder="e.g. Temperature" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field><Field label="Value"><input inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field><Field label="Unit"><input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field></div>
          {action.error && <Alert kind="error">{action.error}</Alert>}
          <SubmitButton busy={action.busy}>Add entry</SubmitButton>
        </form>
      </Panel>
      <Panel title="Trends">
        {alerts.data?.alerts.map((a, i) => <Alert key={i} kind={a.level === "urgent" ? "error" : "warn"}>{a.message} <small>Rule: {a.rule}</small></Alert>)}
        {alerts.data && <small className="muted">{alerts.data.note}</small>}
        {logs.loading ? <Loading /> : names.length === 0 ? <Empty title="No entries yet" text="Log symptoms over time to see how they change." /> : <>
          <Field label="Symptom"><select value={selected} onChange={(e) => setSelected(e.target.value)}>{names.map((n) => <option key={n}>{n}</option>)}</select></Field>
          <SeverityChart logs={logs.data!.logs.filter((l) => l.symptom.toLowerCase() === selected)} />
        </>}
      </Panel>
      <Panel title="Entries" className="span-2">
        {logs.data?.logs.length ? <ul className="list">{logs.data.logs.slice(0, 30).map((l) => <li key={l.id}><div><strong>{l.symptom} · {l.severity}/10</strong><small>{fmtDateTime(l.date)}{l.measurement ? ` · ${l.measurement.label}: ${l.measurement.value} ${l.measurement.unit}` : ""}</small>{l.notes && <small>{l.notes}</small>}</div><button className="icon-btn" aria-label="Delete entry" onClick={() => remove(l.id)}><Trash2 size={15} /></button></li>)}</ul> : <p className="muted">Nothing logged.</p>}
      </Panel>
    </div>
  );
}

/* ---------- Medicines ---------- */
type Dose = { key: string; rxId: string; itemIndex: number; name: string; detail: string; at: Date; status: "taken" | "skipped" | "due" | "upcoming" | "unacknowledged" };
const GRACE_MS = 60 * 60_000;
const SNOOZE_KEY = "sd_snooze";
const ALARM_REPEAT_MINUTES = 3;
const ALARM_SOUND_DB = "smart-diagno-alarm-sounds";
const ALARM_SOUND_STORE = "patient-sounds";
const ALARM_SOUND_MAX_BYTES = 10 * 1024 * 1024;
const ALARM_AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  mpeg: "audio/mpeg",
  mpg: "audio/mpeg",
  mpga: "audio/mpeg",
  wav: "audio/wav",
  wave: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  webm: "audio/webm",
  weba: "audio/webm",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  mid: "audio/midi",
  midi: "audio/midi",
  amr: "audio/amr",
  caf: "audio/x-caf",
  "3gp": "audio/3gpp",
  "3gpp": "audio/3gpp",
};
type AlarmEntry = { medicine: string; color?: string; dueAt: number; lastRangAt?: number; acknowledged?: boolean };
type StoredAlarmSound = { name: string; blob: Blob };

const alarmLedgerKey = (userId: string) => `sd_alarm_ledger_v1:${userId}`;
const alarmIntervalKey = (userId: string) => `sd_alarm_interval_v1:${userId}`;

function openAlarmSoundDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser cannot save a custom alarm sound."));
      return;
    }
    const request = indexedDB.open(ALARM_SOUND_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ALARM_SOUND_STORE)) request.result.createObjectStore(ALARM_SOUND_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open alarm sound storage."));
  });
}

async function getStoredAlarmSound(userId: string): Promise<StoredAlarmSound | null> {
  const db = await openAlarmSoundDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ALARM_SOUND_STORE, "readonly");
    const request = transaction.objectStore(ALARM_SOUND_STORE).get(userId);
    request.onsuccess = () => resolve((request.result as StoredAlarmSound | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not load the saved alarm sound."));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error("Could not load the saved alarm sound.")); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Could not load the saved alarm sound.")); };
  });
}

async function saveAlarmSound(userId: string, sound: StoredAlarmSound | null): Promise<void> {
  const db = await openAlarmSoundDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ALARM_SOUND_STORE, "readwrite");
    const store = transaction.objectStore(ALARM_SOUND_STORE);
    if (sound) store.put(sound, userId);
    else store.delete(userId);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error("Could not save the alarm sound.")); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Could not save the alarm sound.")); };
  });
}

function readAlarmLedger(userId: string): Record<string, AlarmEntry> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(alarmLedgerKey(userId)) ?? "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, AlarmEntry>;
  } catch (error) {
    console.warn("Could not read saved medicine alarm state.", error);
  }
  return {};
}

async function playMedicineAlarm(
  context: AudioContext,
  medicine: string,
  color: string | undefined,
  soundUrl: string | null,
  activeAudio: MutableRefObject<HTMLAudioElement | null>,
  isCancelled: () => boolean,
) {
  await context.resume();
  if (soundUrl) {
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(soundUrl);
      activeAudio.current = audio;
      audio.loop = true;
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        audio.removeEventListener("pause", onPause);
        audio.removeEventListener("error", onError);
        if (activeAudio.current === audio) activeAudio.current = null;
        if (error) reject(error);
        else resolve();
      };
      const onPause = () => finish();
      const onError = () => finish(new Error("Could not play the selected MP3 alarm."));
      const timeout = window.setTimeout(() => { audio.pause(); finish(); }, 30_000);
      audio.addEventListener("pause", onPause);
      audio.addEventListener("error", onError, { once: true });
      audio.play().catch(() => finish(new Error("The selected MP3 alarm could not be played by this browser.")));
    });
  } else {
    const start = context.currentTime;
    for (let i = 0; i < 4; i += 1) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const onset = start + i * 0.55;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(i % 2 === 0 ? 880 : 660, onset);
      gain.gain.setValueAtTime(0.001, onset);
      gain.gain.exponentialRampToValueAtTime(0.65, onset + 0.04);
      gain.gain.setValueAtTime(0.65, onset + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, onset + 0.42);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(onset);
      oscillator.stop(onset + 0.44);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2_400));
  }
  if (isCancelled()) return;
  const shade = color && color !== "Not specified" ? `, color ${color}` : ", color not specified";
  const phrase = `Tablet ${medicine}${shade}.`;
  const utterance = new SpeechSynthesisUtterance(Array(3).fill(phrase).join(" "));
  await new Promise<void>((resolve, reject) => {
    utterance.onend = () => resolve();
    utterance.onerror = (event) => {
      if (event.error === "canceled" || event.error === "interrupted") resolve();
      else reject(new Error("Could not speak the medicine alarm."));
    };
    window.speechSynthesis.speak(utterance);
  });
}

function buildDoses(prescriptions: Rx[], logs: DoseLog[], snoozed: Record<string, number>): Dose[] {
  const doses: Dose[] = [];
  const now = Date.now();
  for (const rx of prescriptions.filter((p) => p.status === "active")) {
    rx.items.forEach((item, itemIndex) => {
      const from = new Date(rx.issuedAt).getTime(), to = from + item.durationDays * 86_400_000;
      for (let d = -7; d <= 1; d++) {
        for (const time of item.times) {
          const [hh, mm] = time.split(":").map(Number);
          const at = new Date(); at.setDate(at.getDate() + d); at.setHours(hh, mm, 0, 0);
          if (at.getTime() < from || at.getTime() >= to) continue;
          const key = `${rx.id}|${itemIndex}|${at.toISOString()}`;
          const log = logs.find((l) => l.prescriptionId === rx.id && l.itemIndex === itemIndex && new Date(l.scheduledAt).getTime() === at.getTime());
          const status: Dose["status"] = log ? log.status : at.getTime() > now ? "upcoming" : now - at.getTime() > GRACE_MS && !(snoozed[key] > now) ? "unacknowledged" : "due";
          doses.push({ key, rxId: rx.id, itemIndex, name: item.name, detail: [item.dose, item.route, item.timing].filter(Boolean).join(" · "), at, status });
        }
      }
    });
  }
  return doses.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function Medicines() {
  const { user } = useAuth();
  const rx = useLoad(() => get<{ prescriptions: Rx[] }>("/prescriptions"), []);
  const logs = useLoad(() => get<{ doseLogs: DoseLog[] }>("/dose-logs"), []);
  const reminders = useLoad(() => get<{ reminders: MedicineReminder[] }>("/medicine-reminders"), []);
  const [tab, setTab] = useState<"reminders" | "prescriptions" | "check">("reminders");
  const [manualMedicine, setManualMedicine] = useState("");
  const [manualColor, setManualColor] = useState("");
  const [manualTime, setManualTime] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundError, setSoundError] = useState("");
  const [customAlarmSound, setCustomAlarmSound] = useState<StoredAlarmSound | null>(null);
  const [customAlarmUrl, setCustomAlarmUrl] = useState<string | null>(null);
  const [repeatMinutes, setRepeatMinutes] = useState(ALARM_REPEAT_MINUTES);
  const [alarmLedger, setAlarmLedger] = useState<Record<string, AlarmEntry>>({});
  const [alarmLedgerReady, setAlarmLedgerReady] = useState(false);
  const soundContext = useRef<AudioContext | null>(null);
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  const activeAudioKey = useRef<string | null>(null);
  const cancelledAlarms = useRef(new Set<string>());
  const alarmQueue = useRef(Promise.resolve());
  const [snoozed, setSnoozed] = useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? "{}"); } catch { return {}; } });
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5_000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (!user?.id) {
      setAlarmLedger({});
      setAlarmLedgerReady(false);
      return;
    }
    setAlarmLedgerReady(false);
    setAlarmLedger(readAlarmLedger(user.id));
    try {
      const storedInterval = Number(localStorage.getItem(alarmIntervalKey(user.id)));
      setRepeatMinutes(Number.isInteger(storedInterval) && storedInterval >= 1 && storedInterval <= 60 ? storedInterval : ALARM_REPEAT_MINUTES);
    } catch (error) {
      setSoundError(error instanceof Error ? error.message : "Could not load alarm settings.");
      setRepeatMinutes(ALARM_REPEAT_MINUTES);
    }
    setAlarmLedgerReady(true);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getStoredAlarmSound(user.id).then((sound) => {
      if (!cancelled) setCustomAlarmSound(sound);
    }).catch((error: unknown) => {
      if (!cancelled) setSoundError(error instanceof Error ? error.message : "Could not load the saved alarm sound.");
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (!customAlarmSound) {
      setCustomAlarmUrl(null);
      return;
    }
    const url = URL.createObjectURL(customAlarmSound.blob);
    setCustomAlarmUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [customAlarmSound]);

  const doses = useMemo(() => buildDoses(rx.data?.prescriptions ?? [], logs.data?.doseLogs ?? [], snoozed), [rx.data, logs.data, snoozed, Date.now() / 5_000 | 0]);
  const queueAlarm = useCallback((key: string, medicine: string, color?: string) => {
    alarmQueue.current = alarmQueue.current.then(async () => {
      if (!soundContext.current || cancelledAlarms.current.has(key)) return;
      activeAudioKey.current = key;
      try {
        await playMedicineAlarm(soundContext.current, medicine, color, customAlarmUrl, activeAudio, () => cancelledAlarms.current.has(key));
      } finally {
        if (activeAudioKey.current === key) activeAudioKey.current = null;
      }
    }).catch((error: unknown) => {
      setSoundError(error instanceof Error ? error.message : "Could not play the medicine alarm.");
    });
  }, [customAlarmUrl]);

  useEffect(() => {
    if (!alarmLedgerReady || !user?.id) return;
    const canNotify = Boolean(user?.preferences.browserNotifications && typeof Notification !== "undefined" && Notification.permission === "granted");
    const now = Date.now();
    const dueAlarms: Array<{ key: string; medicine: string; color?: string; dueAt: number }> = [];
    for (const dose of doses) {
      const elapsed = now - dose.at.getTime();
      if (elapsed < 0 || elapsed >= 24 * 60 * 60_000 || dose.status === "taken" || dose.status === "skipped") continue;
      const item = rx.data?.prescriptions.find((prescription) => prescription.id === dose.rxId)?.items[dose.itemIndex];
      dueAlarms.push({ key: `prescription:${dose.key}`, medicine: dose.name, color: item?.color, dueAt: dose.at.getTime() });
    }
    const current = new Date();
    const dayKey = `${current.getFullYear()}-${current.getMonth()}-${current.getDate()}`;
    for (const reminder of reminders.data?.reminders ?? []) {
      const [hour, minute] = reminder.time.split(":").map(Number);
      const due = new Date(current);
      due.setHours(hour, minute, 0, 0);
      const key = `manual:${reminder.id}:${dayKey}`;
      const elapsed = current.getTime() - due.getTime();
      if (elapsed < 0 || elapsed >= 24 * 60 * 60_000) continue;
      dueAlarms.push({ key, medicine: reminder.medicine, color: reminder.color, dueAt: due.getTime() });
    }
    const nextLedger = { ...alarmLedger };
    let changed = false;
    for (const [key, entry] of Object.entries(nextLedger)) {
      if (now - entry.dueAt >= 24 * 60 * 60_000) {
        delete nextLedger[key];
        changed = true;
      }
    }
    for (const alarm of dueAlarms) {
      let entry = nextLedger[alarm.key];
      if (entry?.acknowledged) continue;
      if (!entry) {
        entry = { medicine: alarm.medicine, color: alarm.color, dueAt: alarm.dueAt };
        nextLedger[alarm.key] = entry;
        changed = true;
      }
      if ((!entry.lastRangAt || now - entry.lastRangAt >= repeatMinutes * 60_000) && (soundEnabled || canNotify)) {
        if (canNotify) new Notification("Medicine reminder", { body: `${alarm.medicine}${alarm.color ? `, color ${alarm.color}` : ""} is due now.` });
        if (soundEnabled) queueAlarm(alarm.key, alarm.medicine, alarm.color);
        entry.lastRangAt = now;
        changed = true;
      }
    }
    if (changed) {
      setAlarmLedger(nextLedger);
      try {
        localStorage.setItem(alarmLedgerKey(user.id), JSON.stringify(nextLedger));
      } catch (error) {
        setSoundError(error instanceof Error ? error.message : "Could not save medicine alarm status.");
      }
    }
  }, [alarmLedger, alarmLedgerReady, doses, queueAlarm, reminders.data, repeatMinutes, rx.data, soundEnabled, user]);

  const snooze = (key: string) => { const next = { ...snoozed, [key]: Date.now() + 10 * 60_000 }; setSnoozed(next); localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)); };
  const action = useAction();
  const reminderAction = useAction();
  const acknowledgeAlarm = (key: string) => {
    const entry = alarmLedger[key];
    if (!entry || !user?.id) return;
    const next = { ...alarmLedger, [key]: { ...entry, acknowledged: true } };
    setAlarmLedger(next);
    try {
      localStorage.setItem(alarmLedgerKey(user.id), JSON.stringify(next));
    } catch (error) {
      setSoundError(error instanceof Error ? error.message : "Could not save alarm acknowledgement.");
    }
    cancelledAlarms.current.add(key);
    if (activeAudioKey.current === key) {
      activeAudio.current?.pause();
      window.speechSynthesis?.cancel();
    }
  };
  const updateRepeatMinutes = (value: number) => {
    if (!Number.isInteger(value) || value < 1 || value > 60 || !user?.id) return;
    setRepeatMinutes(value);
    try {
      localStorage.setItem(alarmIntervalKey(user.id), String(value));
    } catch (error) {
      setSoundError(error instanceof Error ? error.message : "Could not save the alarm repeat interval.");
    }
  };
  const saveCustomAlarmSound = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !user?.id) return;
    setSoundError("");
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const inferredType = ALARM_AUDIO_TYPES[extension];
    const player = new Audio();
    const audioType = [file.type, inferredType].find((type) => type?.startsWith("audio/") && player.canPlayType(type));
    if (!audioType) {
      setSoundError("Choose an audio file this browser can play, such as MP3, WAV, OGG, M4A, AAC, or WebM.");
      return;
    }
    if (file.size > ALARM_SOUND_MAX_BYTES) {
      setSoundError("The audio file must be 10 MB or smaller.");
      return;
    }
    const sound = { name: file.name, blob: file.slice(0, file.size, audioType) };
    try {
      await saveAlarmSound(user.id, sound);
      setCustomAlarmSound(sound);
    } catch (error) {
      setSoundError(error instanceof Error ? error.message : "Could not save the custom alarm sound.");
    }
  };
  const removeCustomAlarmSound = async () => {
    if (!user?.id) return;
    setSoundError("");
    try {
      await saveAlarmSound(user.id, null);
      setCustomAlarmSound(null);
    } catch (error) {
      setSoundError(error instanceof Error ? error.message : "Could not remove the custom alarm sound.");
    }
  };
  const previewAlarmSound = async () => {
    if (!customAlarmUrl) return;
    try {
      const audio = new Audio(customAlarmUrl);
      activeAudio.current = audio;
      await audio.play();
      audio.addEventListener("ended", () => { if (activeAudio.current === audio) activeAudio.current = null; }, { once: true });
    } catch (error) {
      setSoundError(error instanceof Error ? error.message : "Could not preview the MP3 alarm.");
    }
  };
  const enableSound = async () => {
    setSoundError("");
    if (!("AudioContext" in window) || !("speechSynthesis" in window)) {
      setSoundError("Sound and spoken alarms are not supported by this browser.");
      return;
    }
    try {
      soundContext.current ??= new AudioContext();
      await soundContext.current.resume();
      setSoundEnabled(true);
    } catch (error) {
      setSoundError(error instanceof Error ? error.message : "Could not enable sound alarms.");
    }
  };
  const record = async (dose: Dose, status: "taken" | "skipped") => {
    if (await action.run(() => post("/dose-logs", { prescriptionId: dose.rxId, itemIndex: dose.itemIndex, scheduledAt: dose.at.toISOString(), status }))) {
      acknowledgeAlarm(`prescription:${dose.key}`);
      logs.reload();
    }
  };
  const addReminder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (await reminderAction.run(() => post("/medicine-reminders", { medicine: manualMedicine, color: manualColor, time: manualTime }))) {
      setManualMedicine("");
      setManualColor("");
      setManualTime("");
      reminders.reload();
    }
  };
  const removeReminder = async (id: string) => {
    if (await reminderAction.run(() => del(`/medicine-reminders/${encodeURIComponent(id)}`))) reminders.reload();
  };

  const today = new Date().toDateString();
  const todays = doses.filter((d) => d.at.toDateString() === today);
  const history = doses.filter((d) => d.at.getTime() <= Date.now() && !todays.includes(d)).reverse();
  const unack = doses.filter((d) => d.status === "unacknowledged");
  const activeAlarms = Object.entries(alarmLedger)
    .filter(([, entry]) => !entry.acknowledged && Date.now() - entry.dueAt < 24 * 60 * 60_000)
    .sort(([, first], [, second]) => first.dueAt - second.dueAt);

  return (
    <div className="stack-lg">
      <div className="tabs" role="tablist">{(["reminders", "prescriptions", "check"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t === "check" ? "Medicine check" : humanize(t)}</button>)}</div>
      {tab === "reminders" && (rx.loading || logs.loading || reminders.loading ? <Loading /> : <>
        <NotificationSettings />
        <Alert>
          <strong>Audible alarms:</strong> A shared MP3 plays for up to 30 seconds, then the medicine name and color are spoken three times. The alarm repeats until acknowledged.{" "}
          {soundEnabled ? <Badge tone="good">Sound alarms on for this page</Badge> : <button className="outline-button" onClick={() => void enableSound()}><Volume2 size={14} /> Enable sound alarms</button>}
          {soundError && <small> {soundError}</small>}
        </Alert>
        {action.error && <Alert kind="error">{action.error}</Alert>}
        <Panel title="Alarm preferences" kicker="Shared by all medicine alarms">
          <p className="muted">Choose how often an unacknowledged alarm repeats. Your MP3 is saved in this browser for your account and can be replaced or removed at any time.</p>
          <div className="medicine-alarm-settings">
            <Field label="Repeat interval (minutes)">
              <input type="number" min={1} max={60} step={1} value={repeatMinutes} onChange={(event) => updateRepeatMinutes(Number(event.target.value))} />
            </Field>
            <Field label="Shared alarm sound (audio file, optional)">
              <input type="file" accept="audio/*" onChange={(event) => void saveCustomAlarmSound(event)} />
            </Field>
            {customAlarmSound && <div className="medicine-alarm-sound-actions">
              <span className="muted">Using {customAlarmSound.name}</span>
              <button className="outline-button" type="button" onClick={() => void previewAlarmSound()}>Preview sound</button>
              <button className="outline-button" type="button" onClick={() => void removeCustomAlarmSound()}>Remove sound</button>
            </div>}
          </div>
          {soundError && <Alert kind="error">{soundError}</Alert>}
        </Panel>
        {activeAlarms.length > 0 && <Panel title="Alarms needing acknowledgement" kicker="Repeats until acknowledged">
          <ul className="list medicine-active-alarms">
            {activeAlarms.map(([key, entry]) => (
              <li key={key}>
                <div><strong>{entry.medicine}</strong><small>{entry.color || "Color not specified"} · Due {new Date(entry.dueAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></div>
                <button className="outline-button" type="button" onClick={() => acknowledgeAlarm(key)}>Acknowledge alarm</button>
              </li>
            ))}
          </ul>
          <small className="muted">Acknowledging stops repeat alerts only; it does not record a dose as taken or skipped.</small>
        </Panel>}
        <Panel title="Add a medicine alarm" kicker="Daily reminder">
          <Alert>Set a reminder for a medicine you already take as directed. This does not create a prescription or change your treatment. Alarms work only while Smart Diagno is open on this page. Enter the tablet color so the voice alert can identify it.</Alert>
          <form className="medicine-reminder-form" onSubmit={addReminder}>
            <Field label="Medicine name">
              <input value={manualMedicine} onChange={(event) => setManualMedicine(event.target.value)} minLength={2} maxLength={120} placeholder="Enter medicine name" required />
            </Field>
            <Field label="Tablet color">
              <input value={manualColor} onChange={(event) => setManualColor(event.target.value)} maxLength={40} placeholder="e.g. white" required />
            </Field>
            <Field label="Alarm time">
              <input type="time" value={manualTime} onChange={(event) => setManualTime(event.target.value)} required />
            </Field>
            {reminderAction.error && <Alert kind="error">{reminderAction.error}</Alert>}
            <button className="button" type="submit" disabled={reminderAction.busy}><Plus size={15} /> Add daily alarm</button>
          </form>
          {reminders.data?.reminders.length ? (
            <ul className="list">
              {reminders.data.reminders.map((reminder) => (
                <li key={reminder.id}>
                  <div><strong>{reminder.medicine}</strong><small>{reminder.color || "Color not specified"} · Every day at {new Date(`2000-01-01T${reminder.time}:00`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></div>
                  <button className="icon-btn" aria-label={`Remove ${reminder.medicine} alarm`} onClick={() => void removeReminder(reminder.id)}><Trash2 size={15} /></button>
                </li>
              ))}
            </ul>
          ) : <p className="muted">No personal medicine alarms yet.</p>}
        </Panel>
        {unack.length > 0 && <Alert kind="warn">{unack.length} dose{unack.length > 1 ? "s were" : " was"} not acknowledged. Don't double up on a missed dose. Ask your doctor or pharmacist what to do.</Alert>}
        <Panel title="Today" kicker="From your doctor's prescription">
          {todays.length === 0 ? <Empty icon={<Pill size={22} />} title="No doses today" text="Reminders are created only from active prescriptions issued by a verified doctor." /> :
            <ul className="list">{todays.map((d) => <DoseRow key={d.key} dose={d} onTaken={() => record(d, "taken")} onSkip={() => record(d, "skipped")} onSnooze={() => snooze(d.key)} />)}</ul>}
        </Panel>
        <Panel title="Recent history (7 days)">
          {history.length === 0 ? <p className="muted">No past doses yet.</p> : <ul className="list">{history.slice(0, 40).map((d) => <DoseRow key={d.key} dose={d} compact onTaken={() => record(d, "taken")} onSkip={() => record(d, "skipped")} onSnooze={() => undefined} />)}</ul>}
        </Panel></>)}
      {tab === "prescriptions" && <Prescriptions rx={rx} />}
      {tab === "check" && <MedicineCheck />}
    </div>
  );
}

function DoseRow({ dose, compact, onTaken, onSkip, onSnooze }: { dose: Dose; compact?: boolean; onTaken: () => void; onSkip: () => void; onSnooze: () => void }) {
  const open = dose.status === "due" || dose.status === "unacknowledged";
  return (
    <li><div><strong>{dose.name}</strong><small>{dose.at.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} · {dose.detail}</small></div>
      <div className="row-actions">
        <Badge tone={statusTone(dose.status)}>{dose.status === "unacknowledged" ? "Not acknowledged" : humanize(dose.status)}</Badge>
        {open && <><button className="button button-small" onClick={onTaken}>Taken</button>{!compact && dose.status === "due" && <button className="outline-button" onClick={onSnooze}>Snooze 10 min</button>}<button className="outline-button" onClick={onSkip}>Skipped</button></>}
      </div></li>
  );
}

function NotificationSettings() {
  const { user, refresh } = useAuth();
  const action = useAction();
  const enable = async () => {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    await action.run(() => put("/me/preferences", { browserNotifications: perm === "granted" }));
    await refresh();
  };
  const on = user?.preferences.browserNotifications && typeof Notification !== "undefined" && Notification.permission === "granted";
  return (
    <Alert>
      <strong>Reminders work while Smart Diagno is open.</strong> Browser notifications can't be guaranteed in the background — browsers and devices may block or delay them, and push, SMS and email are not configured. Don't rely on this alone.{" "}
      {on ? <Badge tone="good">Browser notifications on</Badge> : typeof Notification === "undefined" ? <Badge>Not supported by this browser</Badge> : <button className="outline-button" onClick={enable}><Bell size={14} /> Enable browser notifications</button>}
      {action.error && <small> {action.error}</small>}
    </Alert>
  );
}

function Prescriptions({ rx }: { rx: ReturnType<typeof useLoad<{ prescriptions: Rx[] }>> }) {
  const [sharing, setSharing] = useState<Rx | null>(null);
  if (rx.loading) return <Loading />;
  if (rx.error) return <Alert kind="error">{rx.error}</Alert>;
  const list = rx.data!.prescriptions;
  return (
    <Panel title="Prescriptions" kicker="Issued by verified doctors">
      {list.length === 0 ? <Empty icon={<FileText size={22} />} title="No prescriptions" text="Only a verified doctor can issue a prescription after a consultation." /> :
        <ul className="rx-list">{list.map((p) => (
          <li key={p.id} className="rx-card"><header><div><strong>{p.id}</strong><small>{p.doctorName} · {fmtDate(p.issuedAt)}</small></div><Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge></header>
            <ul className="bullets">{p.items.map((i, n) => <li key={n}><strong>{i.name}</strong> — {i.dose}, {i.route}, {i.frequency}{i.timing ? `, ${i.timing}` : ""}, {i.durationDays} days{i.color ? ` · tablet color ${i.color}` : ""}{i.instructions ? `. ${i.instructions}` : ""}</li>)}</ul>
            {p.notes && <p>{p.notes}</p>}{p.status === "revoked" && <Alert kind="error">Revoked{p.revokeReason ? `: ${p.revokeReason}` : ""}. Contact your doctor; don't change treatment on your own.</Alert>}
            <div className="row-actions"><Link to={p.verifyPath} className="outline-button">Verification page</Link>{p.status === "active" && <button className="button button-small" onClick={() => setSharing(p)}><Send size={14} /> Share with pharmacy</button>}</div></li>))}</ul>}
      {sharing && <ShareModal rx={sharing} onClose={() => setSharing(null)} onDone={() => { setSharing(null); navigate("/app/orders"); }} />}
    </Panel>
  );
}

function ShareModal({ rx, onClose, onDone }: { rx: Rx; onClose: () => void; onDone: () => void }) {
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState("Finding nearby pharmacies…");
  const pharmacies = useLoad(
    () => get<{ pharmacies: any[] }>(`/pharmacies${location ? `?${new URLSearchParams({ lat: String(location.lat), lng: String(location.lng), radiusKm: String(PHARMACY_SEARCH_RADIUS_KM) })}` : ""}`),
    [location?.lat, location?.lng]
  );
  const [pharmacyId, setPharmacyId] = useState("");
  const [address, setAddress] = useState("");
  const [consent, setConsent] = useState(false);
  const action = useAction();
  useEffect(() => {
    let active = true;
    detectDeviceLocation().catch(() => get<{ lat: number; lng: number; label: string }>("/places/my-location"))
      .then((result) => {
        if (!active) return;
        setLocation({ lat: result.lat, lng: result.lng });
        setLocationLabel(`Showing verified pharmacies within ${PHARMACY_SEARCH_RADIUS_KM} km`);
      })
      .catch(() => {
        if (!active) return;
        setLocationLabel("Location unavailable; showing all verified pharmacies");
      });
    return () => { active = false; };
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await action.run(() => post(`/prescriptions/${rx.id}/share`, { pharmacyId, consent: true, ...(address ? { deliveryAddress: address } : {}) }))) onDone();
  };
  return (
    <Modal title={`Share ${rx.id}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <small className="muted">{locationLabel}</small>
        {pharmacies.loading ? <Loading /> : !pharmacies.data ? <Alert kind="error">{pharmacies.error ?? "Couldn't load pharmacies."}</Alert> : pharmacies.data.pharmacies.length === 0 ? <Alert>No verified pharmacies are available in this area yet.</Alert> :
          <fieldset className="slot-grid"><legend>Choose a verified pharmacy</legend>{pharmacies.data.pharmacies.map((p) => (
            <label key={p.id} className={pharmacyId === p.id ? "selected" : ""}><input type="radio" name="ph" checked={pharmacyId === p.id} onChange={() => { setPharmacyId(p.id); setConsent(false); }} /><span>{p.name}</span><small>{p.address} · {p.distanceKm == null ? "Distance unavailable" : `${p.distanceKm} km`} · {p.hours || "Hours not listed"} · {p.delivery ? "Delivers" : "Pickup only"}</small>
              {p.lat != null && p.lng != null && <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><Navigation size={12} /> Directions</a>}</label>))}</fieldset>}
        <Field label="Delivery address (optional)"><input value={address} onChange={(e) => { setAddress(e.target.value); setConsent(false); }} maxLength={250} /></Field>
        <label className="check-row consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>I agree to share this prescription (medicines and doctor details) and my first name with the selected pharmacy. They can't see the rest of my health record.</span></label>
        {action.error && <Alert kind="error">{action.error}</Alert>}
        <SubmitButton busy={action.busy} disabled={!consent || !pharmacyId}>Share prescription</SubmitButton>
      </form>
    </Modal>
  );
}

function MedicineCheck() {
  const [f, setF] = useState({ productName: "", batchNo: "", barcode: "" });
  const [result, setResult] = useState<any>(null);
  const action = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: any = { productName: f.productName };
    if (f.batchNo) body.batchNo = f.batchNo;
    if (f.barcode) body.barcode = f.barcode;
    const r = await action.run(() => post("/medicine-verification", body));
    if (r) setResult(r);
  };
  return (
    <Panel title="Medicine information check" kicker="Not an authenticity guarantee">
      <Alert>No manufacturer or regulator system is connected. This only compares the name with listings from verified pharmacies and can't confirm a product is genuine.</Alert>
      <form className="stack" onSubmit={submit}>
        <Field label="Product name"><input value={f.productName} onChange={(e) => setF({ ...f, productName: e.target.value })} required minLength={2} /></Field>
        <div className="grid-2"><Field label="Batch / lot number (optional)"><input value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} /></Field><Field label="Barcode (optional)"><input value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} /></Field></div>
        {action.error && <Alert kind="error">{action.error}</Alert>}
        <SubmitButton busy={action.busy}>Check</SubmitButton>
      </form>
      {result && <Alert kind={result.status === "details_matched" ? "info" : "warn"}><strong>{result.label}</strong><br />{result.explanation}</Alert>}
    </Panel>
  );
}

/* ---------- Orders ---------- */
export function Orders() {
  const list = useLoad(() => get<{ orders: any[] }>("/orders"), []);
  const prescriptions = useLoad(() => get<{ prescriptions: Rx[] }>("/prescriptions"), []);
  const [shops, setShops] = useState<any[]>([]);
  const [mapListingsUnavailable, setMapListingsUnavailable] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState("Finding your location…");
  const [locationError, setLocationError] = useState("");
  const [nearbyLoading, setNearbyLoading] = useState(true);
  const [pharmacyId, setPharmacyId] = useState("");
  const [prescriptionId, setPrescriptionId] = useState("");
  const [medicineText, setMedicineText] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const [consent, setConsent] = useState(false);
  const [requestDone, setRequestDone] = useState(false);
  const [manualCountry, setManualCountry] = useState("");
  const [manualState, setManualState] = useState("");
  const [manualDistrict, setManualDistrict] = useState("");
  const [manualVillage, setManualVillage] = useState("");
  const [manualPostalCode, setManualPostalCode] = useState("");
  const [customManualVillage, setCustomManualVillage] = useState(false);
  const [pharmacyChat, setPharmacyChat] = useState<{ id: string; title: string } | null>(null);
  const action = useAction();
  const act = async (id: string, a: string) => { if (await action.run(() => patch(`/orders/${id}/patient`, { action: a }))) list.reload(); };

  const loadNearby = async (lat: number, lng: number) => {
    setNearbyLoading(true);
    try {
      const result = await get<{ shops: any[]; mapListingsAvailable?: boolean }>(`/places/pharmacies?${new URLSearchParams({ lat: String(lat), lng: String(lng), radiusKm: String(PHARMACY_SEARCH_RADIUS_KM) })}`);
      setShops(result.shops);
      setMapListingsUnavailable(result.mapListingsAvailable === false);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Nearby shops could not be loaded.");
    } finally {
      setNearbyLoading(false);
    }
  };

  const clearManualSearchResults = () => {
    setShops([]);
    setPharmacyId("");
    setConsent(false);
    setMapListingsUnavailable(false);
    setLocationError("");
    setLocationLabel("Enter a locality and postal code to search medical shops.");
  };

  const searchManualArea = async () => {
    const country = manualCountry.trim();
    const postalCode = manualPostalCode.trim();
    if (!country || !manualState.trim() || !manualDistrict.trim() || manualVillage.trim().length < 2) {
      setLocationError("Enter a country, state, district, and village/locality.");
      return;
    }
    const validPostalCode = country === "India" ? /^\d{6}$/.test(postalCode) : /^[A-Za-z0-9 -]{3,12}$/.test(postalCode);
    if (!validPostalCode) {
      setLocationError(country === "India" ? "Enter the six-digit pincode for this village." : "Enter a valid postal code for this locality.");
      return;
    }
    setNearbyLoading(true);
    setLocationError("");
    setMapListingsUnavailable(false);
    setPharmacyId("");
    setConsent(false);
    setRequestDone(false);
    try {
      const query = new URLSearchParams({
        country,
        state: manualState.trim(),
        district: manualDistrict.trim(),
        village: manualVillage.trim(),
        postalCode,
      });
      const result = await get<{ shops: any[]; area: string; center: { lat: number; lng: number }; mapListingsAvailable?: boolean }>(`/places/pharmacies/search?${query}`);
      setShops(result.shops);
      setCoords(result.center);
      setMapListingsUnavailable(result.mapListingsAvailable === false);
      setLocationLabel(`Showing medical shops in ${result.area} · pincode ${postalCode}`);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Medical shops could not be found for this locality.");
      setShops([]);
    } finally {
      setNearbyLoading(false);
    }
  };

  const openPharmacyChat = async (shop: any) => {
    try {
      const result = await get<{ chat: { id: string } }>(`/pharmacy-chats/shop/${encodeURIComponent(shop.id)}`);
      setPharmacyChat({ id: result.chat.id, title: `Message ${shop.name}` });
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "This shop's messages could not be opened.");
    }
  };

  const locateNearby = async () => {
    setNearbyLoading(true);
    setLocationError("");
    setMapListingsUnavailable(false);
    setPharmacyId("");
    setConsent(false);
    try {
      try {
        const device = await detectDeviceLocation();
        setCoords(device);
        setLocationLabel(`Using your device location · within ${PHARMACY_SEARCH_RADIUS_KM} km`);
        await loadNearby(device.lat, device.lng);
      } catch {
        const fallback = await get<{ lat: number; lng: number; label: string; source: string }>("/places/my-location");
        setCoords({ lat: fallback.lat, lng: fallback.lng });
        setLocationLabel(`Approximate location: ${fallback.label} · within ${PHARMACY_SEARCH_RADIUS_KM} km`);
        await loadNearby(fallback.lat, fallback.lng);
      }
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Could not find shops near you.");
      setNearbyLoading(false);
    }
  };

  useEffect(() => { void locateNearby(); }, []);

  const chooseFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const allowed = ["application/pdf", "image/png", "image/jpeg"];
    const valid = selected.filter((file) => allowed.includes(file.type) && file.size <= 2 * 1024 * 1024);
    if (selected.length > 3 || valid.length !== selected.length || [...files, ...valid].length > 3) {
      setFileError("Choose up to 3 PDF, PNG or JPEG files, each no larger than 2 MB.");
    } else {
      setFiles((previous) => [...previous, ...valid]);
      setFileError("");
      setConsent(false);
    }
    event.target.value = "";
  };

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    const medicineRequests = medicineText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (!pharmacyId) return;
    if (!prescriptionId && medicineRequests.length === 0 && files.length === 0) {
      setFileError("Add a prescription, medicine list, or report/photo attachment.");
      return;
    }
    const result = await action.run(async () => {
      const attachments = await Promise.all(files.map(async (file) => {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read attachment."));
          reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
          reader.readAsDataURL(file);
        });
        return { name: file.name, mime: file.type, data: dataUrl.split(",")[1] ?? "" };
      }));
      return post("/orders", {
        pharmacyId,
        ...(prescriptionId ? { prescriptionId } : {}),
        ...(medicineRequests.length ? { medicineRequests } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(deliveryAddress.trim() ? { deliveryAddress: deliveryAddress.trim() } : {}),
        consent: true,
      });
    });
    if (result) {
      setRequestDone(true);
      setPharmacyId("");
      setPrescriptionId("");
      setMedicineText("");
      setDeliveryAddress("");
      setFiles([]);
      setConsent(false);
      list.reload();
    }
  };

  if (list.loading) return <Loading />;
  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  return (
    <Panel title="Pharmacy orders">
      <Alert>Payment is not processed online and live delivery tracking isn't available. Status updates come from the pharmacy.</Alert>
      {action.error && <Alert kind="error">{action.error}</Alert>}
      {requestDone && <Alert kind="success">Your pharmacy request was sent. The pharmacy will review it and prepare a quotation.</Alert>}
      <form className="stack pharmacy-request-form" onSubmit={submitRequest}>
        <div className="pharmacy-request-heading">
          <div><h2>Request medicines from a nearby pharmacy</h2><small>{locationLabel}</small></div>
          <button type="button" className="outline-button" onClick={() => void locateNearby()} disabled={nearbyLoading}><LocateFixed size={15} /> Refresh location</button>
        </div>
        {locationError && <Alert kind="warn">{locationError}</Alert>}
        <section className="pharmacy-address-search">
          <strong>Search shops by country and address</strong>
          <div className="grid-2">
            <Field label="Country">
              <select value={manualCountry} onChange={(event) => {
                setManualCountry(event.target.value);
                setManualState("");
                setManualDistrict("");
                setManualVillage("");
                setManualPostalCode("");
                setCustomManualVillage(false);
                clearManualSearchResults();
              }}>
                <option value="">Select country</option>
                {COUNTRIES.map((country) => <option key={country.code} value={country.name}>{country.name}</option>)}
              </select>
            </Field>
            <Field label="State / province">
              {manualCountry === "India" ? (
                <select value={manualState} disabled={!manualCountry} onChange={(event) => {
                  setManualState(event.target.value);
                  setManualDistrict("");
                  setManualVillage("");
                  setManualPostalCode("");
                  setCustomManualVillage(false);
                  clearManualSearchResults();
                }}>
                  <option value="">Select state</option>
                  {Object.keys(INDIA_STATES).map((state) => <option key={state} value={state}>{state}</option>)}
                </select>
              ) : (
                <input value={manualState} onChange={(event) => {
                  setManualState(event.target.value);
                  setManualDistrict("");
                  setManualVillage("");
                  setManualPostalCode("");
                  clearManualSearchResults();
                }} disabled={!manualCountry} placeholder="Enter state / province" />
              )}
            </Field>
            <Field label="District">
              {manualCountry === "India" && INDIA_STATES[manualState]?.districts.length ? (
                <select value={manualDistrict} disabled={!manualState} onChange={(event) => {
                  setManualDistrict(event.target.value);
                  setManualVillage("");
                  setManualPostalCode("");
                  setCustomManualVillage(false);
                  clearManualSearchResults();
                }}>
                  <option value="">Select district</option>
                  {INDIA_STATES[manualState].districts.map((district) => <option key={district.name} value={district.name}>{district.name}</option>)}
                </select>
              ) : (
                <input value={manualDistrict} onChange={(event) => {
                  setManualDistrict(event.target.value);
                  setManualVillage("");
                  setManualPostalCode("");
                  clearManualSearchResults();
                }} disabled={!manualState} placeholder="Enter district / county" />
              )}
            </Field>
            <Field label="Village / locality">
              {manualCountry === "India" && (INDIA_STATES[manualState]?.districts.find((district) => district.name === manualDistrict)?.villages?.length ?? 0) > 0 && !customManualVillage ? (
                <select value={manualVillage} disabled={!manualDistrict} onChange={(event) => {
                  if (event.target.value === "__custom__") {
                    setCustomManualVillage(true);
                    setManualVillage("");
                  } else {
                    setManualVillage(event.target.value);
                  }
                  setManualPostalCode("");
                  clearManualSearchResults();
                }}>
                  <option value="">Select village / locality</option>
                  {INDIA_STATES[manualState].districts.find((district) => district.name === manualDistrict)?.villages?.map((village) => <option key={village} value={village}>{village}</option>)}
                  <option value="__custom__">Enter another village / locality</option>
                </select>
              ) : (
                <input value={manualVillage} onChange={(event) => {
                  setManualVillage(event.target.value);
                  setManualPostalCode("");
                  clearManualSearchResults();
                }} disabled={!manualDistrict} placeholder="Enter village / locality" />
              )}
            </Field>
            {customManualVillage && <button className="text-link" type="button" onClick={() => {
              setCustomManualVillage(false);
              setManualVillage("");
              setManualPostalCode("");
              clearManualSearchResults();
            }}>Choose from village list</button>}
            <Field label="Pincode / postal code" hint={manualCountry === "India" ? "Enter the six-digit pincode for this village." : "Enter the postal code for this locality."}>
              <input value={manualPostalCode} onChange={(event) => {
                setManualPostalCode(event.target.value);
                clearManualSearchResults();
              }} placeholder={manualCountry === "India" ? "6-digit pincode" : "Postal code"} autoComplete="postal-code" inputMode={manualCountry === "India" ? "numeric" : "text"} maxLength={12} />
            </Field>
          </div>
          <button type="button" className="outline-button" onClick={() => void searchManualArea()} disabled={nearbyLoading}>
            <Search size={15} /> Search this village
          </button>
        </section>
        <section className="nearby-pharmacy-section">
          <strong>Choose a pharmacy</strong>
          <small className="muted">Map providers may not list every local shop. Only shops marked Verified can accept orders; map-only listings are not connected to in-app chat.</small>
          {mapListingsUnavailable && <Alert kind="warn">Map listings are temporarily unavailable. Try refreshing your location shortly.</Alert>}
          {nearbyLoading ? <Loading label="Finding nearby medical shops…" /> : shops.length === 0 ? (
            <Empty title={mapListingsUnavailable ? "Could not load nearby pharmacies" : "No nearby pharmacies found"} text={mapListingsUnavailable ? "The map provider could not be reached. Please refresh your location and try again." : "Try refreshing your location. Map-listed shops can be viewed, but only verified Smart Diagno pharmacies can receive requests."} />
          ) : (
            <div className="nearby-pharmacy-list">
              {shops.map((shop) => (
                <article key={shop.id} className={`nearby-pharmacy-card ${pharmacyId === shop.id ? "selected" : ""}`}>
                  <label>
                    <input type="radio" name="order-pharmacy" checked={pharmacyId === shop.id} disabled={!shop.orderable} onChange={() => { setPharmacyId(shop.id); setRequestDone(false); setConsent(false); }} />
                    <span><strong>{shop.name}</strong><small>{shop.address || "Address not listed"}</small><small>{shop.locationKnown === false ? "Distance unavailable · " : shop.distanceKm == null ? "" : `${shop.distanceKm} km · `}{shop.orderable ? "Verified — can receive orders" : shop.source === "smart-diagno" ? `Not verified (${shop.verification ?? "pending"}) — ordering unavailable; messaging available` : "Not verified — map listing; ordering and in-app messaging unavailable"}</small></span>
                  </label>
                  <div className="row-actions">
                    {shop.source === "smart-diagno" && <button type="button" className="outline-button button-small" onClick={() => void openPharmacyChat(shop)}><MessageSquare size={14} /> Message</button>}
                    <a className="outline-button button-small" href={shop.directionsUrl} target="_blank" rel="noreferrer"><Navigation size={14} /> Navigate</a>
                  </div>
                </article>
              ))}
            </div>
          )}
          {shops.some((shop) => shop.source === "openstreetmap") && <small className="muted">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></small>}
          {coords && <small className="muted">Location coordinates: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</small>}
        </section>
        <Field label="Doctor prescription (optional)">
          <select value={prescriptionId} onChange={(event) => { setPrescriptionId(event.target.value); setRequestDone(false); setConsent(false); }}>
            <option value="">No prescription</option>
            {(prescriptions.data?.prescriptions ?? []).filter((rx) => rx.status === "active").map((rx) => (
              <option key={rx.id} value={rx.id}>{rx.id} · Dr. {rx.doctorName} · {rx.items.map((item) => item.name).join(", ")}</option>
            ))}
          </select>
        </Field>
        <Field label="Medicine names (optional, one per line)">
          <textarea value={medicineText} onChange={(event) => { setMedicineText(event.target.value); setRequestDone(false); setConsent(false); }} rows={4} maxLength={2400} placeholder={"Enter medicine names and quantities if known, for example:\nMedicine name — 10 tablets"} />
        </Field>
        <Field label="Attach reports or photos (optional)" hint="PDF, PNG or JPEG. Up to 3 files, 2 MB each. Shared only with the selected pharmacy.">
          <input type="file" accept="application/pdf,image/png,image/jpeg" multiple onChange={chooseFiles} />
        </Field>
        {files.length > 0 && <ul className="pharmacy-upload-list">{files.map((file, index) => <li key={`${file.name}-${index}`}>{file.name} <button type="button" className="text-link" onClick={() => { setFiles((previous) => previous.filter((_, i) => i !== index)); setConsent(false); }}>Remove</button></li>)}</ul>}
        {fileError && <Alert kind="error">{fileError}</Alert>}
        <Field label="Delivery address (optional)"><input value={deliveryAddress} onChange={(event) => { setDeliveryAddress(event.target.value); setConsent(false); }} maxLength={250} /></Field>
        <label className="check-row consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I agree to share my name and the selected prescription, medicine list, attachments, and delivery address with this pharmacy. This does not share my other health records.</span></label>
        <SubmitButton busy={action.busy} disabled={!consent || !pharmacyId || nearbyLoading}>Send request to pharmacy</SubmitButton>
      </form>
      <PatientPharmacyChats />
      {pharmacyChat && <PharmacyConversation chatId={pharmacyChat.id} title={pharmacyChat.title} onClose={() => setPharmacyChat(null)} />}
      {list.data!.orders.length === 0 ? <Empty title="No orders" text="Your pharmacy requests and quotations will appear here." action={<Link to="/app/medicines" className="outline-button">Go to Medicines</Link>} /> :
        <ul className="rx-list">{list.data!.orders.map((o) => (
          <li key={o.id} className="rx-card"><header><div><strong>{o.pharmacyName}</strong><small>{o.prescription ? `Prescription ${o.prescription.id}` : "Medicine request"}</small></div><Badge tone={statusTone(o.status)}>{humanize(o.status)}</Badge></header>
            {o.medicineRequests?.length > 0 && <><strong>Requested medicines</strong><ul className="bullets">{o.medicineRequests.map((name: string, i: number) => <li key={i}>{name}</li>)}</ul></>}
            {o.attachments?.length > 0 && <div className="stack"><strong>Shared attachments</strong>{o.attachments.map((file: any) => <a key={file.id} href={file.url}>{file.name}</a>)}</div>}
            {o.quote && <div className="quote"><table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th></tr></thead><tbody>{o.quote.items.map((i: any, n: number) => <tr key={n}><td>{i.name}</td><td>{i.qty}</td><td>{i.unitPrice}</td></tr>)}</tbody></table><p>Delivery: {o.quote.deliveryFee} · <strong>Total: {o.quote.total}</strong></p>{o.quote.note && <small>{o.quote.note}</small>}</div>}
            <ol className="status-trail">{o.history.map((h: any, n: number) => <li key={n}>{humanize(h.status)} <small>{fmtDateTime(h.at)}{h.note ? ` — ${h.note}` : ""}</small></li>)}</ol>
            <div className="row-actions">
              {o.status === "awaiting_confirmation" && <><button className="button button-small" onClick={() => act(o.id, "confirm")}>Confirm quotation</button><button className="outline-button" onClick={() => act(o.id, "decline")}>Decline</button></>}
              {["received", "under_review", "confirmed", "preparing"].includes(o.status) && <button className="outline-button" onClick={() => confirm("Cancel this order?") && act(o.id, "cancel")}>Cancel order</button>}
            </div></li>))}</ul>}
    </Panel>
  );
}

/* ---------- Settings ---------- */
export function PatientSettings() {
  const { user, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [showDelPassword, setShowDelPassword] = useState(false);
  const [c, setC] = useState({ subject: "", details: "" });
  const del1 = useAction(), exp = useAction(), cmp = useAction();
  const exportData = async () => {
    const data = await exp.run(() => get("/me/export"));
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "smart-diagno-export.json"; a.click(); URL.revokeObjectURL(url);
  };
  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirm("This permanently deletes your account and health data. Continue?")) return;
    if (await del1.run(() => del("/me", { password }))) { await logout(); navigate("/"); }
  };
  const complain = async (e: React.FormEvent) => { e.preventDefault(); if (await cmp.run(() => post("/complaints", c), "Thanks — your report was sent to the administrators.")) setC({ subject: "", details: "" }); };
  return (
    <div className="grid-2">
      <Panel title="Account"><dl className="kv"><div><dt>Name</dt><dd>{user?.name}</dd></div><div><dt>Email</dt><dd>{user?.email}</dd></div><div><dt>Sign-in</dt><dd>{user?.authMethod}</dd></div></dl></Panel>
      <Panel title="Your data">
        <p>Download everything we hold about you as JSON (uploaded files excluded).</p>
        {exp.error && <Alert kind="error">{exp.error}</Alert>}
        <button className="outline-button" onClick={exportData}><Download size={15} /> Export my data</button>
        <hr />
        <form className="stack" onSubmit={remove}>
          <strong>Delete account</strong>
          <Field label="Confirm with your password" hint="Google-only accounts can leave this blank.">
            <div className="password-input-wrapper">
              <input
                type={showDelPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowDelPassword((v) => !v)}
                title={showDelPassword ? "Hide password" : "Show password"}
                aria-label={showDelPassword ? "Hide password" : "Show password"}
              >
                {showDelPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>
          {del1.error && <Alert kind="error">{del1.error}</Alert>}
          <SubmitButton busy={del1.busy} className="button danger">Delete my account</SubmitButton>
        </form>
      </Panel>
      <Panel title="Report a problem" className="span-2">
        <form className="stack" onSubmit={complain}>
          <Field label="Subject"><input value={c.subject} onChange={(e) => setC({ ...c, subject: e.target.value })} required minLength={3} maxLength={120} /></Field>
          <Field label="Details"><textarea rows={4} value={c.details} onChange={(e) => setC({ ...c, details: e.target.value })} required minLength={10} maxLength={1500} /></Field>
          {cmp.error && <Alert kind="error">{cmp.error}</Alert>}{cmp.done && <Alert kind="success">{cmp.done}</Alert>}
          <SubmitButton busy={cmp.busy}>Send report</SubmitButton>
        </form>
      </Panel>
    </div>
  );
}
