import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, CheckCircle2, Copy, Download, Image as ImageIcon, QrCode, RefreshCw, Send, ShieldCheck, Upload, X, ZoomIn } from "lucide-react";
import { get, post } from "./api";
import { useAuth } from "./auth";
import { Alert, Badge, fmtDateTime, Loading, Modal, statusTone, SubmitButton, useAction, useLoad } from "./ui";

export interface ConsultationChatProps {
  appointmentId: string;
  onClose: () => void;
}

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export function ConsultationChatModal({ appointmentId, onClose }: ConsultationChatProps) {
  const { user } = useAuth();
  const [inputText, setInputText] = useState("");
  const [showQrModal, setShowQrModal] = useState(false);
  const [showProofModal, setShowProofModal] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string } | null>(null);
  const [copiedUtr, setCopiedUtr] = useState(false);
  const messagesBodyRef = useRef<HTMLDivElement>(null);
  const action = useAction();

  // Load chat & appointment details
  const { data, loading, error, reload, setData } = useLoad(
    () => get<{ chat: any; appointment: any }>(`/consultations/${appointmentId}`),
    [appointmentId]
  );

  // Auto-poll every 3.5 seconds to keep chat fresh in real-time
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const fresh = await get<{ chat: any; appointment: any }>(`/consultations/${appointmentId}`);
        setData(fresh);
      } catch {
        // Silently skip poll failure
      }
    }, 3500);
    return () => clearInterval(interval);
  }, [appointmentId, setData]);

  // Keep new messages in view without scrolling the underlying dashboard.
  const messageCount = data?.chat?.messages?.length ?? 0;
  useEffect(() => {
    const body = messagesBodyRef.current;
    body?.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
  }, [messageCount]);

  const isDoctor = user?.role === "doctor";
  const isPatient = user?.role === "patient";
  const chat = data?.chat;
  const appointment = data?.appointment;
  const feeDetails = chat?.feeDetails;

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    const res = await action.run(() => post(`/consultations/${appointmentId}/messages`, { text }));
    if (res?.chat) {
      setData((prev) => (prev ? { ...prev, chat: res.chat } : prev));
    } else {
      reload();
    }
  };

  const handleVerifyPayment = async () => {
    if (!confirm("Confirm that you have received this payment in your account?")) return;
    const res = await action.run(() => post(`/consultations/${appointmentId}/verify-payment`));
    if (res?.chat) {
      setData((prev) => (prev ? { ...prev, chat: res.chat } : prev));
    } else {
      reload();
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUtr(true);
    setTimeout(() => setCopiedUtr(false), 2000);
  };

  return createPortal(
    <div className="ui-modal-backdrop consultation-chat-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ui-modal consultation-chat-window" role="dialog" aria-modal="true" aria-label="Consultation Chat">
        {/* Header */}
        <header className="consultation-chat-header">
          <div className="consultation-chat-header-info">
            <div className="consultation-participant-tag">
              <span className="consultation-dot" />
              <strong>{isDoctor ? `Patient: ${appointment?.patientName || "Loading..."}` : `Doctor: ${appointment?.doctorName || "Loading..."}`}</strong>
            </div>
            {appointment && (
              <div className="consultation-meta-row">
                <span>{fmtDateTime(appointment.start)}</span>
                <span className="dot-divider">•</span>
                <span className="consultation-mode-tag">{appointment.mode === "online" ? "Online Consultation" : "In Person"}</span>
                <Badge tone={statusTone(appointment.status)}>{appointment.status}</Badge>
              </div>
            )}
          </div>
          <div className="consultation-header-actions">
            <button className="icon-btn" onClick={() => reload()} title="Refresh chat">
              <RefreshCw size={16} />
            </button>
            <button className="ui-icon-btn" onClick={onClose} aria-label="Close chat">
              <X size={20} />
            </button>
          </div>
        </header>

        {/* Fee & Payment Notification Banner */}
        {feeDetails && (
          <div className={`consultation-payment-banner fee-status-${feeDetails.status}`}>
            <div className="banner-icon">
              {feeDetails.status === "verified" ? (
                <CheckCircle2 size={22} className="text-good" />
              ) : feeDetails.status === "submitted" ? (
                <ShieldCheck size={22} className="text-info" />
              ) : (
                <AlertCircle size={22} className="text-warn" />
              )}
            </div>
            <div className="banner-content">
              <div className="banner-top">
                <strong>
                  {feeDetails.status === "verified"
                    ? `Payment of ₹${feeDetails.amount} Verified & Confirmed`
                    : feeDetails.status === "submitted"
                    ? `Payment Proof Submitted (₹${feeDetails.amount || ""})`
                    : `Consultation Fee Requested: ₹${feeDetails.amount}`}
                </strong>
                <Badge tone={feeDetails.status === "verified" ? "good" : feeDetails.status === "submitted" ? "info" : "warn"}>
                  {feeDetails.status === "verified" ? "Paid & Verified" : feeDetails.status === "submitted" ? "Under Review" : "Payment Pending"}
                </Badge>
              </div>
              <p className="banner-note">
                {feeDetails.status === "verified"
                  ? "Fee received and acknowledged by the doctor. Thank you!"
                  : feeDetails.status === "submitted"
                  ? `UTR: ${feeDetails.paymentProof?.utr || "N/A"}. ${isDoctor ? "Please review the proof below and verify once credited." : "Awaiting doctor's verification."}`
                  : `${feeDetails.note || "Please scan the QR code to complete payment."}`}
              </p>
            </div>
            {isPatient && feeDetails.status === "pending" && (
              <button className="button button-small" onClick={() => setShowProofModal(true)}>
                <Upload size={14} /> Upload Payment Proof
              </button>
            )}
            {isDoctor && feeDetails.status === "submitted" && (
              <button className="button button-small" onClick={handleVerifyPayment} disabled={action.busy}>
                <Check size={14} /> Verify & Confirm
              </button>
            )}
          </div>
        )}

        {/* Main Chat Messages Stream */}
        <div className="consultation-chat-body" ref={messagesBodyRef}>
          {loading && !chat ? (
            <Loading label="Loading consultation session..." />
          ) : error ? (
            <Alert kind="error">{error}</Alert>
          ) : (
            <div className="consultation-messages-list">
              {chat?.messages?.map((msg: any) => {
                const isMe = msg.senderId === user?.id;
                const isSystem = msg.senderRole === "system" || msg.type === "system";

                if (isSystem) {
                  return (
                    <div key={msg.id} className="consultation-msg-system">
                      <span className="system-pill">{msg.text}</span>
                      <time>{fmtDateTime(msg.at)}</time>
                    </div>
                  );
                }

                if (msg.type === "fee_request") {
                  return (
                    <div key={msg.id} className={`consultation-msg-wrapper ${isMe ? "msg-me" : "msg-other"}`}>
                      <div className="consultation-fee-card">
                        <div className="fee-card-header">
                          <div className="fee-badge-title">
                            <QrCode size={18} />
                            <span>Consultation Fee & Payment QR</span>
                          </div>
                          <span className="fee-amount-large">₹{msg.feeAmount}</span>
                        </div>
                        {msg.text && <p className="fee-card-note">{msg.text}</p>}
                        {msg.qrFile && (
                          <div className="qr-image-container">
                            <div className="qr-image-frame" onClick={() => setPreviewImage({ src: msg.qrFile.dataUrl, title: `Doctor's Payment QR Code (₹${msg.feeAmount})` })}>
                              <img src={msg.qrFile.dataUrl} alt="Doctor QR Code" className="qr-preview-img" />
                              <div className="image-hover-hint">
                                <ZoomIn size={16} /> Click to zoom
                              </div>
                            </div>
                            <small className="qr-hint">Scan with Google Pay, PhonePe, Paytm, or any UPI app</small>
                          </div>
                        )}
                        <div className="fee-card-footer">
                          <small>Requested by {msg.senderName} • {fmtDateTime(msg.at)}</small>
                          {isPatient && feeDetails?.status === "pending" && (
                            <button className="button button-small" onClick={() => setShowProofModal(true)}>
                              <Upload size={14} /> Submit Payment Proof
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                if (msg.type === "payment_proof") {
                  const proof = msg.paymentProof;
                  return (
                    <div key={msg.id} className={`consultation-msg-wrapper ${isMe ? "msg-me" : "msg-other"}`}>
                      <div className="consultation-proof-card">
                        <div className="proof-card-header">
                          <div className="proof-title">
                            <ShieldCheck size={18} />
                            <span>Payment Proof Submitted</span>
                          </div>
                          <Badge tone={feeDetails?.status === "verified" ? "good" : "info"}>
                            {feeDetails?.status === "verified" ? "Verified" : "Under Review"}
                          </Badge>
                        </div>
                        <div className="proof-utr-box">
                          <span className="utr-label">UTR / Reference No:</span>
                          <strong className="utr-value">{proof?.utr}</strong>
                          <button
                            type="button"
                            className="utr-copy-btn"
                            title="Copy UTR"
                            onClick={() => copyToClipboard(proof?.utr || "")}
                          >
                            {copiedUtr ? <Check size={14} /> : <Copy size={14} />}
                            {copiedUtr ? "Copied" : "Copy"}
                          </button>
                        </div>
                        {proof?.note && <p className="proof-note">{proof.note}</p>}
                        {proof?.screenshot && (
                          <div
                            className="proof-image-frame"
                            onClick={() => setPreviewImage({ src: proof.screenshot.dataUrl, title: `Payment Screenshot (UTR: ${proof.utr})` })}
                          >
                            <img src={proof.screenshot.dataUrl} alt="Payment Screenshot" className="proof-preview-img" />
                            <div className="image-hover-hint">
                              <ZoomIn size={16} /> View Screenshot
                            </div>
                          </div>
                        )}
                        <div className="proof-card-footer">
                          <small>Submitted by {msg.senderName} • {fmtDateTime(msg.at)}</small>
                          {isDoctor && feeDetails?.status !== "verified" && (
                            <button className="button button-small" onClick={handleVerifyPayment} disabled={action.busy}>
                              <Check size={14} /> Confirm & Verify Payment
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className={`consultation-msg-wrapper ${isMe ? "msg-me" : "msg-other"}`}>
                    <div className="consultation-msg-bubble">
                      <div className="msg-sender-name">{msg.senderName} ({msg.senderRole})</div>
                      <div className="msg-text-content">{msg.text}</div>
                      <time className="msg-time">{fmtDateTime(msg.at)}</time>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Action Toolbar */}
        <div className="consultation-action-toolbar">
          {isDoctor && (
            <button className="outline-button consultation-special-btn" onClick={() => setShowQrModal(true)}>
              <QrCode size={16} /> Request Fee & Upload QR
            </button>
          )}
          {isPatient && (
            <button className="outline-button consultation-special-btn" onClick={() => setShowProofModal(true)}>
              <Upload size={16} /> Upload Payment Screenshot & UTR
            </button>
          )}
        </div>

        {/* Input Bar */}
        <form className="consultation-input-bar" onSubmit={handleSendMessage}>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Type a message to ${isDoctor ? "patient" : "doctor"}...`}
            maxLength={1000}
            disabled={action.busy}
          />
          <button type="submit" className="button" disabled={!inputText.trim() || action.busy}>
            <Send size={16} /> Send
          </button>
        </form>

        {/* Doctor Upload QR & Request Fee Modal */}
        {showQrModal && (
          <DoctorQrModal
            appointmentId={appointmentId}
            onClose={() => setShowQrModal(false)}
            onDone={(newChat) => {
              setData((prev) => (prev ? { ...prev, chat: newChat } : prev));
              setShowQrModal(false);
            }}
          />
        )}

        {/* Patient Submit Proof Modal */}
        {showProofModal && (
          <PatientProofModal
            appointmentId={appointmentId}
            defaultAmount={feeDetails?.amount}
            onClose={() => setShowProofModal(false)}
            onDone={(newChat) => {
              setData((prev) => (prev ? { ...prev, chat: newChat } : prev));
              setShowProofModal(false);
            }}
          />
        )}

        {/* Full Image Preview Modal */}
        {previewImage && (
          <Modal title={previewImage.title} onClose={() => setPreviewImage(null)}>
            <div className="consultation-lightbox">
              <img src={previewImage.src} alt={previewImage.title} className="lightbox-img" />
              <div className="lightbox-actions">
                <a href={previewImage.src} download="document_preview.png" className="button button-small">
                  <Download size={14} /> Download Image
                </a>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </div>,
    document.body
  );
}

// Doctor QR & Fee Modal
function DoctorQrModal({
  appointmentId,
  onClose,
  onDone,
}: {
  appointmentId: string;
  onClose: () => void;
  onDone: (chat: any) => void;
}) {
  const [amount, setAmount] = useState<number | string>(500);
  const [note, setNote] = useState("Consultation fee. Please scan the QR code via UPI to complete payment.");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const action = useAction();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    if (!["image/png", "image/jpeg"].includes(chosen.type)) {
      return alert("Please upload a PNG or JPEG photo of your QR code.");
    }
    if (chosen.size > 3.5 * 1024 * 1024) {
      return alert("Image file must be under 3.5 MB.");
    }
    setFile(chosen);
    const url = URL.createObjectURL(chosen);
    setPreview(url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      return alert("Please upload a photo of your personal QR code.");
    }
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      return alert("Please enter a valid consultation fee amount.");
    }

    const base64Data = await fileToBase64(file);
    const payload = {
      amount: numAmount,
      note,
      qrImage: {
        name: file.name,
        mime: file.type,
        data: base64Data,
      },
    };

    const res = await action.run(() => post<{ chat: any }>(`/consultations/${appointmentId}/fee-request`, payload));
    if (res?.chat) {
      onDone(res.chat);
    }
  };

  return (
    <Modal title="Upload Personal QR Code & Request Fee" onClose={onClose}>
      <form className="stack" onSubmit={handleSubmit}>
        <Alert>
          Upload your personal UPI / payment QR code (Google Pay, PhonePe, Paytm, etc.). It will be displayed in the consultation chat for the patient to scan and pay.
        </Alert>

        <label className="ui-field">
          <span>Consultation Fee Amount (₹)</span>
          <input
            type="number"
            min={1}
            max={100000}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 500"
          />
        </label>

        <label className="ui-field">
          <span>Instructions or message for patient</span>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Please scan and pay consultation fee..."
          />
        </label>

        <label className="ui-field">
          <span>Upload photo of your Personal QR Code</span>
          <div className="file-drop-area">
            <input
              type="file"
              accept="image/png,image/jpeg"
              required
              onChange={handleFileChange}
            />
            {preview ? (
              <div className="file-preview-box">
                <img src={preview} alt="QR Code Preview" className="uploaded-preview-thumbnail" />
                <span className="file-name-label">{file?.name}</span>
              </div>
            ) : (
              <div className="file-placeholder">
                <QrCode size={28} />
                <span>Choose PNG or JPEG image of your QR code</span>
              </div>
            )}
          </div>
        </label>

        {action.error && <Alert kind="error">{action.error}</Alert>}

        <div className="row-actions">
          <button type="button" className="outline-button" onClick={onClose}>
            Cancel
          </button>
          <SubmitButton busy={action.busy} disabled={!file || !amount}>
            <Send size={15} /> Send QR Code & Fee Request
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

// Patient Submit Payment Proof Modal
function PatientProofModal({
  appointmentId,
  defaultAmount,
  onClose,
  onDone,
}: {
  appointmentId: string;
  defaultAmount?: number;
  onClose: () => void;
  onDone: (chat: any) => void;
}) {
  const [utr, setUtr] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const action = useAction();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    if (!["image/png", "image/jpeg"].includes(chosen.type)) {
      return alert("Please upload a PNG or JPEG screenshot of your payment.");
    }
    if (chosen.size > 3.5 * 1024 * 1024) {
      return alert("Screenshot must be under 3.5 MB.");
    }
    setFile(chosen);
    const url = URL.createObjectURL(chosen);
    setPreview(url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!utr.trim()) {
      return alert("Please enter the UTR / Transaction Reference Number.");
    }
    if (!file) {
      return alert("Please upload the payment screenshot.");
    }

    const base64Data = await fileToBase64(file);
    const payload = {
      utr: utr.trim(),
      note: note.trim(),
      screenshot: {
        name: file.name,
        mime: file.type,
        data: base64Data,
      },
    };

    const res = await action.run(() => post<{ chat: any }>(`/consultations/${appointmentId}/payment-proof`, payload));
    if (res?.chat) {
      onDone(res.chat);
    }
  };

  return (
    <Modal title="Upload Payment Screenshot & UTR" onClose={onClose}>
      <form className="stack" onSubmit={handleSubmit}>
        <Alert>
          {defaultAmount
            ? `Fee Amount: ₹${defaultAmount}. After paying via the doctor's QR code, upload your transaction screenshot and enter the 12-digit UTR or reference number.`
            : "After paying the doctor via QR code or UPI, upload your transaction screenshot and enter the UTR or reference number."}
        </Alert>

        <label className="ui-field">
          <span>UTR / Transaction Reference Number *</span>
          <input
            type="text"
            required
            minLength={4}
            maxLength={64}
            value={utr}
            onChange={(e) => setUtr(e.target.value)}
            placeholder="e.g. 329182947192 or UPI Ref No"
          />
          <small>Found in your payment app (Google Pay, PhonePe, Paytm, Bank app) under Transaction Details.</small>
        </label>

        <label className="ui-field">
          <span>Optional Note / Payment App</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Paid ₹500 via Google Pay"
          />
        </label>

        <label className="ui-field">
          <span>Payment Screenshot *</span>
          <div className="file-drop-area">
            <input
              type="file"
              accept="image/png,image/jpeg"
              required
              onChange={handleFileChange}
            />
            {preview ? (
              <div className="file-preview-box">
                <img src={preview} alt="Payment Screenshot Preview" className="uploaded-preview-thumbnail" />
                <span className="file-name-label">{file?.name}</span>
              </div>
            ) : (
              <div className="file-placeholder">
                <ImageIcon size={28} />
                <span>Choose payment success screenshot (PNG/JPEG)</span>
              </div>
            )}
          </div>
        </label>

        {action.error && <Alert kind="error">{action.error}</Alert>}

        <div className="row-actions">
          <button type="button" className="outline-button" onClick={onClose}>
            Cancel
          </button>
          <SubmitButton busy={action.busy} disabled={!file || !utr.trim()}>
            <Check size={15} /> Submit Payment Proof
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
