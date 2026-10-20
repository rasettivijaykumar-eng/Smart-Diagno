import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  CalendarCheck,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  Video,
  VideoOff,
  X,
  WifiOff,
  UserCheck,
  UserX,
  CheckCheck,
} from "lucide-react";
import { get, post } from "./api";
import { useAuth } from "./auth";
import { Alert, Badge, fmtDateTime, Loading, useAction, useLoad } from "./ui";
import { navigate } from "./router";

/* -------------------------
   Types
   ------------------------- */
interface MeetStatus {
  appointmentId: string;
  mode: string;
  status: string;
  lobbyStatus: string;
  meetProvider: string;
  meetStatus: string;
  meetError: string | null;
  googleMeetUrl: string | null;
  start: string;
  durationMin: number;
  patientName: string;
  doctorName: string;
  patientReady: boolean;
  patientReadyAt: string | null;
  doctorReady: boolean;
  doctorReadyAt: string | null;
  patientRequestedJoinAt: string | null;
  doctorRequestedJoinAt: string | null;
  consultationStartedAt: string | null;
  consultationCompletedAt: string | null;
  bothReady: boolean;
  canJoin: boolean;
  isTimeEligible: boolean;
  isEarly: boolean;
  isOverdue: boolean;
  doctorGoogleConnected: boolean;
}

/* -------------------------
   Utility
   ------------------------- */
function lobbyStatusLabel(status: string): { label: string; tone: "good" | "warn" | "info" | "error" | "neutral" } {
  switch (status) {
    case "both_ready": return { label: "Both Ready — Join Now!", tone: "good" };
    case "waiting_doctor": return { label: "Waiting for doctor", tone: "warn" };
    case "waiting_patient": return { label: "Waiting for patient", tone: "warn" };
    case "ready_to_connect": return { label: "Ready — Mark yourself ready to join", tone: "info" };
    case "preparing_meet": return { label: "Preparing Google Meet…", tone: "info" };
    case "auth_required": return { label: "Doctor needs to connect Google Calendar", tone: "warn" };
    case "creation_failed": return { label: "Meet creation failed — doctor can retry", tone: "error" };
    case "waiting_doctor_acceptance": return { label: "Awaiting doctor acceptance", tone: "neutral" };
    case "cancelled": return { label: "Appointment cancelled", tone: "error" };
    case "rejected": return { label: "Appointment rejected", tone: "error" };
    case "completed": return { label: "Consultation completed", tone: "good" };
    case "offline": return { label: "In-person visit — no video call needed", tone: "neutral" };
    default: return { label: status, tone: "neutral" };
  }
}

/* -------------------------
   Main Lobby Modal
   ------------------------- */
export interface GoogleMeetLobbyProps {
  appointmentId: string;
  onClose: () => void;
  onComplete?: () => void;
}

