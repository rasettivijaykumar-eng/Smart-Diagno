import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Building2, CalendarDays, ExternalLink,
  LocateFixed, MapPin, Navigation, Phone, Search,
  Stethoscope, Star, Video, X, ChevronRight, RefreshCw,
} from "lucide-react";
import { get, post } from "./api";
import { useAuth } from "./auth";
import { navigate } from "./router";
import { Alert, Badge, Empty, Field, fmtDateTime, Loading, Modal, SubmitButton, useAction, useLoad } from "./ui";

export type Doctor = {
  id: string; name: string; specialty: string; qualifications: string; clinic: string; address: string; fee: number | null;
  languages: string[]; modes: string[]; openSlots: number; distanceKm: number | null; directionsUrl: string | null;
  demo: boolean; listingStatus: string;
};

type Hospital = {
  id: string; name: string; address: string; lat: number; lng: number; distanceKm: number;
  source: "google" | "openstreetmap"; directionsUrl: string; mapsUrl: string; phone?: string; rating?: number;
};

type HospitalWithDoctors = Hospital & { doctors: Doctor[] };


// ── Location helpers ────────────────────────────────────────────────────────

async function reverseGeocode(lat: string, lng: string): Promise<string> {
  try {
    const rev = await get<{ label: string }>(`/places/reverse-geocode?lat=${lat}&lng=${lng}`);
    return rev?.label || `${lat}, ${lng}`;
  } catch {
    return `${lat}, ${lng}`;
  }
}

// ── Hospital Card ────────────────────────────────────────────────────────────

function HospitalCard({ hospital, onClick }: { hospital: HospitalWithDoctors; onClick: () => void }) {
  const hasRegisteredDoctors = hospital.doctors.length > 0;
  return (
    <li className="hosp-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onClick()}>
      <div className="hosp-card-top">
        <div className="hosp-icon-wrap">
          <Building2 size={20} color="#0a6ed1" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="hosp-card-name">{hospital.name}</h3>
          <p className="hosp-card-addr">
            <MapPin size={11} color="#e05252" style={{ flexShrink: 0 }} />
            {hospital.address || "Address not available"}
          </p>
        </div>
        <ChevronRight size={18} color="#a0b0ab" style={{ flexShrink: 0 }} />
      </div>

      <div className="hosp-card-meta">
        <span className="hosp-badge dist">
          📍 {hospital.distanceKm} km away
        </span>
        {hospital.rating && (
          <span className="hosp-badge rating">
            <Star size={10} fill="#f59e0b" color="#f59e0b" /> {hospital.rating}
          </span>
        )}
        {hospital.phone && (
          <span className="hosp-badge phone">
            <Phone size={10} /> {hospital.phone}
          </span>
        )}
      </div>

      <div className="hosp-doctor-preview">
        {hasRegisteredDoctors ? (
          <>
            <span className="hosp-reg-tag">✅ {hospital.doctors.length} registered doctor{hospital.doctors.length > 1 ? "s" : ""}</span>
            <div className="hosp-doc-chips">
              {hospital.doctors.slice(0, 3).map((d) => (
                <span key={d.id} className="hosp-doc-chip">
                  <Stethoscope size={10} /> {d.name} · {d.specialty}
                </span>
              ))}
              {hospital.doctors.length > 3 && <span className="hosp-doc-chip muted">+{hospital.doctors.length - 3} more</span>}
            </div>
          </>
        ) : (
          <span className="hosp-noreg-tag">
            <AlertTriangle size={12} /> No registered doctors yet — click to view hospital info
          </span>
        )}
      </div>
    </li>
  );
}

// ── Hospital Detail Modal ─────────────────────────────────────────────────────

