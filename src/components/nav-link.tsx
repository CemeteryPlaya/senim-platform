"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const active = usePathname().startsWith(href);
  return (
    <Link
      href={href}
      className={clsx(
        "rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition",
        active ? "bg-ink/[0.07] text-ink" : "text-muted hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
