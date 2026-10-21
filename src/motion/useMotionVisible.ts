import { useCallback, useEffect, useRef, useState, type RefCallback } from "react";

/** Pause continuous animations when the element is off-screen. */
export function useMotionVisible<T extends HTMLElement>(rootMargin = "80px"): [RefCallback<T>, boolean] {
  const ref = useRef<T | null>(null);
  const setRef = useCallback((element: T | null) => {
    ref.current = element;
  }, []);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(false);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.05, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return [setRef, visible];
}
