import type { Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { formatPhone, isStaffRole, switchTargets, type CurrentUser } from "@/modules/identity";
import { masterStatusOf, switchRoleTo } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";

const t = ru.app.profile;
const m = ru.app.masterProfile.rows;

/** Строка раздела: подпись и адрес v2. */
export type ProfileLink = { label: string; href: string };

export type ProfileModel = {
  name: string;
  phone: string;
  roleLine: string;
  /** Разделы мастера (компания, документы, счёт, портфолио, финансы): только у активной роли «мастер»; у остальных пусто. */
  work: ProfileLink[];
  /**
   * Разделы-ссылки. Контакты и «Мои данные» — только у сторон сделки (покупатель, мастер); «Помощь» — не у сотрудников
   * площадки (её ответы — для покупателя и мастера, а у оператора раздел вёл бы в заглушку v1).
   */
  sections: ProfileLink[];
  /** Смена роли: другая выданная роль и, если роли мастера нет, «Стать мастером». */
  roles: ProfileLink[];
};

type ProfileUser = Pick<CurrentUser, "role" | "roles" | "fullName" | "phone"> & Partial<Pick<CurrentUser, "executor">>;

const isParty = (role: Role): boolean => role === "CLIENT" || role === "EXECUTOR";

/** Строки раздела «Роль»: переключение только на выданную роль; роли мастера нет — регистрация мастера. */
export function roleLinks(user: Pick<CurrentUser, "role" | "roles">): ProfileLink[] {
  const links: ProfileLink[] = switchTargets(user).map((role) => ({
    label: t.role.switchTo[role],
    href: switchRoleTo(role, to("/profile")),
  }));
  if (isParty(user.role) && !user.roles.includes("EXECUTOR")) links.push({ label: t.role.becomeMaster, href: to("/register/executor") });
  return links;
}

/**
 * Разделы мастера по статусу профиля. Одобренному — все: компания, документы, счёт для оплаты, портфолио, финансы,
 * публичный профиль. На проверке и после отказа — без финансов и публичной страницы (покупатели его ещё не видят), но со
 * ссылкой на статус проверки. Роль есть, анкеты нет — только регистрация.
 */
export function masterLinks(executor: CurrentUser["executor"] | undefined): ProfileLink[] {
  const status = masterStatusOf({ executor: executor ?? null });
  if (status === "none") return [{ label: m.register, href: to("/register/executor") }];
  const links: ProfileLink[] = [
    { label: m.company, href: to("/executor/profile") },
    { label: m.documents, href: to("/executor/profile/kyc") },
    { label: m.payout, href: to("/executor/profile/payout") },
    { label: m.portfolio, href: to("/executor/portfolio") },
  ];
  if (status !== "approved" || !executor) return [...links, { label: m.status, href: to("/register/executor") }];
  return [
    ...links,
    { label: m.finance, href: to("/executor/finance") },
    { label: m.publicProfile, href: to(`/executors/${executor.publicNumber}`) },
  ];
}

/** Что показать на экране профиля: имя как записано, телефон, активная роль, разделы и роли. Чистая функция. */
export function profileModel(user: ProfileUser): ProfileModel {
  const sections: ProfileLink[] = [];
  if (isParty(user.role)) {
    sections.push({ label: t.rows.contacts, href: to("/profile/contacts") }, { label: t.rows.data, href: to("/profile/data") });
  }
  sections.push({ label: t.rows.notifications, href: to("/notifications") });
  if (!isStaffRole(user.role)) sections.push({ label: t.rows.help, href: to("/help") });
  return {
    name: user.fullName ?? t.nameMissing,
    phone: formatPhone(user.phone),
    roleLine: t.roleLine(t.roleNames[user.role]),
    work: user.role === "EXECUTOR" ? masterLinks(user.executor) : [],
    sections,
    roles: roleLinks(user),
  };
}
