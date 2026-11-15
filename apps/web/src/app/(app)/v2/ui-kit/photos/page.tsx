import { LayoutGrid } from "lucide-react";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Columns, PageTitle, PhotoChoice, PhotoChoiceGroup, PhotoGallery, Section, Stack, WorkCard } from "@/kit";
import { env } from "@/platform/env";
import { standPhoto, standPhotosByType } from "@/platform/stand-photos";

const t = ru.app.kit.showcase.photosPage;

/**
 * Служебная страница витрины (только dev): фото-компоненты v2 на статических снимках стенда — карточка работы с ценой на
 * `glass-clear` и без фото, мозаика с галереей на весь экран, лента отчётов и плитки выбора. Фото работ и отчётов на
 * настоящих экранах приходят из загрузок; здесь — снимки `/stand-photos/`.
 */
export default async function PhotosPage() {
  if (env().APP_ENV !== "dev") notFound();
  const kitchens = standPhotosByType("kitchen", "portfolio");
  const reports = standPhotosByType("kitchen", "report");
  const gallery = [...kitchens, ...standPhotosByType("bedroom"), ...standPhotosByType("office", "portfolio")].map((p, i) => ({ src: p.src, alt: p.alt, caption: t.work(i + 1) }));
  const strip = reports.map((p) => ({ src: p.src, alt: p.alt, caption: t.report }));
  return (
    <Stack gap="section">
      <PageTitle title={t.title} lead={t.lead} />
      <Section title={t.cards}>
        <Columns count={3}>
          {kitchens.slice(0, 2).map((p, i) => (
            <WorkCard key={p.key} title={t.work(i + 1)} meta={t.meta} priceFrom={85_000_000n} media="slot" photo={{ src: p.src, alt: p.alt }} />
          ))}
          <WorkCard title={t.noPhoto} meta={t.meta} priceFrom={85_000_000n} media="slot" />
        </Columns>
      </Section>
      <Section title={t.mosaic}>
        <PhotoGallery photos={gallery} layout="mosaic" label={t.mosaic} />
      </Section>
      <Section title={t.strip}>
        <PhotoGallery photos={strip} layout="strip" label={t.strip} />
      </Section>
      <Section title={t.choices}>
        <PhotoChoiceGroup legend={t.legend}>
          <PhotoChoice name="sample" value="kitchen" label={t.kitchen} photo={{ src: standPhoto("kitchen-sage").src }} defaultChecked />
          <PhotoChoice name="sample" value="closet" label={t.closet} photo={{ src: standPhoto("report-closet-1").src }} />
          <PhotoChoice name="sample" value="other" label={t.other} description={t.otherNote} icon={<LayoutGrid aria-hidden className="size-10 text-muted" />} />
        </PhotoChoiceGroup>
      </Section>
    </Stack>
  );
}
