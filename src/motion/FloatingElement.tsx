import type { CSSProperties, ReactNode } from "react";

type MotionKind = "float" | "float-slow" | "float-fast" | "drift" | "glow-pulse" | "breathe";

const classMap: Record<MotionKind, string> = {
  float: "m-float",
  "float-slow": "m-float-slow",
  "float-fast": "m-float-fast",
  drift: "m-drift",
  "glow-pulse": "m-glow-pulse",
  breathe: "m-breathe",
};

export function FloatingElement({
  children,
  kind = "float",
  delay,
  className = "",
  style,
  as: Tag = "div",
}: {
  children: ReactNode;
  kind?: MotionKind;
  delay?: 1 | 2 | 3 | 4;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "span";
}) {
  const delayClass = delay ? `m-delay-${delay}` : "";
  return (
    <Tag className={`${classMap[kind]} ${delayClass} ${className}`.trim()} style={style}>
      {children}
    </Tag>
  );
}
