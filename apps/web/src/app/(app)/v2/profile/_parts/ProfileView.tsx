import { ru } from "@/i18n/ru";
import { Card, List, ListRow, PageTitle, Section, Split, Stack } from "@/kit";
import type { Theme } from "@/kit/theme";
import type { Device } from "@/platform/device";
import { LogoutButton } from "../../../_shell/LogoutButton";
import { LogoutEverywhere } from "../../../_shell/LogoutEverywhere";
import { ThemeSwitch } from "../../../_shell/ThemeSwitch";
import type { ProfileModel } from "./profile-view";

const t = ru.app.profile;

/**
 * Профиль — корневой экран вкладки: кто вошёл (имя, телефон, роль), разделы списком со шевроном, «Оформление» с переключателем
 * темы на месте, «Роль» (если есть что менять) и тихая «Выйти» внизу. Главного действия на экране нет. Телефон — одна колонка;
 * компьютер — две: слева человек и разделы, справа оформление, роль и выход.
 */
export function ProfileView({ model, theme, device }: { model: ProfileModel; theme: Theme; device: Device }) {
  const who = (
    <Card>
      <p className="text-headline wrap-anywhere text-ink">{model.name}</p>
      <p className="mt-1 text-body text-muted tabular-nums">{model.phone}</p>
      <p className="text-body text-muted">{model.roleLine}</p>
    </Card>
  );
  const work = model.work.length > 0 && (
    <Section title={ru.app.masterProfile.sectionsTitle}>
      <nav aria-label={ru.app.masterProfile.sectionsLabel}>
        <Card padded={false}>
          <List>
            {model.work.map((row) => (
              <ListRow key={row.href} label={row.label} href={row.href} />
            ))}
          </List>
        </Card>
      </nav>
    </Section>
  );
  const sections = (
    <nav aria-label={t.sectionsLabel}>
      <Card padded={false}>
        <List>
          {model.sections.map((row) => (
            <ListRow key={row.href} label={row.label} href={row.href} />
          ))}
        </List>
      </Card>
    </nav>
  );
  const appearance = (
    <Section title={t.theme.title}>
      <Card>
        <ThemeSwitch current={theme} legend={t.theme.legend} />
      </Card>
    </Section>
  );
  const role = model.roles.length > 0 && (
    <Section title={t.role.title}>
      <Card padded={false}>
        <List>
          {model.roles.map((row) => (
            <ListRow key={row.href} label={row.label} href={row.href} />
          ))}
        </List>
      </Card>
    </Section>
  );
  const logout = (
    <div className="flex flex-col items-start gap-2">
      <LogoutButton />
      <LogoutEverywhere device={device} />
    </div>
  );

  return (
    <Stack gap="section">
      <PageTitle title={t.title} />
      {device === "desktop" ? (
        <Split
          main={
            <Stack gap="section">
              {who}
              {work}
              {sections}
            </Stack>
          }
          aside={
            <Stack gap="section">
              {appearance}
              {role}
              {logout}
            </Stack>
          }
        />
      ) : (
        <>
          {who}
          {work}
          {sections}
          {appearance}
          {role}
          {logout}
        </>
      )}
    </Stack>
  );
}
