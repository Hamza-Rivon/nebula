import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  // Anchor point in viewport-fixed coordinates.
  x: number;
  y: number;
  placement?: "above" | "below";
  maxWidth?: number;
  children: ReactNode;
}

export function PortalTooltip({
  x,
  y,
  placement = "above",
  maxWidth = 260,
  children,
}: Props) {
  const [vw, setVw] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1024,
  );
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (typeof document === "undefined") return null;

  const half = maxWidth / 2;
  const left = Math.min(Math.max(x, half + 8), vw - half - 8);

  return createPortal(
    <div
      className="portal-tooltip"
      style={{
        position: "fixed",
        left,
        top: y,
        maxWidth,
        transform:
          placement === "above"
            ? "translate(-50%, calc(-100% - 12px))"
            : "translate(-50%, 12px)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
