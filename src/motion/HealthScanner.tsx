/** Decorative scan / radar overlay. Never implies a real diagnosis. */
export function HealthScanner({
  active = false,
  inline = false,
  label = "Illustrative scan — not a medical reading",
  className = "",
}: {
  active?: boolean;
  inline?: boolean;
  label?: string;
  className?: string;
}) {
  const mode = active ? "m-scanner--active" : "m-scanner--decorative";
  const layout = inline ? "m-scanner--inline" : "";
  return (
    <div className={`m-scanner ${mode} ${layout} ${className}`.trim()} aria-hidden="true">
      <div className="m-scanner-grid" />
      {!inline && <div className="m-radar-sweep" />}
      <div className="m-scan-beam" />
      {label ? <span className="m-scanner-label">{label}</span> : null}
    </div>
  );
}
