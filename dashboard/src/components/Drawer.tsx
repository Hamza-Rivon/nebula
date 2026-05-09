import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  children?: ReactNode;
}

export default function Drawer({
  open,
  onClose,
  eyebrow,
  title,
  subtitle,
  children,
}: Props) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // focus drawer for keyboard nav
    drawerRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            className="drawer"
            ref={drawerRef}
            tabIndex={-1}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="drawer-head">
              <div>
                {eyebrow && <div className="drawer-eyebrow">{eyebrow}</div>}
                {title && <h2 className="drawer-title">{title}</h2>}
                {subtitle && <div className="drawer-sub">{subtitle}</div>}
              </div>
              <button
                className="drawer-close"
                onClick={onClose}
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M2 2L12 12M12 2L2 12"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                </svg>
              </button>
            </div>
            <div className="drawer-body">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
