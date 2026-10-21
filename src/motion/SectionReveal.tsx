import { useEffect, type RefObject } from "react";

/**
 * Extends the existing `.sr` / IntersectionObserver pattern.
 * Call with a container ref; children matching `selector` get staggered reveal.
 */
export function useSectionReveal(
  containerRef: RefObject<HTMLElement | null>,
  selector = ".feature, .steps li, .privacy-grid li, .section-head, .split > div, .panel-card, .faq-list details",
) {
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;

    const els = Array.from(root.querySelectorAll<HTMLElement>(selector));
    els.forEach((el, i) => {
      el.classList.add("sr");
      el.style.transitionDelay = `${(i % 4) * 90}ms`;
    });

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            const parent = (e.target as HTMLElement).closest(".how-steps-wrap");
            parent?.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -32px 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [containerRef, selector]);
}
