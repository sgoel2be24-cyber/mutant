import { useEffect, useRef, useState } from "react";

/**
 * Detect the user's motion preference once. If they have asked their OS to
 * reduce motion, the demo respects it: no climbing numbers, no cascade — values
 * render immediately. This is an accessibility feature, not a nicety.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    return undefined;
  }, []);
  return reduced;
}

/**
 * Animate a number toward `target`. The demo's emotional peak is watching the
 * mutation score climb from the baseline to the improved value, so the change
 * must be VISIBLE, not instant. Under reduced-motion it snaps to the target.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState<number>(target);
  const fromRef = useRef<number>(target);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (reduced) {
      setValue(target);
      fromRef.current = target;
      return;
    }
    // Start from wherever the number is NOW, not from a stale target — a run
    // that finishes while a previous climb is in flight must still animate.
    const from = fromRef.current;
    if (from === target) {
      setValue(target);
      return;
    }
    fromRef.current = value;
    const origin = value;
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = origin + (target - origin) * eased;
      setValue(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // `value` is read at animation start; including it would retrigger the
    // effect every frame. It is intentionally the previous settled state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, reduced]);

  return reduced ? target : value;
}

/**
 * Reveal a list of `count` items one at a time. Returns how many are visible.
 * Used to light up each mutant's kill/survive verdict in sequence, which is
 * what turns the run from a static table into a narrative. Under reduced
 * motion, everything is visible immediately.
 */
export function useRevealCascade(count: number, stepMs = 90): number {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(count);

  useEffect(() => {
    if (reduced || count <= 0) {
      setVisible(count);
      return;
    }
    setVisible(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setVisible(i);
      if (i >= count) clearInterval(id);
    }, stepMs);
    return () => clearInterval(id);
  }, [count, stepMs, reduced]);

  return visible;
}
