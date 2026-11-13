import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, PageTitle, Stack } from "@/kit";
import { env } from "@/platform/env";

const t = ru.app.kit.showcase.dockPage;

/**
 * Служебная страница-образец для e2e (только dev): длинное содержимое и `ActionDock` последним ребёнком корневой
 * колонки — так док используют экраны. На ней проверяется прилипание над панелью вкладок.
 */
export default function DockPage() {
  if (env().APP_ENV !== "dev") notFound();
  return (
    <Stack gap="group">
      <PageTitle title={t.title} lead={t.lead} />
      {Array.from({ length: 30 }, (_, i) => (
        <Card key={i}>
          <p className="text-body text-ink">{t.paragraph(i + 1)}</p>
        </Card>
      ))}
      <div data-last-content>
        <Card>
          <p className="text-body text-ink">{t.last}</p>
        </Card>
      </div>
      <ActionDock>
        <Button>{t.primary}</Button>
        <Button variant="quiet">{t.quiet}</Button>
      </ActionDock>
    </Stack>
  );
}
