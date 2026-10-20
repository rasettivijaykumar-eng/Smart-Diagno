import { useEffect, useRef, useState, type FormEvent } from "react";
import { Activity, ArrowLeft, Building2, Eye, EyeOff, MapPin, ShieldCheck, Stethoscope, Pill, UserRound } from "lucide-react";
import { get, post } from "./api";
import { useAuth, type User } from "./auth";
import { COUNTRIES, INDIA_STATES } from "./locationData";
import { Link, navigate } from "./router";
import { Alert, Field, Loading, SubmitButton, useAction } from "./ui";

type Role = "patient" | "doctor" | "pharmacy";
const roleOptions: Array<{ id: Role; label: string; text: string; icon: React.ReactNode }> = [
  { id: "patient", label: "Patient", text: "Find care, keep records, follow prescriptions.", icon: <UserRound size={18} /> },
  { id: "doctor", label: "Doctor", text: "Manage availability and consultations. Requires verification.", icon: <Stethoscope size={18} /> },
  { id: "pharmacy", label: "Pharmacy", text: "Receive shared prescriptions and quote orders. Requires verification.", icon: <Pill size={18} /> },
];

function GoogleButton({ clientId, role, onDone }: { clientId: string; role: Role; onDone: (user: User) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const action = useAction();
  useEffect(() => {
    const init = () => {
      const google = (window as any).google;
      if (!google?.accounts?.id || !ref.current) return;
      google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response: { credential: string }) => {
          const result = await action.run(() => post<{ user: User }>("/auth/google", { credential: response.credential, role }));
          if (result) onDone(result.user);
        },
      });
      google.accounts.id.renderButton(ref.current, { theme: "outline", size: "large", width: 320, text: "continue_with" });
    };
    if ((window as any).google?.accounts) { init(); return; }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = init;
    document.head.appendChild(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, role]);
  return <div className="google-slot"><div ref={ref} />{action.error && <Alert kind="error">{action.error}</Alert>}</div>;
}

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { setUser, refresh, config, user } = useAuth();
  const action = useAction();
  const [role, setRole] = useState<Role>("patient");
  const [form, setForm] = useState<Record<string, string>>({});
  const [hospitals, setHospitals] = useState<any[]>([]);
  const [loadingHosp, setLoadingHosp] = useState(false);
  const [hospFilter, setHospFilter] = useState("");
  const [customClinic, setCustomClinic] = useState(false);
  const [nearbyPharmacies, setNearbyPharmacies] = useState<any[]>([]);
  const [pharmacyMapsUnavailable, setPharmacyMapsUnavailable] = useState(false);
  const [googlePlacesUnavailable, setGooglePlacesUnavailable] = useState(false);
  const [loadingPharmacies, setLoadingPharmacies] = useState(false);
  const [pharmacyLocation, setPharmacyLocation] = useState("");
  const [pharmacyLocationError, setPharmacyLocationError] = useState("");
  const [pharmacyProviderStatus, setPharmacyProviderStatus] = useState("");
  const [pharmacyCountry, setPharmacyCountry] = useState("");
  const [pharmacyState, setPharmacyState] = useState("");
  const [pharmacyDistrict, setPharmacyDistrict] = useState("");
  const [pharmacyVillage, setPharmacyVillage] = useState("");
  const [pharmacyPostalCode, setPharmacyPostalCode] = useState("");
  const [customPharmacyVillage, setCustomPharmacyVillage] = useState("");
  const pharmacySearchId = useRef(0);
  const [showPassword, setShowPassword] = useState(false);

  // Cascading location state
  const [selectedCountry, setSelectedCountry] = useState("India");
  const [selectedState, setSelectedState] = useState("Telangana");
  const [selectedDistrict, setSelectedDistrict] = useState("Hyderabad");
  const [selectedVillage, setSelectedVillage] = useState("Ameerpet");
  const [customVillage, setCustomVillage] = useState("");

  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  const isPharmacyPostalCodeValid = (country: string, postalCode: string) =>
    country === "India" ? /^\d{6}$/.test(postalCode.trim()) : /^[A-Za-z0-9 -]{3,12}$/.test(postalCode.trim());

  const clearSelectedPharmacy = () => {
    setForm((previous) => ({
      ...previous,
      businessName: previous.placeId ? "" : previous.businessName,
      address: previous.placeId ? "" : previous.address,
      placeId: "",
      lat: "",
      lng: "",
    }));
    setPharmacyMapsUnavailable(false);
    setGooglePlacesUnavailable(false);
    setPharmacyProviderStatus("");
  };

  useEffect(() => { if (user) navigate("/app", true); }, [user]);

  const fetchHospitalsForLocation = async (country: string, state: string, district: string, village: string) => {
    setLoadingHosp(true);
    try {
      const v = village.trim();
      const params = new URLSearchParams({
        country,
        state,
        district,
        ...(v ? { village: v } : {}),
        radiusKm: "25",
      });
      const res = await get<{ hospitals: any[] }>(`/places/hospitals?${params.toString()}`);
      if (res?.hospitals) {
        setHospitals(res.hospitals);
      }
    } catch {
      // ignore
    } finally {
      setLoadingHosp(false);
    }
  };

  const searchPharmaciesByAddress = async (
    country: string,
    state: string,
    district: string,
    village: string,
    postalCode: string,
  ) => {
    const searchId = ++pharmacySearchId.current;
    const area = [village, district, state, country].map((part) => part.trim()).filter(Boolean).join(", ");
    if (!country || (country === "India" && (!state || !district || !village))) {
      setPharmacyLocationError("Select a country, state, district and village/locality before searching.");
      setNearbyPharmacies([]);
      setLoadingPharmacies(false);
      return;
    }
    if (!isPharmacyPostalCodeValid(country, postalCode)) {
      setPharmacyLocationError(country === "India" ? "Enter a valid six-digit pincode before searching." : "Enter a valid postal code before searching.");
      setNearbyPharmacies([]);
      setLoadingPharmacies(false);
      return;
    }

    setLoadingPharmacies(true);
    setPharmacyLocationError("");
    setPharmacyMapsUnavailable(false);
    setGooglePlacesUnavailable(false);
    setPharmacyProviderStatus("");
    setNearbyPharmacies([]);
    setPharmacyLocation(`Searching for pharmacies in ${area}`);
    try {
      const result = await get<{
        shops: any[];
        area: string;
        center: { lat: number; lng: number };
        mapListingsAvailable?: boolean;
        googlePlacesConfigured?: boolean;
        providers?: Record<string, string>;
      }>(`/places/pharmacies/search?${new URLSearchParams({
        country,
        state,
        district,
        village,
        postalCode: postalCode.trim(),
      })}`);
      if (searchId !== pharmacySearchId.current) return;
      setForm((previous) => ({ ...previous, lat: String(result.center.lat), lng: String(result.center.lng) }));
      setNearbyPharmacies(result.shops);
      setPharmacyMapsUnavailable(result.mapListingsAvailable === false);
      setGooglePlacesUnavailable(result.googlePlacesConfigured === false);
      setPharmacyProviderStatus(Object.entries(result.providers ?? {}).map(([name, status]) => `${name}: ${status}`).join(" · "));
      setPharmacyLocation(`Showing shops in ${result.area}`);
    } catch (error) {
      if (searchId !== pharmacySearchId.current) return;
      setPharmacyLocation("");
      setPharmacyLocationError(error instanceof Error ? error.message : "Could not find pharmacies for this location.");
    } finally {
      if (searchId === pharmacySearchId.current) setLoadingPharmacies(false);
    }
  };

  const handlePharmacyCountryChange = (country: string) => {
    pharmacySearchId.current++;
    setPharmacyCountry(country);
    setPharmacyState("");
    setPharmacyDistrict("");
    setPharmacyVillage("");
    setPharmacyPostalCode("");
    setCustomPharmacyVillage("");
    setNearbyPharmacies([]);
    setPharmacyLocation("");
    setPharmacyLocationError("");
    setLoadingPharmacies(false);
    clearSelectedPharmacy();
  };

  const handlePharmacyStateChange = (state: string) => {
    pharmacySearchId.current++;
    setPharmacyState(state);
    setPharmacyDistrict("");
    setPharmacyVillage("");
    setPharmacyPostalCode("");
    setCustomPharmacyVillage("");
    setNearbyPharmacies([]);
    setPharmacyLocation("");
    setLoadingPharmacies(false);
    clearSelectedPharmacy();
  };

  const handlePharmacyDistrictChange = (district: string) => {
    pharmacySearchId.current++;
    setPharmacyDistrict(district);
    setPharmacyVillage("");
    setPharmacyPostalCode("");
    setCustomPharmacyVillage("");
    setNearbyPharmacies([]);
    setPharmacyLocation("");
    setLoadingPharmacies(false);
    clearSelectedPharmacy();
  };

  const handlePharmacyVillageChange = (village: string) => {
    pharmacySearchId.current++;
    setLoadingPharmacies(false);
    if (village === "__custom__") {
      setCustomPharmacyVillage("__custom__");
      setPharmacyVillage("");
      setPharmacyPostalCode("");
      setNearbyPharmacies([]);
      setPharmacyLocation("");
      clearSelectedPharmacy();
      return;
    }
    setCustomPharmacyVillage("");
    setPharmacyVillage(village);
    setPharmacyPostalCode("");
    clearSelectedPharmacy();
  };

  useEffect(() => {
    if (mode !== "register" || role !== "pharmacy" || !pharmacyCountry || !pharmacyState || !pharmacyDistrict || pharmacyVillage.trim().length < 2 || !isPharmacyPostalCodeValid(pharmacyCountry, pharmacyPostalCode)) return;
    if (customPharmacyVillage === "__custom__") return;
    const timer = window.setTimeout(() => {
      void searchPharmaciesByAddress(pharmacyCountry, pharmacyState, pharmacyDistrict, pharmacyVillage, pharmacyPostalCode);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [mode, role, pharmacyCountry, pharmacyState, pharmacyDistrict, pharmacyVillage, pharmacyPostalCode, customPharmacyVillage]);

  const selectPharmacy = (shop: any) => {
    setForm((previous) => ({
      ...previous, businessName: shop.name, address: shop.address || previous.address || "",
      placeId: shop.id, lat: String(shop.lat), lng: String(shop.lng),
    }));
  };

  // Initial fetch for doctor registration
  useEffect(() => {
    if (mode === "register" && role === "doctor") {
      fetchHospitalsForLocation(selectedCountry, selectedState, selectedDistrict, customVillage || selectedVillage);
    }
  }, [mode, role]);

  const handleCountryChange = (c: string) => {
    setSelectedCountry(c);
    if (c === "India") {
      setSelectedState("Telangana");
      setSelectedDistrict("Hyderabad");
      setSelectedVillage("Ameerpet");
      setCustomVillage("");
      fetchHospitalsForLocation("India", "Telangana", "Hyderabad", "Ameerpet");
    } else {
      setSelectedState("");
      setSelectedDistrict("");
      setSelectedVillage("");
      setCustomVillage("");
      fetchHospitalsForLocation(c, "", "", "");
    }
  };

  const handleStateChange = (s: string) => {
    setSelectedState(s);
    const districts = INDIA_STATES[s]?.districts || [];
    const firstDist = districts[0]?.name || "";
    setSelectedDistrict(firstDist);
    const firstVill = districts[0]?.villages?.[0] || "";
    setSelectedVillage(firstVill);
    setCustomVillage("");
    fetchHospitalsForLocation(selectedCountry, s, firstDist, firstVill);
  };

  const handleDistrictChange = (d: string) => {
    setSelectedDistrict(d);
    const villages = INDIA_STATES[selectedState]?.districts.find((item) => item.name === d)?.villages || [];
    const firstVill = villages[0] || "";
    setSelectedVillage(firstVill);
    setCustomVillage("");
    fetchHospitalsForLocation(selectedCountry, selectedState, d, firstVill);
  };

  const handleVillageChange = (v: string) => {
    setSelectedVillage(v);
    setCustomVillage("");
    fetchHospitalsForLocation(selectedCountry, selectedState, selectedDistrict, v);
  };

  const selectHospital = (h: any) => {
    setForm((prev) => ({
      ...prev,
      clinic: h.name,
      address: h.address,
      placeId: h.id,
      lat: String(h.lat),
      lng: String(h.lng),
    }));
  };

  const finish = async (next: User) => { setUser(next); await refresh(); navigate("/app"); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "register" && role === "pharmacy" && !isPharmacyPostalCodeValid(pharmacyCountry, pharmacyPostalCode)) {
      setPharmacyLocationError(pharmacyCountry === "India" ? "Enter a valid six-digit pincode before registering." : "Enter a valid postal code before registering.");
      return;
    }
    const payload = mode === "login"
      ? { email: form.email ?? "", password: form.password ?? "" }
      : {
        role, name: form.name ?? "", email: form.email ?? "", password: form.password ?? "",
        ...(role === "doctor" ? {
          specialty: form.specialty,
          licenseNo: form.licenseNo?.trim() || undefined,
          qualifications: form.qualifications,
          clinic: form.clinic,
          address: form.address,
          placeId: form.placeId || undefined,
          lat: form.lat ? Number(form.lat) : undefined,
          lng: form.lng ? Number(form.lng) : undefined,
        } : {}),
        ...(role === "pharmacy" ? {
          country: pharmacyCountry,
          businessName: form.businessName,
          licenseNo: form.licenseNo?.trim() || undefined,
          address: form.address,
          postalCode: pharmacyPostalCode.trim() || undefined,
          placeId: form.placeId || undefined,
          lat: form.lat ? Number(form.lat) : undefined,
          lng: form.lng ? Number(form.lng) : undefined,
        } : {}),
      };
    const result = await action.run(() => post<{ user: User }>(mode === "login" ? "/auth/login" : "/auth/register", payload));
    if (result) await finish(result.user);
  };

  const demo = config?.demoAccounts;
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <Link to="/" className="brand auth-brand"><span className="brand-mark"><Activity size={19} strokeWidth={2.4} /></span><span>smart<span className="brand-light">diagno</span></span></Link>
        <div>
          <h1>{mode === "login" ? "Welcome back." : "Create your account."}</h1>
          <p>One place for finding doctors, keeping your health history, following your prescriptions and coordinating with your pharmacy.</p>
          <ul>
            <li><ShieldCheck size={16} /> Records are visible only to you and clinicians you choose.</li>
            <li><ShieldCheck size={16} /> Only verified doctors can accept consultations or prescribe.</li>
            <li><ShieldCheck size={16} /> The assistant never diagnoses or prescribes.</li>
          </ul>
        </div>
        <small>Not for emergencies. In an emergency, call your local emergency number.</small>
      </aside>
      <main className="auth-main" id="main">
        <Link to="/" className="auth-back"><ArrowLeft size={15} /> Back to home</Link>
        <form className="auth-card" onSubmit={submit} noValidate>
          <h2>{mode === "login" ? "Sign in" : "Sign up"}</h2>
          {mode === "register" && (
            <fieldset className="role-picker"><legend>I am a…</legend>
              {roleOptions.map((option) => (
                <label key={option.id} className={role === option.id ? "selected" : ""}>
                  <input type="radio" name="role" checked={role === option.id} onChange={() => setRole(option.id)} />
                  <span className="role-icon">{option.icon}</span><span><strong>{option.label}</strong><small>{option.text}</small></span>
                </label>
              ))}
            </fieldset>
          )}
          {mode === "register" && <Field label="Full name"><input value={form.name ?? ""} onChange={set("name")} autoComplete="name" required /></Field>}
          <Field label="Email"><input type="email" value={form.email ?? ""} onChange={set("email")} autoComplete="email" required /></Field>
          <Field label="Password" hint={mode === "register" ? "At least 10 characters, with a letter and a number." : undefined}>
            <div className="password-input-wrapper">
              <input
                type={showPassword ? "text" : "password"}
                value={form.password ?? ""}
                onChange={set("password")}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                title={showPassword ? "Hide password" : "Show password"}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
          {mode === "register" && role === "doctor" && <>
            <Field label="Specialty"><input value={form.specialty ?? ""} onChange={set("specialty")} placeholder="e.g. General Physician" required /></Field>
            <Field label="Medical licence number (optional)" hint="Optional for college project / demonstration"><input value={form.licenseNo ?? ""} onChange={set("licenseNo")} placeholder="e.g. TS-12345 (leave blank if not available)" /></Field>
            <Field label="Qualifications"><input value={form.qualifications ?? ""} onChange={set("qualifications")} placeholder="e.g. MBBS, MD" required /></Field>

            <div className="hospital-picker">
              <div className="hospital-picker-head">
                <strong><Building2 size={16} style={{ verticalAlign: "middle", marginRight: "4px" }} /> Select your hospital or clinic</strong>
                <small>Select your country, state, district, and village to automatically show all hospitals in that area on Google Maps so patients can book appointments with you.</small>
              </div>

              {form.clinic && form.placeId && (
                <div style={{ background: "#eefcf8", border: "1.5px solid var(--teal)", borderRadius: "10px", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--teal)", textTransform: "uppercase", letterSpacing: "0.5px" }}>✓ Selected Hospital</span>
                    <strong style={{ display: "block", color: "var(--navy)", fontSize: "14px", marginTop: "2px" }}>{form.clinic}</strong>
                    <small style={{ color: "var(--muted)", fontSize: "12px" }}>{form.address}</small>
                  </div>
                  <button type="button" className="outline-button button-small" onClick={() => setForm((prev) => ({ ...prev, clinic: "", address: "", placeId: "", lat: "", lng: "" }))}>
                    Change
                  </button>
                </div>
              )}

              {(!form.placeId || customClinic) && (
                <>
                  {/* Cascading Location Selectors */}
                  <div className="hospital-cascade-grid">
                    <div className="hospital-cascade-field">
                      <label>1. Country</label>
                      <select value={selectedCountry} onChange={(e) => handleCountryChange(e.target.value)}>
                        {COUNTRIES.map((c) => (
                          <option key={c.code} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="hospital-cascade-field">
                      <label>2. State</label>
                      {selectedCountry === "India" ? (
                        <select value={selectedState} onChange={(e) => handleStateChange(e.target.value)}>
                          {Object.keys(INDIA_STATES).map((st) => (
                            <option key={st} value={st}>{st}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={selectedState}
                          onChange={(e) => setSelectedState(e.target.value)}
                          placeholder="Enter State / Province"
                        />
                      )}
                    </div>

                    <div className="hospital-cascade-field">
                      <label>3. District</label>
                      {selectedCountry === "India" && INDIA_STATES[selectedState]?.districts?.length ? (
                        <select value={selectedDistrict} onChange={(e) => handleDistrictChange(e.target.value)}>
                          {INDIA_STATES[selectedState].districts.map((d) => (
                            <option key={d.name} value={d.name}>{d.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={selectedDistrict}
                          onChange={(e) => setSelectedDistrict(e.target.value)}
                          placeholder="Enter District / County"
                        />
                      )}
                    </div>

                    <div className="hospital-cascade-field">
                      <label>4. Village / Locality / Mandal</label>
                      {selectedCountry === "India" && (INDIA_STATES[selectedState]?.districts.find((d) => d.name === selectedDistrict)?.villages?.length ?? 0) > 0 ? (
                        <select
                          value={customVillage ? "__custom__" : selectedVillage}
                          onChange={(e) => {
                            if (e.target.value === "__custom__") {
                              setCustomVillage(selectedVillage || "Main");
                            } else {
                              handleVillageChange(e.target.value);
                            }
                          }}
                        >
                          {(INDIA_STATES[selectedState]?.districts.find((d) => d.name === selectedDistrict)?.villages || []).map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                          <option value="__custom__">+ Enter custom village / town…</option>
                        </select>
                      ) : (
                        <input
                          value={customVillage || selectedVillage}
                          onChange={(e) => {
                            setCustomVillage(e.target.value);
                            setSelectedVillage(e.target.value);
                          }}
                          placeholder="Enter Village or Locality"
                        />
                      )}
                    </div>
                  </div>

                  {customVillage !== "" && (
                    <div style={{ display: "flex", gap: "8px" }}>
                      <input
                        value={customVillage}
                        onChange={(e) => setCustomVillage(e.target.value)}
                        placeholder="Type exact village, town, or area name…"
                        style={{ padding: "7px 10px", borderRadius: "8px", border: "1.5px solid var(--line)", fontSize: "13px", flex: 1 }}
                      />
                      <button
                        type="button"
                        className="button button-small"
                        onClick={() => fetchHospitalsForLocation(selectedCountry, selectedState, selectedDistrict, customVillage)}
                      >
                        Search
                      </button>
                    </div>
                  )}

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "2px" }}>
                    <span style={{ fontSize: "12px", color: "var(--navy)", fontWeight: 600 }}>
                      📍 Hospitals in {customVillage || selectedVillage || selectedDistrict}, {selectedDistrict} ({hospitals.length} found)
                    </span>
                    <button
                      type="button"
                      className="outline-button button-small"
                      style={{ fontSize: "11px", padding: "3px 8px" }}
                      onClick={() => fetchHospitalsForLocation(selectedCountry, selectedState, selectedDistrict, customVillage || selectedVillage)}
                    >
                      Refresh List
                    </button>
                  </div>

                  <input
                    type="text"
                    value={hospFilter}
                    onChange={(e) => setHospFilter(e.target.value)}
                    placeholder="Filter listed hospitals by name..."
                    style={{ padding: "8px 12px", borderRadius: "8px", border: "1.5px solid var(--line)", fontSize: "13px" }}
                  />

                  {loadingHosp ? (
                    <Loading label={`Finding hospitals in ${customVillage || selectedVillage || selectedDistrict}…`} />
                  ) : hospitals.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "16px 10px", color: "var(--muted)", fontSize: "13px", background: "#f8fafc", borderRadius: "10px", border: "1px dashed var(--line)" }}>
                      No listed hospitals found right in this village. You can choose another nearby village or enter your clinic name manually below.
                    </div>
                  ) : (
                    <div className="hospital-picker-list">
                      {hospitals
                        .filter((h) => !hospFilter || h.name.toLowerCase().includes(hospFilter.toLowerCase()) || h.address.toLowerCase().includes(hospFilter.toLowerCase()))
                        .map((h) => (
                          <div
                            key={h.id}
                            className={`hospital-picker-card ${form.placeId === h.id ? "selected" : ""}`}
                            onClick={() => selectHospital(h)}
                          >
                            <div style={{ flex: 1, paddingRight: "8px" }}>
                              <strong>{h.name}</strong>
                              <small>{h.address}</small>
                              {typeof h.distanceKm === "number" && (
                                <span style={{ display: "inline-block", marginTop: "3px", fontSize: "11px", color: "var(--blue)", fontWeight: 500 }}>
                                  📍 ~{h.distanceKm} km away
                                </span>
                              )}
                            </div>
                            <span className="outline-button button-small" style={{ fontSize: "11px", pointerEvents: "none" }}>
                              {form.placeId === h.id ? "Selected ✓" : "Click to select"}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <button
                      type="button"
                      className="text-link"
                      style={{ fontSize: "12px", border: 0, background: "none", cursor: "pointer", padding: 0 }}
                      onClick={() => setCustomClinic((prev) => !prev)}
                    >
                      {customClinic ? "← Choose from hospital list" : "Can't find your hospital? Enter clinic name manually"}
                    </button>
                  </div>
                  {customClinic && (
                    <div className="stack" style={{ gap: "8px", marginTop: "6px" }}>
                      <Field label="Custom Clinic / Hospital Name"><input value={form.clinic ?? ""} onChange={set("clinic")} placeholder="e.g. HealthFirst Medical Centre" required /></Field>
                      <Field label="Clinic Address"><input value={form.address ?? ""} onChange={set("address")} placeholder="Full address" /></Field>
                    </div>
                  )}
                </>
              )}
            </div>

            <Alert>Your credentials are reviewed by an administrator. Until you are verified you cannot appear in listings, accept bookings or prescribe.</Alert>
          </>}

          {mode === "register" && role === "pharmacy" && <>
            <div className="stack" style={{ gap: 8 }}>
              <strong>Select your shop location</strong>
              <div className="hospital-cascade-grid">
                <div className="hospital-cascade-field">
                  <label>1. Country</label>
                  <select value={pharmacyCountry} onChange={(event) => handlePharmacyCountryChange(event.target.value)} required>
                    <option value="">Select country</option>
                    {COUNTRIES.map((country) => <option key={country.code} value={country.name}>{country.name}</option>)}
                  </select>
                </div>
                <div className="hospital-cascade-field">
                  <label>2. State / Province</label>
                  {pharmacyCountry === "India" ? (
                    <select value={pharmacyState} onChange={(event) => handlePharmacyStateChange(event.target.value)} required disabled={!pharmacyCountry}>
                      <option value="">Select state</option>
                      {Object.keys(INDIA_STATES).map((state) => <option key={state} value={state}>{state}</option>)}
                    </select>
                  ) : (
                    <input value={pharmacyState} onChange={(event) => {
                      pharmacySearchId.current++;
                      setLoadingPharmacies(false);
                      setPharmacyState(event.target.value);
                      setNearbyPharmacies([]);
                      setPharmacyLocation("");
                      setPharmacyLocationError("");
                      clearSelectedPharmacy();
                    }} placeholder="Enter state / province" required disabled={!pharmacyCountry} />
                  )}
                </div>
                <div className="hospital-cascade-field">
                  <label>3. District</label>
                  {pharmacyCountry === "India" && INDIA_STATES[pharmacyState]?.districts.length ? (
                    <select value={pharmacyDistrict} onChange={(event) => handlePharmacyDistrictChange(event.target.value)} required disabled={!pharmacyState}>
                      <option value="">Select district</option>
                      {INDIA_STATES[pharmacyState].districts.map((district) => <option key={district.name} value={district.name}>{district.name}</option>)}
                    </select>
                  ) : (
                    <input value={pharmacyDistrict} onChange={(event) => {
                      pharmacySearchId.current++;
                      setLoadingPharmacies(false);
                      setPharmacyDistrict(event.target.value);
                      setNearbyPharmacies([]);
                      setPharmacyLocation("");
                      setPharmacyLocationError("");
                      clearSelectedPharmacy();
                    }} placeholder="Enter district / county" required disabled={!pharmacyState} />
                  )}
                </div>
                <div className="hospital-cascade-field">
                  <label>4. Village / Locality</label>
                  {pharmacyCountry === "India" && (INDIA_STATES[pharmacyState]?.districts.find((district) => district.name === pharmacyDistrict)?.villages?.length ?? 0) > 0 ? (
                    <>
                      <select
                        value={customPharmacyVillage ? "__custom__" : pharmacyVillage}
                        onChange={(event) => handlePharmacyVillageChange(event.target.value)}
                        required
                        disabled={!pharmacyDistrict}
                      >
                        <option value="">Select village / locality</option>
                        {INDIA_STATES[pharmacyState].districts.find((district) => district.name === pharmacyDistrict)?.villages?.map((village) => (
                          <option key={village} value={village}>{village}</option>
                        ))}
                        <option value="__custom__">Enter another village / locality</option>
                      </select>
                      {customPharmacyVillage && (
                        <input
                          value={customPharmacyVillage === "__custom__" ? "" : customPharmacyVillage}
                          onChange={(event) => {
                            pharmacySearchId.current++;
                            setLoadingPharmacies(false);
                            setPharmacyLocation("");
                            setPharmacyLocationError("");
                            setCustomPharmacyVillage(event.target.value);
                            setPharmacyVillage(event.target.value);
                            setPharmacyPostalCode("");
                            setNearbyPharmacies([]);
                            clearSelectedPharmacy();
                          }}
                          placeholder="Enter village or locality"
                          required
                        />
                      )}
                    </>
                  ) : (
                    <input
                      value={pharmacyVillage}
                      onChange={(event) => {
                        pharmacySearchId.current++;
                        setLoadingPharmacies(false);
                        setPharmacyLocation("");
                        setPharmacyLocationError("");
                        setPharmacyVillage(event.target.value);
                        setPharmacyPostalCode("");
                        setNearbyPharmacies([]);
                        clearSelectedPharmacy();
                      }}
                      placeholder="Enter village / locality"
                      required
                      disabled={!pharmacyDistrict}
                    />
                  )}
                </div>
              </div>
              <Field label="Pincode / postal code" hint={pharmacyCountry === "India" ? "Required: enter the six-digit pincode for this village." : "Required: enter the postal code for this locality."}>
                <input
                  value={pharmacyPostalCode}
                  onChange={(event) => {
                    pharmacySearchId.current++;
                    setLoadingPharmacies(false);
                    setPharmacyPostalCode(event.target.value);
                    setNearbyPharmacies([]);
                    setPharmacyLocation("");
                    setPharmacyLocationError("");
                    clearSelectedPharmacy();
                  }}
                  placeholder={pharmacyCountry === "India" ? "Enter 6-digit pincode" : "Enter postal code"}
                  autoComplete="postal-code"
                  inputMode={pharmacyCountry === "India" ? "numeric" : "text"}
                  pattern={pharmacyCountry === "India" ? "\\d{6}" : "[A-Za-z0-9 -]{3,12}"}
                  maxLength={12}
                  required
                />
              </Field>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong><MapPin size={15} /> Medical shops in the selected village</strong>
              </div>
              <small className="muted">{pharmacyLocation || "Choose your country, state, district and village/locality to search shops in that area."}</small>
              {pharmacyCountry && pharmacyState && pharmacyDistrict && (customPharmacyVillage || pharmacyCountry !== "India") && (
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => void searchPharmaciesByAddress(pharmacyCountry, pharmacyState, pharmacyDistrict, pharmacyVillage, pharmacyPostalCode)}
                  disabled={loadingPharmacies || !pharmacyVillage || !isPharmacyPostalCodeValid(pharmacyCountry, pharmacyPostalCode)}
                >
                  Search medical shops in this area
                </button>
              )}
              {pharmacyLocationError && <Alert kind="warn">{pharmacyLocationError}</Alert>}
              {pharmacyMapsUnavailable && <Alert kind="warn">
                Map listings are temporarily unavailable. {googlePlacesUnavailable
                  ? "Google Places is not configured, and OpenStreetMap is currently unavailable. Try again later or enter your shop details below."
                  : "Google Places is configured but did not return listings. Check that Places API is enabled, billing is active, and the API key restrictions allow server requests in Render."}
                {pharmacyProviderStatus && <small style={{ display: "block", marginTop: 4 }}>Provider status: {pharmacyProviderStatus}</small>}
              </Alert>}
              {googlePlacesUnavailable && !pharmacyMapsUnavailable && <Alert kind="warn">Google Maps Places is not configured on this server, so only shops listed in OpenStreetMap can appear. For a more complete shop list, configure GOOGLE_MAPS_API_KEY with Places API enabled in the Render environment.</Alert>}
              {loadingPharmacies ? <Loading label="Finding pharmacies in this village…" /> : nearbyPharmacies.length > 0 ? (
                <>
                  <small className="muted">{nearbyPharmacies.length} pharmacy listings found for pincode {pharmacyPostalCode}. Results must match this pincode and the selected village; Google Maps data may not include every local shop.</small>
                  <div className="pharmacy-registration-list" role="radiogroup" aria-label="Pharmacies in the selected village">
                    {nearbyPharmacies.map((shop) => (
                      <button
                        type="button"
                        key={shop.id}
                        className={`pharmacy-registration-option ${form.placeId === shop.id ? "selected" : ""}`}
                        onClick={() => selectPharmacy(shop)}
                      >
                        <span><strong>{shop.name}</strong><small>{shop.address || "Address not listed"}</small></span>
                        <small>{shop.source === "google" ? "Google Maps pharmacy" : "OpenStreetMap pharmacy"}</small>
                      </button>
                    ))}
                  </div>
                </>
              ) : !loadingPharmacies && pharmacyLocation && !pharmacyLocationError && !pharmacyMapsUnavailable ? <small className="muted">No pharmacies were found in this area. Search again or enter your shop details below.</small> : null}
              {nearbyPharmacies.some((shop) => shop.source === "openstreetmap") && <small className="muted">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></small>}
            </div>
            <Field label="Business name"><input value={form.businessName ?? ""} onChange={set("businessName")} required /></Field>
            <Field label="Pharmacy licence number (optional)" hint="Optional for college project / demonstration"><input value={form.licenseNo ?? ""} onChange={set("licenseNo")} placeholder="e.g. PH-12345 (leave blank if not available)" /></Field>
            <Field label="Address"><input value={form.address ?? ""} onChange={set("address")} required /></Field>
            <Alert>Your licence is reviewed by an administrator. Until you are verified you cannot receive orders.</Alert>
          </>}
          {action.error && <Alert kind="error">{action.error}</Alert>}
          <SubmitButton busy={action.busy}>{mode === "login" ? "Sign in" : "Create account"}</SubmitButton>
          {config?.googleClientId
            ? <><div className="auth-divider"><span>or</span></div><GoogleButton clientId={config.googleClientId} role={role} onDone={finish} /><small className="muted">Choose your role above, then continue with Google. Doctor and pharmacy accounts need administrator verification.</small></>
            : <small className="muted">Google sign-in is not configured on this server (set GOOGLE_CLIENT_ID).</small>}
          <p className="auth-switch">{mode === "login" ? <>New here? <Link to="/register">Create an account</Link></> : <>Already registered? <Link to="/login">Sign in</Link></>}</p>
        </form>
        {demo && mode === "login" && (
          <div className="demo-box">
            <strong>Local demo accounts (fictitious data)</strong>
            <p>Password for all: <code>{demo.password}</code></p>
            <div className="demo-accounts">
              {Object.entries(demo.emails).map(([role, email]) => (
                <button type="button" key={role} onClick={() => setForm({ email, password: demo.password })}><span>{role}</span><small>{email}</small></button>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
