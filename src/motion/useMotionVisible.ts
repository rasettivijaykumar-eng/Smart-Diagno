import { useCallback, useEffect, useState, type RefCallback } from "react";

/** Pause continuous animations when the element is off-screen. */
export function useMotionVisible<T extends HTMLElement>(rootMargin = "80px"): [RefCallback<T>, boolean] {
  const [node, setNode] = useState<T | null>(null);
  const [visible, setVisible] = useState(true);
  const setRef = useCallback((element: T | null) => setNode(element), []);

  useEffect(() => {
    if (!node || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(false);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.05, rootMargin },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [node, rootMargin]);

  return [setRef, visible];
}
