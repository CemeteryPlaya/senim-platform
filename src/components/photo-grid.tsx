"use client";

import clsx from "clsx";
import { X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

export function PhotoGrid({ photos, className, size = "md" }: { photos: string[]; className?: string; size?: "md" | "lg" }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <div className={clsx("flex flex-wrap gap-2", className)}>
        {photos.map((src, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setOpen(src)}
            className={clsx(
              "overflow-hidden rounded-lg border border-line transition hover:opacity-90",
              size === "lg" ? "h-36 w-48" : "h-20 w-28",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(null)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={open} alt="" className="max-h-full max-w-full rounded-xl bg-white" />
            <button className="absolute top-4 right-4 rounded-full bg-white/15 p-2 text-white" aria-label="Закрыть">
              <X size={20} />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
