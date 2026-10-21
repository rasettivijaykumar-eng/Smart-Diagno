/** Continuous illustrative ECG stroke — no BPM or patient vitals. */
export function EcgWaveform({ className = "" }: { className?: string }) {
  return (
    <svg className={`m-ecg ${className}`.trim()} viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true">
      <path className="m-ecg-track" d="M0 30 H300" />
      <path
        className="m-ecg-path"
        d="M0 30 H48 L58 30 L68 8 L82 52 L94 14 L106 30 H148 L158 30 L168 10 L182 48 L194 30 H230 L240 30 L250 12 L262 44 L272 30 H300"
      />
    </svg>
  );
}
