import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { errorMessage } from "./api";

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await loaderRef.current()); setError(null); } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, deps);
  return { data, error, loading, reload, setData };
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="ui-loading" role="status"><Loader2 size={18} className="spin" /> {label}</div>;
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="skeleton-block" aria-hidden="true">{Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${90 - i * 14}%` }} />)}</div>;
}

export function Alert({ kind = "info", children }: { kind?: "info" | "error" | "success" | "warn"; children: ReactNode }) {
  const Icon = kind === "error" || kind === "warn" ? AlertTriangle : kind === "success" ? CheckCircle2 : Info;
  return <div className={`ui-alert ui-alert-${kind}`} role={kind === "error" ? "alert" : "status"}><Icon size={17} /><div>{children}</div></div>;
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return <div className="ui-empty">{icon && <div className="ui-empty-icon">{icon}</div>}<strong>{title}</strong>{text && <p>{text}</p>}{action}</div>;
}

export function Panel({ title, kicker, action, children, className = "" }: { title?: string; kicker?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`ui-panel ${className}`}>
      {(title || action) && <header className="ui-panel-head"><div>{kicker && <span className="small-kicker">{kicker}</span>}{title && <h2>{title}</h2>}</div>{action}</header>}
      {children}
    </section>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad" | "info"; children: ReactNode }) {
  return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>;
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return <label className="ui-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}{error && <small className="ui-field-error">{error}</small>}</label>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onClose]);
  return (
    <div className="ui-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="ui-modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header><h2>{title}</h2><button className="ui-icon-btn" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></header>
        {children}
      </div>
    </div>
  );
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true); setError(null); setDone(null);
    try { const result = await fn(); if (success) setDone(success); return result; } catch (e) { setError(errorMessage(e)); return undefined; } finally { setBusy(false); }
  };
  return { busy, error, done, run, clear: () => { setError(null); setDone(null); } };
}

export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
export const humanize = (value: string) => value.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

export const statusTone = (status: string): "good" | "warn" | "bad" | "info" | "neutral" =>
  ["verified", "confirmed", "active", "delivered", "completed", "resolved", "taken"].includes(status) ? "good"
    : ["pending", "awaiting_confirmation", "received", "under_review", "open", "unacknowledged", "due"].includes(status) ? "warn"
      : ["rejected", "cancelled", "revoked", "suspended", "no_show", "skipped"].includes(status) ? "bad" : "info";

export function SubmitButton({ busy, children, ...rest }: { busy: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className="button" type="submit" disabled={busy} {...rest}>{busy ? <Loader2 size={16} className="spin" /> : null}{children}</button>;
}