function HospitalDetailModal({
  hospital, onClose, onBooked,
}: {
  hospital: HospitalWithDoctors; onClose: () => void; onBooked: (appt?: any) => void;
}) {
  const { user } = useAuth();
  const [booking, setBooking] = useState<Doctor | null>(null);
  const hasRegisteredDoctors = hospital.doctors.length > 0;

  return (
    <Modal title={hospital.name} onClose={onClose}>
      <div className="hosp-detail-wrap">
        {/* Hospital info */}
        <div className="hosp-detail-info">
          <div className="hosp-detail-row">
            <MapPin size={15} color="#e05252" />
            <span>{hospital.address || "Address not listed"}</span>
          </div>
          {hospital.phone && (
            <div className="hosp-detail-row">
              <Phone size={15} color="#0a6ed1" />
              <a href={`tel:${hospital.phone}`}>{hospital.phone}</a>
            </div>
          )}
          {hospital.rating && (
            <div className="hosp-detail-row">
              <Star size={15} fill="#f59e0b" color="#f59e0b" />
              <span>Rating: {hospital.rating} / 5</span>
            </div>
          )}
          <div className="hosp-detail-row">
            <MapPin size={15} color="#6dab8a" />
            <span>{hospital.distanceKm} km from your location</span>
          </div>
          <div className="hosp-detail-actions">
            {hospital.directionsUrl && (
              <a className="outline-button button-small" href={hospital.directionsUrl} target="_blank" rel="noreferrer">
                <Navigation size={14} /> Get Directions
              </a>
            )}
            {hospital.mapsUrl && (
              <a className="outline-button button-small" href={hospital.mapsUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> View on Maps
              </a>
            )}
          </div>
        </div>

        {/* Doctors section */}
        <div className="hosp-detail-docs-section">
          <h3 style={{ margin: "0 0 12px", fontSize: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <Stethoscope size={17} color="#0a6ed1" />
            Doctors at this hospital
          </h3>

          {!hasRegisteredDoctors ? (
            <div className="hosp-no-doctors-warn">
              <AlertTriangle size={28} color="#d97706" />
              <div>
                <strong>No registered doctors yet</strong>
                <p>
                  No doctor has registered on Smart Diagno for this hospital yet.
                  Doctors who work here can sign up to enable online appointments.
                </p>
                {!user && (
                  <button className="button button-small" style={{ marginTop: "8px" }} onClick={() => { onClose(); navigate("/register"); }}>
                    Register as a Doctor
                  </button>
                )}
              </div>
            </div>
          ) : (
            <ul className="hosp-doc-list">
              {hospital.doctors.map((doc) => (
                <li key={doc.id} className="hosp-doc-row">
                  <div className="hosp-doc-avatar">{doc.name.replace(/^(Dr\.?\s*)/, "").slice(0, 1)}</div>
                  <div className="hosp-doc-info">
                    <strong>{doc.name}</strong>
                    <span style={{ color: "#0a6ed1", fontSize: "13px", fontWeight: 600 }}>{doc.specialty}</span>
                    <small>{doc.qualifications}</small>
                    <div className="hosp-doc-badges">
                      <Badge tone="good">Verified</Badge>
                      {doc.openSlots > 0 ? (
                        <Badge tone="good">{doc.openSlots} open slot{doc.openSlots > 1 ? "s" : ""}</Badge>
                      ) : (
                        <Badge tone="neutral">Flexible</Badge>
                      )}
                      {doc.modes.map((m) => (
                        <Badge key={m} tone="info">{m === "online" ? "🎥 Online" : "🏥 In-person"}</Badge>
                      ))}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {user?.role === "patient" || !user ? (
                      <button
                        type="button"
                        className="button button-small"
                        onClick={() => user ? setBooking(doc) : (() => { onClose(); navigate("/login"); })()}
                        style={{ minWidth: "140px" }}
                        title={`Book appointment with ${doc.name}`}
                      >
                        <CalendarDays size={14} />
                        Book Appointment
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {booking && (
        <BookingModal
          doctor={booking}
          onClose={() => setBooking(null)}
          onBooked={(appt) => { setBooking(null); onBooked(appt); onClose(); }}
        />
      )}
    </Modal>
  );
}

// ── Main DoctorSearch component ───────────────────────────────────────────────

export function DoctorSearch({ initialSpecialty = "", onBooked }: { initialSpecialty?: string; onBooked?: (appt?: any) => void }) {
  const [coords, setCoords] = useState<{ lat: string; lng: string }>({ lat: "", lng: "" });
  const [locNote, setLocNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [selectedHospital, setSelectedHospital] = useState<HospitalWithDoctors | null>(null);
  const [searchQ, setSearchQ] = useState(initialSpecialty);
  const [appliedCoords, setAppliedCoords] = useState<{ lat: string; lng: string }>({ lat: "", lng: "" });
  const [showAreaPicker, setShowAreaPicker] = useState(false);
  const [areaSearch, setAreaSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialSpecialty) {
      setSearchQ(initialSpecialty);
    }
  }, [initialSpecialty]);

  // Load nearby hospitals using /places/hospitals
  const hospitalQuery = new URLSearchParams();
  if (appliedCoords.lat && appliedCoords.lng) {
    hospitalQuery.set("lat", appliedCoords.lat);
    hospitalQuery.set("lng", appliedCoords.lng);
    hospitalQuery.set("radiusKm", "20");
  }
  if (searchQ.trim()) hospitalQuery.set("q", searchQ.trim());

  const hospitals = useLoad(
    () => get<{ hospitals: HospitalWithDoctors[]; center: { lat: number; lng: number }; radiusKm: number; location: string }>(
      `/places/hospitals?${hospitalQuery}`
    ),
    [hospitalQuery.toString()],
  );

  // GPS / IP location detection
  const locate = async (autoApply = false) => {
    setLocating(true);
    setLocNote("Acquiring your location…");

    const applyCoords = async (lat: string, lng: string, label?: string) => {
      setCoords({ lat, lng });
      if (autoApply) setAppliedCoords({ lat, lng });
      const lbl = label || await reverseGeocode(lat, lng);
      setLocNote(`📍 ${lbl}`);
      setLocating(false);
    };

    const gpsSuccess = async (pos: GeolocationPosition) => {
      const lat = pos.coords.latitude.toFixed(5);
      const lng = pos.coords.longitude.toFixed(5);
      await applyCoords(lat, lng);
    };

    const gpsFallback = async () => {
      try {
        const myLoc = await get<{ lat: number; lng: number; label: string }>("/places/my-location");
        if (myLoc?.lat && myLoc?.lng) {
          await applyCoords(String(myLoc.lat), String(myLoc.lng), myLoc.label || undefined);
          return;
        }
      } catch { /* ignore */ }
      await applyCoords("17.3843", "78.4583", "Hyderabad, Telangana");
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(gpsSuccess, gpsFallback, {
        enableHighAccuracy: true, timeout: 8000, maximumAge: 0,
      });
    } else {
      await gpsFallback();
    }
  };

  // Auto-locate on mount and immediately apply
  useEffect(() => {
    locate(true);
  }, []);

  // Filter hospitals client-side by name
  const filteredHospitals = (hospitals.data?.hospitals ?? []).filter(
    (h) => !searchQ || h.name.toLowerCase().includes(searchQ.toLowerCase()) || h.address.toLowerCase().includes(searchQ.toLowerCase()),
  );

  const doSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (coords.lat) setAppliedCoords({ ...coords });
    hospitals.reload();
  };

  return (
    <div className="doctor-search">
      {/* Search bar */}
      <form className="hosp-search-bar" onSubmit={doSearch}>
        <div className="hosp-search-input-wrap" ref={searchRef as any}>
          <Search size={16} color="#6b7a7a" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
          <input
            className="hosp-search-input"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search hospital name or location…"
          />
          {searchQ && (
            <button type="button" className="icon-btn" style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", width: 28, height: 28 }} onClick={() => setSearchQ("")}>
              <X size={14} />
            </button>
          )}
        </div>

        {/* Location row */}
        <div className="hosp-loc-row">
          <button type="button" className="outline-button button-small" onClick={() => locate(true)} disabled={locating}>
            {locating ? <RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> : <LocateFixed size={13} />}
            Detect GPS
          </button>
          <button type="button" className="outline-button button-small" onClick={() => setShowAreaPicker((v) => !v)}>
            <MapPin size={13} /> {showAreaPicker ? "Close" : "Change Area"}
          </button>
          {locNote && (
            <span className="hosp-loc-label">{locNote}</span>
          )}
          <button type="submit" className="button button-small" style={{ marginLeft: "auto" }}>
            <Search size={14} /> Search
          </button>
        </div>
      </form>

      {/* Area picker */}
      {showAreaPicker && (
        <div className="chat-area-picker-card">
          <div className="chat-area-picker-header">
            <strong>Search hospitals in a specific area</strong>
            <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setShowAreaPicker(false)}>
              <X size={14} />
            </button>
          </div>
          <form
            className="chat-area-search-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!areaSearch.trim()) return;
              try {
                const data = await get<{ lat: number; lng: number; label: string }>(`/places/geocode?q=${encodeURIComponent(areaSearch)}`);
                if (data?.lat) {
                  const nc = { lat: String(data.lat), lng: String(data.lng) };
                  setCoords(nc);
                  setAppliedCoords(nc);
                  setLocNote(`📍 ${data.label?.split(",").slice(0, 2).join(",").trim() || areaSearch}`);
                  setShowAreaPicker(false);
                  setAreaSearch("");
                }
              } catch { /* ignore */ }
            }}
          >
            <input
              value={areaSearch}
              onChange={(e) => setAreaSearch(e.target.value)}
              placeholder="Type village, district, city, state… e.g. Narayanavanam, Tirupati"
              autoFocus
            />
            <button type="submit" className="button button-small">Go</button>
          </form>
          <div className="preset-chips" style={{ padding: "10px 14px", flexWrap: "wrap", gap: "8px", display: "flex" }}>
            {[
              { label: "Narayanavanam", area: "Narayanavanam, Tirupati, Andhra Pradesh" },
              { label: "Tirupati", area: "Tirupati, Andhra Pradesh" },
              { label: "Hyderabad", area: "Hyderabad, Telangana" },
              { label: "Banjara Hills", area: "Banjara Hills, Hyderabad" },
              { label: "Secunderabad", area: "Secunderabad, Hyderabad" },
              { label: "Vijayawada", area: "Vijayawada, Andhra Pradesh" },
              { label: "Chennai", area: "Chennai, Tamil Nadu" },
              { label: "Bengaluru", area: "Bengaluru, Karnataka" },
            ].map((a) => (
              <button
                key={a.label}
                type="button"
                className="chip"
                style={{ fontSize: "12px", padding: "5px 12px" }}
                onClick={async () => {
                  try {
                    const data = await get<{ lat: number; lng: number; label: string }>(`/places/geocode?q=${encodeURIComponent(a.area)}`);
                    if (data?.lat) {
                      const nc = { lat: String(data.lat), lng: String(data.lng) };
                      setCoords(nc);
                      setAppliedCoords(nc);
                      setLocNote(`📍 ${a.label}`);
                      setShowAreaPicker(false);
                    }
                  } catch { /* ignore */ }
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results header */}
      {hospitals.data && (
        <div className="hosp-results-header">
          <span>
            <Building2 size={15} color="#0a6ed1" />
            {filteredHospitals.length > 0
              ? `${filteredHospitals.length} hospital${filteredHospitals.length > 1 ? "s" : ""} found within 20 km`
              : "No hospitals found in this area"}
          </span>
          {hospitals.data.location && <small>📍 {hospitals.data.location}</small>}
        </div>
      )}

      {/* Hospital list */}
      {hospitals.loading ? (
        <Loading label="Finding hospitals near you…" />
      ) : hospitals.error ? (
        <Alert kind="error">{hospitals.error}</Alert>
      ) : filteredHospitals.length === 0 ? (
        <Empty
          icon={<Building2 size={24} />}
          title="No hospitals found nearby"
          text={
            appliedCoords.lat
              ? "No hospitals found within 20 km of your location. Try 'Change Area' to search a different location."
              : "Enable location or search an area to see nearby hospitals."
          }
        />
      ) : (
        <ul className="hosp-grid">
          {filteredHospitals.map((h) => (
            <HospitalCard key={h.id} hospital={h} onClick={() => setSelectedHospital(h)} />
          ))}
        </ul>
      )}

      {/* Hospital detail modal */}
      {selectedHospital && (
        <HospitalDetailModal
          hospital={selectedHospital}
          onClose={() => setSelectedHospital(null)}
          onBooked={(appt) => { setSelectedHospital(null); onBooked?.(appt); hospitals.reload(); }}
        />
      )}
    </div>
  );
}

// ── Booking Modal ─────────────────────────────────────────────────────────────

export function BookingModal({
  doctor,
  onClose,
  onBooked,
}: {
  doctor: { id: string; name: string; modes?: string[]; specialty?: string };
  onClose: () => void;
  onBooked: (appt?: any) => void;
}) {
  const slots = useLoad(
    () => get<{ slots: Array<{ id: string; start: string; mode: string; durationMin: number }> }>(`/doctors/${doctor.id}/slots`),
    [doctor.id]
  );
  const [slotId, setSlotId] = useState("");
  const [selectedMode, setSelectedMode] = useState<"online" | "offline">(() => {
    if (doctor.modes?.length === 1 && doctor.modes[0] === "offline") return "offline";
    return "online";
  });
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [customDateTime, setCustomDateTime] = useState(() => {
    const d = new Date(Date.now() + 30 * 60_000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [reason, setReason] = useState("");
  const [share, setShare] = useState(true);
  const action = useAction();

  const openSlots = slots.data?.slots ?? [];
  const chosen = openSlots.find((s) => s.id === slotId);

  // Auto-select first slot if slots load and nothing selected yet
  useEffect(() => {
    if (openSlots.length > 0 && !slotId && !useCustomTime) {
      setSlotId(openSlots[0].id);
      if (openSlots[0].mode === "offline") setSelectedMode("offline");
      else if (openSlots[0].mode === "online") setSelectedMode("online");
    }
  }, [openSlots]);

  // When chosen slot changes, update selectedMode
  useEffect(() => {
    if (chosen) {
      if (chosen.mode === "offline") setSelectedMode("offline");
      else if (chosen.mode === "online") setSelectedMode("online");
    }
  }, [chosen]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const hasPredefinedSlots = openSlots.length > 0;
    let payload: any;
    if (hasPredefinedSlots && !useCustomTime && slotId) {
      const mode = chosen?.mode === "both" ? selectedMode : (chosen?.mode || selectedMode);
      payload = { slotId, mode, reason: reason.trim(), shareHistory: share };
    } else {
      payload = {
        doctorId: doctor.id,
        start: new Date(customDateTime).toISOString(),
        mode: selectedMode,
        reason: reason.trim(),
        shareHistory: share,
      };
    }
    const result = await action.run(() => post<{ appointment: any }>("/appointments", payload));
    if (result?.appointment) onBooked(result.appointment);
    else slots.reload();
  };

  const getMinDateTime = () => {
    const d = new Date(Date.now() - 5 * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const isFormValid =
    reason.trim().length >= 3 &&
    (openSlots.length > 0 && !useCustomTime ? Boolean(slotId) : Boolean(customDateTime));

  return (
    <Modal title={`Book appointment with ${doctor.name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {slots.loading ? (
          <Loading label="Loading available consultation slots…" />
        ) : slots.error ? (
          <Alert kind="error">{slots.error}</Alert>
        ) : openSlots.length > 0 && !useCustomTime ? (
          <div className="stack">
            <fieldset className="slot-grid">
              <legend>Choose an available time slot</legend>
              {openSlots.map((slot) => (
                <label key={slot.id} className={slotId === slot.id ? "selected" : ""}>
                  <input
                    type="radio"
                    name="slot"
                    checked={slotId === slot.id}
                    onChange={() => {
                      setSlotId(slot.id);
                      if (slot.mode === "offline") setSelectedMode("offline");
                      else if (slot.mode === "online") setSelectedMode("online");
                    }}
                  />
                  <span>{fmtDateTime(slot.start)}</span>
                  <small>
                    {slot.mode === "both" ? (
                      "🏥 In-person & 🎥 Online"
                    ) : slot.mode === "online" ? (
                      <><Video size={12} /> Online</>
                    ) : (
                      "🏥 In person"
                    )} · {slot.durationMin} min
                  </small>
                </label>
              ))}
            </fieldset>

            {chosen?.mode === "both" && (
              <Field label="Choose Consultation Format">
                <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer", fontWeight: 500 }}>
                    <input
                      type="radio"
                      name="slotBothMode"
                      checked={selectedMode === "offline"}
                      onChange={() => setSelectedMode("offline")}
                    />
                    <span>🏥 In person</span>
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer", fontWeight: 500 }}>
                    <input
                      type="radio"
                      name="slotBothMode"
                      checked={selectedMode === "online"}
                      onChange={() => setSelectedMode("online")}
                    />
                    <span>🎥 Online consultation</span>
                  </label>
                </div>
              </Field>
            )}

            <div style={{ marginTop: "4px" }}>
              <button
                type="button"
                className="text-link"
                style={{ fontSize: "12.5px", background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--deep)" }}
                onClick={() => setUseCustomTime(true)}
              >
                None of these slots fit? Request a preferred date & time →
              </button>
            </div>
          </div>
        ) : (
          <div className="stack">
            {openSlots.length === 0 ? (
              <Alert kind="info">
                Dr. {doctor.name} has flexible availability. Select your preferred date, time, and format below to book your appointment.
              </Alert>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>Preferred appointment time</span>
                <button
                  type="button"
                  className="text-link"
                  style={{ fontSize: "12px", background: "none", border: 0, cursor: "pointer", color: "var(--deep)" }}
                  onClick={() => setUseCustomTime(false)}
                >
                  ← Back to available slots
                </button>
              </div>
            )}

            <Field label="Preferred Date & Time">
              <input
                type="datetime-local"
                value={customDateTime}
                min={getMinDateTime()}
                onChange={(e) => setCustomDateTime(e.target.value)}
                required
              />
            </Field>

            <Field label="Consultation Format">
              <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer", fontWeight: 500 }}>
                  <input
                    type="radio"
                    name="customMode"
                    value="offline"
                    checked={selectedMode === "offline"}
                    onChange={() => setSelectedMode("offline")}
                  />
                  <span>🏥 In-person visit</span>
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer", fontWeight: 500 }}>
                  <input
                    type="radio"
                    name="customMode"
                    value="online"
                    checked={selectedMode === "online"}
                    onChange={() => setSelectedMode("online")}
                  />
                  <span>🎥 Online (Video)</span>
                </label>
              </div>
            </Field>
          </div>
        )}

        {selectedMode === "online" && (
          <Alert>Video calling: The doctor will connect with you via Google Meet / online consultation at the scheduled time.</Alert>
        )}
        {selectedMode === "offline" && (
          <Alert>In-person visit: Please visit the clinic/hospital at the scheduled time.</Alert>
        )}

        <Field label="Reason for visit / concern">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            rows={3}
            required
            minLength={3}
            placeholder="Briefly describe your symptoms or reason for booking..."
          />
        </Field>

        <label className="check-row consent">
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          <span>I allow this doctor to view my health timeline and symptoms for this consultation (recommended).</span>
        </label>

        {action.error && <Alert kind="error">{action.error}</Alert>}
        <SubmitButton busy={action.busy} disabled={!isFormValid}>
          <CalendarDays size={15} /> Confirm appointment
        </SubmitButton>
      </form>
    </Modal>
  );
}
