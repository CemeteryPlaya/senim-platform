import { Card, PhotoGallery, Stack, StatusChip, TextLink } from "@/kit";
import type { DesignView } from "./design-files";

/**
 * Раздел «Дизайн-проект» карточкой (как «Фото помещения» рядом): фото — галереей, по нажатию на весь экран; PDF и
 * скрытые оператором файлы — ссылками в новой вкладке, у скрытого — плашка. Подписи готовы (`designView`).
 */
export function DesignFiles({ title, view }: { title: string; view: DesignView }) {
  return (
    <Card>
      <Stack>
        <h3 className="text-sub text-muted">{title}</h3>
        {view.gallery.length > 0 && <PhotoGallery layout="strip" label={title} photos={view.gallery} />}
        {view.rows.length > 0 && (
          <ul className="flex flex-col">
            {view.rows.map((row) => (
              <li key={row.id} className="flex flex-col items-start">
                <TextLink href={row.href} external>
                  {row.label}
                </TextLink>
                {row.hidden && <StatusChip tone="neutral">{row.hidden}</StatusChip>}
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </Card>
  );
}
