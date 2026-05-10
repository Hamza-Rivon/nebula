import { useEffect, useRef, useState } from "react";

export function useChartSize<T extends HTMLElement = HTMLDivElement>(): {
  ref: React.RefObject<T | null>;
  width: number;
  height: number;
} {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      setSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}
