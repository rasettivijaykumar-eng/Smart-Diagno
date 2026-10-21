import { HeartPulse, Pill, ShieldCheck, Stethoscope } from "lucide-react";

/** Decorative elliptical rings with medical symbols — no clinical meaning. */
export function OrbitalRings({ className = "" }: { className?: string }) {
  return (
    <div className={`m-orbitals ${className}`.trim()} aria-hidden="true">
      <div className="m-orbital">
        <span className="m-orbital-dot" />
        <span className="m-orbital-icon" style={{ top: "12%", left: "72%" }}><Stethoscope size={14} /></span>
      </div>
      <div className="m-orbital m-orbital-mid">
        <span className="m-orbital-dot" style={{ background: "linear-gradient(120deg,#0fa89a,#2bb673)" }} />
        <span className="m-orbital-icon" style={{ top: "78%", left: "18%" }}><Pill size={14} /></span>
      </div>
      <div className="m-orbital m-orbital-inner">
        <span className="m-orbital-dot" style={{ background: "linear-gradient(120deg,#e5484d,#ff8a80)" }} />
        <span className="m-orbital-icon" style={{ top: "30%", left: "8%" }}><HeartPulse size={14} /></span>
        <span className="m-orbital-icon" style={{ top: "62%", left: "88%" }}><ShieldCheck size={14} /></span>
      </div>
    </div>
  );
}
