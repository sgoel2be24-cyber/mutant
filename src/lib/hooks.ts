import { useEffect, useRef, useState } from "react";

/**
 * Detect the user's motion preference. If they asked the OS to reduce motion,
 * the demo respects it: no climbing numbers, no cascade — values render
 * immediately. Accessibility, not nicety.
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
 * Animate a displayed number toward `target`.
 *
 * The bug this exists to avoid: keying the animation on a transient phase
 * (running vs done) means the climb finishes while the score is still the old
 * one, and the real value arrives after the animation has already run. Instead
 * this animates whenever the TARGET changes, starting from whatever is on
 * screen right now, so the climb always lands on the score the run produced.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState<number>(target);
  const displayRef = useRef<number>(target);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    displayRef.current = value;
  }, [value]);

  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    const from = displayRef.current;
    if (from === target) {
      setValue(target);
      return;
    }
    const started = performance.now();
    // rAF can be suspended entirely (headless browsers, background tabs), which
    // would freeze the number at the start value. Fall back to a timer so the
    // count-up always reaches its target even when rAF never fires.
    const schedule = (cb: (now: number) => void): number => {
      if (typeof requestAnimationFrame === "function") {
        let fired = false;
        const raf = requestAnimationFrame((now) => {
          fired = true;
          cb(now);
        });
        // if rAF does not fire within two frames, drive it with a timeout
        setTimeout(() => {
          if (!fired) cb(performance.now());
        }, 34);
        return raf;
      }
      return window.setTimeout(() => cb(performance.now()), 16) as unknown as number;
    };
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) rafRef.current = schedule(tick);
    };
    rafRef.current = schedule(tick);
    return () => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafRef.current);
    };
    // animate on target change only; `value` is read via displayRef at start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, reduced]);

  return reduced ? target : value;
}

/**
 * Reveal a list of `count` items one at a time, returning how many are visible.
 * Used to light up each mutant's verdict in sequence so the run reads as a
 * narrative. Under reduced motion everything is visible immediately.
 */
export function useRevealCascade(count: number, stepMs = 90): number {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(count);
  const prevCountRef = useRef(count);

  useEffect(() => {
    // Only re-run the cascade when the SET changes (a fresh run), not on every
    // render. Under reduced motion, everything is visible at once.
    if (reduced || count <= 0) {
      setVisible(count);
      prevCountRef.current = count;
      return;
    }
    if (count === prevCountRef.current && visible === count) return;
    prevCountRef.current = count;
    setVisible(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setVisible(i);
      if (i >= count) clearInterval(id);
    }, stepMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, stepMs, reduced]);

  return reduced ? count : visible;
}
