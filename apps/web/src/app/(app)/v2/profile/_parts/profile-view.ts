import type { Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { formatPhone, switchTargets, type CurrentUser } from "@/modules/identity";
import { switchRoleTo } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";

const t = ru.app.profile;

/** Строка раздела: подпись и адрес v2. */
export type ProfileLink = { label: string; href: string };

export type ProfileModel = {
  name: string;
  phone: string;
  roleLine: string;
  /** Разделы-ссылки. Контакты и «Мои данные» — только у сторон сделки (покупатель, мастер). */
  sections: ProfileLink[];
  /** Смена роли: другая выданная роль и, если роли мастера нет, «Стать мастером». */
  roles: ProfileLink[];
};

type ProfileUser = Pick<CurrentUser, "role" | "roles" | "fullName" | "phone">;

const isParty = (role: Role): boolean => role === "CLIENT" || role === "EXECUTOR";

/** Строки раздела «Роль»: переключение только на выданную роль; роли мастера нет — регистрация мастера (заглушка v1 до этапа 4). */
export function roleLinks(user: Pick<CurrentUser, "role" | "roles">): ProfileLink[] {
  const links: ProfileLink[] = switchTargets(user).map((role) => ({ label: t.role.switchTo[role], href: switchRoleTo(role, to("/profile")) }));
  if (isParty(user.role) && !user.roles.includes("EXECUTOR")) links.push({ label: t.role.becomeMaster, href: to("/register/executor") });
  return links;
}

/** Что показать на экране профиля: имя как записано, телефон, активная роль, разделы и роли. Чистая функция. */
export function profileModel(user: ProfileUser): ProfileModel {
  const sections: ProfileLink[] = [];
  if (isParty(user.role)) {
    sections.push({ label: t.rows.contacts, href: to("/profile/contacts") }, { label: t.rows.data, href: to("/profile/data") });
  }
  sections.push({ label: t.rows.notifications, href: to("/notifications") }, { label: t.rows.help, href: to("/help") });
  return {
    name: user.fullName ?? t.nameMissing,
    phone: formatPhone(user.phone),
    roleLine: t.roleLine(t.roleNames[user.role]),
    sections,
    roles: roleLinks(user),
  };
}
