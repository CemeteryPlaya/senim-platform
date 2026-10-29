import Link from "next/link";
import { db } from "@/lib/db";
import { BRAND } from "@/lib/brand";
import { LEGAL_TYPE } from "@/lib/deal/labels";
import type { CurrentUser } from "@/lib/session";
import { PersonaSwitcher, type Persona } from "@/components/persona-switcher";
import { NavLink } from "@/components/nav-link";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" width={32} height={32} />
      <span className="leading-none">
        <span className="block text-lg font-extrabold tracking-tight">{BRAND.name}</span>
        <span className="hidden text-[11px] text-muted sm:block">безопасные сделки</span>
      </span>
    </Link>
  );
}

export async function Header({ user }: { user: CurrentUser | null }) {
  const users = await db.user.findMany({ include: { master: true }, orderBy: { id: "asc" } });
  const personas: Persona[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    avatar: u.avatar,
    subtitle:
      u.role === "MASTER" && u.master
        ? `${LEGAL_TYPE[u.master.legalType]} · ${u.city}`
        : u.role === "ADMIN"
          ? "Споры, верификация, метрики"
          : `Заказчик · ${u.city}`,
  }));

  return (
    <header className="no-print sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
        <Logo />
        <nav className="ml-2 hidden items-center gap-1 md:flex">
          <NavLink href="/masters">Мастера</NavLink>
          {user && user.role !== "ADMIN" && <NavLink href="/deals">Мои сделки</NavLink>}
          {user?.role === "ADMIN" && <NavLink href="/admin">Панель оператора</NavLink>}
        </nav>
        <div className="ml-auto">
          <PersonaSwitcher personas={personas} currentId={user?.id ?? null} />
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-line px-3 py-1.5 md:hidden">
        <NavLink href="/masters">Мастера</NavLink>
        {user && user.role !== "ADMIN" && <NavLink href="/deals">Мои сделки</NavLink>}
        {user?.role === "ADMIN" && <NavLink href="/admin">Оператор</NavLink>}
      </nav>
    </header>
  );
}
