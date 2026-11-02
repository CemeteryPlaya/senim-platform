import { getCurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { ButtonLink, Container, PageHeader } from "@/ui";
import { navFor } from "../_shell/nav";

/**
 * Экран «Нет доступа» для чужой роли (или неподтверждённого исполнителя): h1, «Назад» и одно
 * действие — первый раздел меню своей роли, чтобы человек не оставался в тупике.
 */
export async function NoAccess({ description, size }: { description: string; size?: "page" | "form" }) {
  const user = await getCurrentUser();
  const home = navFor(user, false).tabs[0]?.href ?? "/";
  return (
    <Container size={size} className="pb-10">
      <PageHeader title={ru.common.errors.forbidden} description={description} back={{ href: "/" }} />
      <ButtonLink href={home}>
        {ru.common.errors.mySections}
      </ButtonLink>
    </Container>
  );
}
