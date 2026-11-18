import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { buyerHistory } from "@/modules/requests";
import { getTheme } from "@/kit/theme";
import { getDevice } from "@/platform/device";
import { requireV2User } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { ProfileView } from "../_parts/ProfileView";
import { profileModel } from "../_parts/profile-view";

export const metadata: Metadata = { title: ru.app.profile.metaTitle };

/**
 * «Профиль» — последняя вкладка любой роли. Нужен только вошедший с пройденными первыми шагами (любая роль: оператору
 * и замерщику показываются имя, телефон, тема и выход). Выход на телефоне живёт здесь: в мобильной оболочке меню профиля нет.
 */
export default async function ProfilePage() {
  const user = await requireV2User(to("/profile"));
  const [theme, device] = await Promise.all([getTheme(), getDevice()]);
  // История — только у покупателя: у мастера buyerHistory отказывает (FORBIDDEN), а экран остаётся прежним.
  const history = user.role === "CLIENT" ? await buyerHistory(user) : undefined;
  return <ProfileView model={profileModel(user, history)} theme={theme} device={device} />;
}
