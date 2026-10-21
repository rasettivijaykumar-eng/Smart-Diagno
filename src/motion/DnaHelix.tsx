import type { CSSProperties } from "react";

/** Decorative animated DNA double-helix SVG. */
export function DnaHelix({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={`m-dna ${className}`.trim()} style={style} aria-hidden="true">
      <svg viewBox="0 0 40 120" fill="none">
        <path className="strand-a" d="M8 4 C28 20, 28 40, 8 56 C28 72, 28 92, 8 116" />
        <path className="strand-b" d="M32 4 C12 20, 12 40, 32 56 C12 72, 12 92, 32 116" />
        <line className="rung" x1="12" y1="16" x2="28" y2="16" />
        <line className="rung" x1="14" y1="36" x2="26" y2="36" />
        <line className="rung" x1="12" y1="56" x2="28" y2="56" />
        <line className="rung" x1="14" y1="76" x2="26" y2="76" />
        <line className="rung" x1="12" y1="96" x2="28" y2="96" />
      </svg>
    </div>
  );
}
