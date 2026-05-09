import { useLayoutEffect, useRef, useState } from "react";

interface Props {
  text: string;
  lines?: 2 | 3 | 4;
  className?: string;
  style?: React.CSSProperties;
}

// Clamp text to N lines via CSS line-clamp; show a "show all" toggle when the
// content is actually overflowing (measured at layout time). Avoids hard
// truncation in the source — the full string is always in the DOM.
export default function Clamp({ text, lines = 3, className, style }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (expanded) return;
      setOverflows(el.scrollHeight - 1 > el.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, lines, expanded]);

  return (
    <>
      <div
        ref={ref}
        className={`${expanded ? "" : `clamp lines-${lines}`} ${className ?? ""}`.trim()}
        style={style}
      >
        {text}
      </div>
      {overflows && (
        <button
          type="button"
          className="clamp-toggle"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "show less" : "show all"}
        </button>
      )}
    </>
  );
}
