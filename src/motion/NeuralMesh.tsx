/** Decorative neural-style connections — not a real AI model visualization. */
export function NeuralMesh({ className = "" }: { className?: string }) {
  return (
    <svg className={`m-neural ${className}`.trim()} viewBox="0 0 360 200" aria-hidden="true">
      <g className="m-neural-lines">
        <path d="M24 100 C70 20, 110 40, 160 88 C210 136, 250 40, 336 92" />
        <path d="M28 132 C90 170, 140 60, 200 108 C250 148, 290 90, 340 140" />
        <path d="M20 68 C80 88, 120 160, 188 72 C240 20, 280 150, 338 70" />
      </g>
      {[
        [40, 96], [88, 48], [132, 120], [176, 72], [214, 148], [258, 56], [302, 112], [336, 84],
      ].map(([cx, cy], i) => (
        <circle key={i} className="m-neural-node" cx={cx} cy={cy} r={i % 3 === 0 ? 5 : 3.5} style={{ animationDelay: `${-i * 0.4}s` }} />
      ))}
    </svg>
  );
}