export function GoogleMeetLobbyModal({ appointmentId, onClose, onComplete }: GoogleMeetLobbyProps) {
  const { user } = useAuth();
  const action = useAction();
  const isDoctor = user?.role === "doctor";
  const isPatient = user?.role === "patient";
  const hasJoined = useRef(false);
  const [bellClicked, setBellClicked] = useState(false);

  const { data, loading, error, reload, setData } = useLoad(
    () => get<MeetStatus>(`/appointments/${appointmentId}/meet-status`),
    [appointmentId]
  );

  // Auto-poll every 5 seconds
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const fresh = await get<MeetStatus>(`/appointments/${appointmentId}/meet-status`);
        setData(fresh);
      } catch { /* silent */ }
    }, 5000);
    return () => clearInterval(t);
  }, [appointmentId, setData]);

  const appt = data;

  const handleMarkReady = async () => {
    const res = await action.run(() =>
      post<{ lobbyStatus: string }>(`/appointments/${appointmentId}/readiness`, { ready: true })
    );
    if (res) reload();
  };

  const handleMarkNotReady = async () => {
    const res = await action.run(() =>
      post<{ lobbyStatus: string }>(`/appointments/${appointmentId}/readiness`, { ready: false })
    );
    if (res) reload();
  };

  const handleRequestJoin = async () => {
    setBellClicked(true);
    const res = await action.run(() =>
      post(`/appointments/${appointmentId}/request-join`)
    );
    if (res) reload();
  };

  const handleRetryMeet = async () => {
    const res = await action.run(() =>
      post(`/appointments/${appointmentId}/retry-meet`)
    );
    if (res) reload();
  };

  const handleConnectCalendar = () => {
    onClose();
    navigate("/app/profile");
  };

  const handleJoinMeet = async () => {
    if (!appt?.googleMeetUrl) return;
    window.open(appt.googleMeetUrl, "_blank", "noopener,noreferrer");
    if (!hasJoined.current) {
      hasJoined.current = true;
      await post(`/appointments/${appointmentId}/start-consultation`).catch(() => undefined);
    }
  };

  const handleCompleteConsultation = async () => {
    if (!confirm("Mark this consultation as completed?")) return;
    const res = await action.run(() =>
      post(`/appointments/${appointmentId}/complete-consultation`)
    );
    if (res) {
      onComplete?.();
      reload();
    }
  };

  const myReady = isDoctor ? appt?.doctorReady : appt?.patientReady;
  const otherReady = isDoctor ? appt?.patientReady : appt?.doctorReady;
  const lobbyInfo = appt ? lobbyStatusLabel(appt.lobbyStatus) : null;
  void isPatient;

  return createPortal(
    <div
      className="ui-modal-backdrop meet-lobby-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ui-modal meet-lobby-window" role="dialog" aria-modal="true" aria-label="Google Meet Lobby">
        {/* Header */}
        <header className="meet-lobby-header">
          <div className="meet-lobby-header-left">
            <div className="meet-lobby-brand">
              <Video size={20} className="meet-video-icon" />
              <span>Google Meet Consultation</span>
            </div>
            {appt && (
              <div className="meet-lobby-meta">
                <span>{isDoctor ? `Patient: ${appt.patientName}` : `Dr. ${appt.doctorName}`}</span>
                <span className="dot-divider">•</span>
                <span>{fmtDateTime(appt.start)}</span>
                <span className="dot-divider">•</span>
                <span>{appt.durationMin} min</span>
              </div>
            )}
          </div>
          <div className="meet-lobby-header-right">
            <button className="icon-btn" onClick={() => reload()} title="Refresh status">
              <RefreshCw size={16} />
            </button>
            <button className="ui-icon-btn" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="meet-lobby-body">
          {loading && !appt ? (
            <Loading label="Loading consultation status…" />
          ) : error ? (
            <Alert kind="error">{error}</Alert>
          ) : appt ? (
            <>
              {/* Status Banner */}
              {lobbyInfo && (
                <div className={`meet-status-banner meet-status-${lobbyInfo.tone}`}>
                  <div className="meet-status-icon">
                    {lobbyInfo.tone === "good" ? (
                      <CheckCircle2 size={22} />
                    ) : lobbyInfo.tone === "error" ? (
                      <AlertCircle size={22} />
                    ) : (
                      <Clock size={22} />
                    )}
                  </div>
                  <div>
                    <strong>{lobbyInfo.label}</strong>
                    {appt.meetError && (
                      <p className="meet-error-note">{appt.meetError}</p>
                    )}
                  </div>
                  <Badge tone={lobbyInfo.tone === "error" ? "bad" : lobbyInfo.tone}>{appt.lobbyStatus.replace(/_/g, " ")}</Badge>
                  {appt.lobbyStatus === "both_ready" && appt.googleMeetUrl && (
                    <button className="button meet-ready-join-btn" onClick={handleJoinMeet} disabled={action.busy}>
                      <ExternalLink size={16} />
                      Join Google Meet
                    </button>
                  )}
                  {appt.lobbyStatus === "both_ready" && !appt.googleMeetUrl && isDoctor && (
                    <button
                      className="button meet-ready-join-btn"
                      onClick={appt.meetStatus === "auth_required" ? handleConnectCalendar : handleRetryMeet}
                      disabled={action.busy || appt.meetStatus === "preparing"}
                    >
                      {appt.meetStatus === "auth_required" ? <CalendarCheck size={16} /> : <Video size={16} />}
                      {appt.meetStatus === "auth_required" ? "Connect Google Calendar" : appt.meetStatus === "preparing" ? "Preparing Meet…" : "Create Google Meet"}
                    </button>
                  )}
                </div>
              )}

              {/* Offline appointment */}
              {appt.mode !== "online" && (
                <div className="meet-offline-card">
                  <VideoOff size={28} className="meet-offline-icon" />
                  <div>
                    <strong>This is an in-person appointment</strong>
                    <p>Google Meet is only used for online consultations. Please visit the clinic at the scheduled time.</p>
                  </div>
                </div>
              )}

              {/* Online Mode Content */}
              {appt.mode === "online" && (
                <>
                  {/* Readiness Panel */}
                  {appt.status === "confirmed" && (
                    <div className="meet-readiness-panel">
                      <h3 className="meet-section-label">Participant Readiness</h3>
                      <div className="meet-readiness-grid">
                        <div className={`meet-ready-card ${appt.patientReady ? "ready" : "not-ready"}`}>
                          {appt.patientReady ? <UserCheck size={20} /> : <UserX size={20} />}
                          <div>
                            <strong>{appt.patientName}</strong>
                            <small>{appt.patientReady ? `Ready${appt.patientReadyAt ? ` at ${fmtDateTime(appt.patientReadyAt)}` : ""}` : "Not yet ready"}</small>
                          </div>
                          <div className={`ready-dot ${appt.patientReady ? "ready" : ""}`} />
                        </div>
                        <div className={`meet-ready-card ${appt.doctorReady ? "ready" : "not-ready"}`}>
                          {appt.doctorReady ? <UserCheck size={20} /> : <UserX size={20} />}
                          <div>
                            <strong>Dr. {appt.doctorName}</strong>
                            <small>{appt.doctorReady ? `Ready${appt.doctorReadyAt ? ` at ${fmtDateTime(appt.doctorReadyAt)}` : ""}` : "Not yet ready"}</small>
                          </div>
                          <div className={`ready-dot ${appt.doctorReady ? "ready" : ""}`} />
                        </div>
                      </div>

                      {/* My readiness toggle */}
                      <div className="meet-my-readiness">
                        {!myReady ? (
                          <button className="button" onClick={handleMarkReady} disabled={action.busy}>
                            {action.busy ? <Loader2 size={16} className="spin" /> : <CheckCheck size={16} />}
                            Mark myself as Ready
                          </button>
                        ) : (
                          <div className="meet-ready-row">
                            <Badge tone="good">You are marked as Ready</Badge>
                            <button className="outline-button" onClick={handleMarkNotReady} disabled={action.busy}>
                              Cancel readiness
                            </button>
                          </div>
                        )}
                        {myReady && !otherReady && (
                          <button className="outline-button" onClick={handleRequestJoin} disabled={action.busy || bellClicked}>
                            <span style={{ fontSize: 15 }}>🔔</span>
                            {bellClicked ? "Notified!" : `Notify ${isDoctor ? "patient" : "doctor"} to join`}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Auth Required Banner for Doctor */}
                  {appt.lobbyStatus === "auth_required" && isDoctor && (
                    <div className="meet-auth-banner">
                      <CalendarCheck size={24} />
                      <div>
                        <strong>Connect Google Calendar to generate Meet link</strong>
                        <p>Go to your Profile page to connect Google Calendar. Once connected, the Meet link will be generated automatically.</p>
                      </div>
                      <button className="outline-button" onClick={handleConnectCalendar}>
                        Connect Google Calendar
                      </button>
                    </div>
                  )}

                  {/* Retry failed meet */}
                  {!appt.googleMeetUrl && appt.meetStatus !== "auth_required" && appt.meetStatus !== "preparing" && isDoctor && (
                    <button className="outline-button" onClick={handleRetryMeet} disabled={action.busy}>
                      <RefreshCw size={15} />
                      {appt.meetStatus === "failed" ? "Retry Google Meet Generation" : "Create Google Meet Link"}
                    </button>
                  )}

                  {/* Preparing Meet */}
                  {appt.meetStatus === "preparing" && (
                    <div className="meet-preparing-card">
                      <Loader2 size={24} className="spin" />
                      <div>
                        <strong>Creating Google Meet session…</strong>
                        <p>The video conference is being set up. This usually takes a few seconds.</p>
                      </div>
                    </div>
                  )}

                  {!appt.googleMeetUrl && isPatient && appt.status === "confirmed" && (
                    <Alert kind="info">
                      {appt.meetStatus === "auth_required"
                        ? "You are ready. The doctor needs to connect Google Calendar before the Meet link can be created."
                        : "You are ready. Waiting for the doctor to create the Google Meet link."}
                    </Alert>
                  )}

                  {/* Google Meet Join Button */}
                  {appt.googleMeetUrl && (
                    <div className="meet-join-section">
                      <div className="meet-join-card">
                        <Video size={28} className="meet-join-icon" />
                        <div className="meet-join-info">
                          <strong>Google Meet Session Ready</strong>
                          {appt.consultationStartedAt ? (
                            <small>Session started at {fmtDateTime(appt.consultationStartedAt)}</small>
                          ) : (
                            <small>Use the Join Google Meet button above to open the session</small>
                          )}
                        </div>
                      </div>
                      {!appt.isTimeEligible && appt.isEarly && (
                        <Alert kind="warn">
                          Session starts at {fmtDateTime(appt.start)}. You can join up to 15 minutes before.
                        </Alert>
                      )}
                      {!appt.isTimeEligible && appt.isOverdue && (
                        <Alert kind="warn">
                          The consultation window has passed.
                        </Alert>
                      )}
                    </div>
                  )}

                  {/* Complete consultation (doctor only) */}
                  {isDoctor && appt.status === "confirmed" && appt.consultationStartedAt && (
                    <div className="meet-complete-section">
                      <button className="outline-button" onClick={handleCompleteConsultation} disabled={action.busy}>
                        <CheckCircle2 size={15} />
                        Mark Consultation as Completed
                      </button>
                    </div>
                  )}

                  {/* Completed */}
                  {appt.status === "completed" && (
                    <div className="meet-completed-card">
                      <CheckCircle2 size={28} className="meet-completed-icon" />
                      <div>
                        <strong>Consultation Completed</strong>
                        {appt.consultationCompletedAt && (
                          <p>Completed on {fmtDateTime(appt.consultationCompletedAt)}</p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {action.error && <Alert kind="error">{action.error}</Alert>}
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* -------------------------
   Google Calendar Connect Panel
   ------------------------- */
export interface GoogleCalendarConnectProps {
  onConnected?: () => void;
}

export function GoogleCalendarConnect({ onConnected }: GoogleCalendarConnectProps) {
  const { data, loading, error, reload } = useLoad(
    () => get<{ connected: boolean; email: string | null; connectedAt: string | null }>("/doctor/google-calendar/status"),
    []
  );
  const action = useAction();

  const handleConnect = async () => {
    const res = await action.run(() =>
      get<{ url: string }>("/doctor/google-calendar/auth-url")
    );
    if (res?.url) window.location.href = res.url;
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Google Calendar? New online appointments won't get Meet links until you reconnect.")) return;
    const res = await action.run(() => post("/doctor/google-calendar/disconnect"));
    if (res) { reload(); onConnected?.(); }
  };

  if (loading) return <Loading label="Checking Google Calendar status…" />;

  return (
    <div className="gc-connect-panel">
      <div className="gc-connect-header">
        <div className="gc-icon">
          <Video size={20} />
        </div>
        <div>
          <strong>Google Calendar &amp; Google Meet</strong>
          <p>Connect your Google Calendar to automatically create Google Meet links when you accept online consultations.</p>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {action.error && <Alert kind="error">{action.error}</Alert>}

      {data?.connected ? (
        <div className="gc-connected-info">
          <div className="gc-connected-badge">
            <CheckCircle2 size={18} className="gc-check-icon" />
            <div>
              <span>Connected{data.email ? ` as ${data.email}` : ""}</span>
              {data.connectedAt && <small>Since {fmtDateTime(data.connectedAt)}</small>}
            </div>
          </div>
          <button className="outline-button" onClick={handleDisconnect} disabled={action.busy}>
            <WifiOff size={14} />
            Disconnect
          </button>
        </div>
      ) : (
        <div className="gc-not-connected">
          <Alert kind="warn">
            Not connected. Online appointments won't get a Google Meet link until you connect.
          </Alert>
          <button className="button" onClick={handleConnect} disabled={action.busy}>
            {action.busy ? <Loader2 size={15} className="spin" /> : <CalendarCheck size={15} />}
            Connect Google Calendar
          </button>
        </div>
      )}
    </div>
  );
}
