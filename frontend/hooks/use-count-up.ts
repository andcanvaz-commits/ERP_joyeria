"use client";

import { useEffect, useState } from "react";

/** Anima un numero entero de 0 al valor final (~650ms, ease-out) cada vez
 * que target cambia. Respeta prefers-reduced-motion (salta directo al
 * valor final, sin animar). */
export function useCountUp(target: number, durationMs = 650): number {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return display;
}
