"use client";

import { Check, ChevronDown, LogIn } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { switchUser } from "@/app/actions";
import { Avatar } from "@/components/ui";

export type Persona = { id: string; name: string; role: "CLIENT" | "MASTER" | "ADMIN"; avatar: string; subtitle: string };

const GROUPS = [
  { role: "CLIENT", label: "Заказчики" },
  { role: "MASTER", label: "Мастера и компании" },
  { role: "ADMIN", label: "Оператор" },
] as const;

const ROLE_LABEL = { CLIENT: "Заказчик", MASTER: "Исполнитель", ADMIN: "Оператор" };

export function PersonaSwitcher({ personas, currentId }: { personas: Persona[]; currentId: string | null }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const current = personas.find((p) => p.id === currentId);

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick(id: string) {
    setOpen(false);
    start(async () => {
      await switchUser(id);
      router.refresh();
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl border border-line bg-surface py-1.5 pr-2.5 pl-1.5 text-left text-sm hover:border-ink/30"
        aria-expanded={open}
      >
        {current ? (
          <>
            <Avatar name={current.name} color={current.avatar} size={28} />
            <span className="hidden leading-tight sm:block">
              <span className="block max-w-40 truncate font-semibold">{current.name}</span>
              <span className="block text-xs text-muted">{ROLE_LABEL[current.role]}</span>
            </span>
          </>
        ) : (
          <span className="flex items-center gap-2 px-1.5 font-semibold">
            <LogIn size={16} /> Демо-вход
          </span>
        )}
        <ChevronDown size={16} className={pending ? "animate-spin text-muted" : "text-muted"} />
      </button>

      {open && (
        <div className="animate-rise absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-surface shadow-xl">
          <div className="border-b border-line bg-surface-2 px-4 py-2.5 text-xs text-muted">
            Демо-режим: войдите за любую сторону сделки. В продакшене — вход по SMS-коду.
          </div>
          <div className="max-h-[70vh] overflow-y-auto py-1">
            {GROUPS.map((g) => (
              <div key={g.role}>
                <div className="px-4 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{g.label}</div>
                {personas
                  .filter((p) => p.role === g.role)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => pick(p.id)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-ink/5"
                    >
                      <Avatar name={p.name} color={p.avatar} size={32} />
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted">{p.subtitle}</span>
                      </span>
                      {p.id === currentId && <Check size={16} className="text-brand" />}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
