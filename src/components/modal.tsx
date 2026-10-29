"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Modal({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // Портал: модалку открывают из анимированных карточек, а transform у предка ломает position: fixed
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={`animate-rise relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-surface shadow-2xl sm:rounded-3xl ${wide ? "sm:max-w-xl" : "sm:max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 z-10 rounded-full p-1.5 text-muted hover:bg-ink/5" aria-label="Закрыть">
          <X size={18} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}
