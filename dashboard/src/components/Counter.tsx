import { useEffect, useRef, useState } from "react";

interface Props {
  to: number;
  duration?: number;
  format: (v: number) => string;
  className?: string;
}

// rAF-driven count-up. Eases out cubically. Resets when `to` changes.
export default function Counter({
  to,
  duration = 1200,
  format,
  className,
}: Props) {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);

  useEffect(() => {
    fromRef.current = value;
    startRef.current = null;
    let raf = 0;
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const elapsed = t - startRef.current;
      const p = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(fromRef.current + (to - fromRef.current) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, duration]);

  return <span className={className}>{format(value)}</span>;
}
