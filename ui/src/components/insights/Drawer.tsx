import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  children?: ReactNode;
}

export function Drawer({ open, onClose, eyebrow, title, subtitle, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`insights-drawer-overlay ${open ? "open" : ""}`}
        onClick={onClose}
      />
      <aside
        className={`insights-drawer ${open ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="insights-drawer-head">
          {eyebrow && <div className="insights-drawer-eyebrow">{eyebrow}</div>}
          {title && <h2 className="insights-drawer-title">{title}</h2>}
          {subtitle && <div className="insights-drawer-subtitle">{subtitle}</div>}
          <button
            className="insights-drawer-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="insights-drawer-body">{children}</div>
      </aside>
    </>
  );
}
