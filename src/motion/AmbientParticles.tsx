import type { CSSProperties } from "react";

const defaults = [
  { top: "8%", left: "12%", "--px": "10px", "--py": "-16px", delay: "0s" },
  { top: "18%", left: "78%", "--px": "-12px", "--py": "10px", delay: "-1.2s" },
  { top: "42%", left: "6%", "--px": "14px", "--py": "-8px", delay: "-2.4s" },
  { top: "55%", left: "88%", "--px": "-8px", "--py": "-14px", delay: "-.6s" },
  { top: "72%", left: "22%", "--px": "6px", "--py": "12px", delay: "-3s" },
  { top: "80%", left: "64%", "--px": "-10px", "--py": "-6px", delay: "-1.8s" },
  { top: "28%", left: "48%", "--px": "8px", "--py": "14px", delay: "-2.8s" },
  { top: "62%", left: "40%", "--px": "-6px", "--py": "-12px", delay: "-4s" },
  { top: "12%", left: "58%", "--px": "4px", "--py": "8px", delay: "-.4s" },
  { top: "88%", left: "8%", "--px": "12px", "--py": "-10px", delay: "-3.6s" },
  { top: "36%", left: "92%", "--px": "-14px", "--py": "6px", delay: "-2s" },
  { top: "48%", left: "30%", "--px": "9px", "--py": "-15px", delay: "-1.4s" },
  { top: "6%", left: "34%", "--px": "-7px", "--py": "11px", delay: "-5s" },
  { top: "94%", left: "52%", "--px": "11px", "--py": "-9px", delay: "-2.2s" },
  { top: "70%", left: "84%", "--px": "-5px", "--py": "13px", delay: "-3.8s" },
  { top: "22%", left: "4%", "--px": "13px", "--py": "-7px", delay: "-4.6s" },
] as const;

/** Slow drifting ambient dots for atmosphere. */
export function AmbientParticles({ count = 16, className = "" }: { count?: number; className?: string }) {
  const items = defaults.slice(0, Math.min(count, defaults.length));
  return (
    <div className={`m-particles ${className}`.trim()} aria-hidden="true">
      {items.map((p, i) => (
        <span
          key={i}
          className="m-particle"
          style={{
            top: p.top,
            left: p.left,
            animationDelay: p.delay,
            ["--px" as string]: p["--px"],
            ["--py" as string]: p["--py"],
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
