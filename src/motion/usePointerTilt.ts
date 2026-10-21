import { useEffect, useRef, type RefObject } from "react";

/** Gentle pointer tilt for desktop. Disabled for reduced-motion and coarse pointers. */
export function usePointerTilt<T extends HTMLElement>(intensity = 10): RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const onMove = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - 0.5;
      const y = (event.clientY - box.top) / box.height - 0.5;
      el.style.setProperty("--tilt-x", `${(-y * intensity).toFixed(2)}deg`);
      el.style.setProperty("--tilt-y", `${(x * intensity * 1.15).toFixed(2)}deg`);
      el.style.setProperty("--spot-x", `${((x + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty("--spot-y", `${((y + 0.5) * 100).toFixed(1)}%`);
    };
    const reset = () => {
      el.style.setProperty("--tilt-x", "0deg");
      el.style.setProperty("--tilt-y", "0deg");
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", reset);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", reset);
    };
  }, [intensity]);

  return ref as RefObject<T>;
}
