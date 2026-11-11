import type { ConsentDocument } from "@/i18n/ru/consent";
import { ru } from "@/i18n/ru";
import { Alert } from "@/ui";

const t = ru.consent.screen;

/**
 * Текст согласия как его показывают человеку: отметка черновика первой строкой, редакция и разделы. Это тот самый объект,
 * хэш которого identity хранит в записи согласия, — экран ничего не добавляет к тексту и не убирает из него.
 */
export function ConsentText({ document: doc, headingLevel = "h2" }: { document: ConsentDocument; headingLevel?: "h2" | "h3" | "h4" }) {
  const Heading = headingLevel;
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning">{doc.draft}</Alert>
      <p className="text-base text-muted">{t.edition(doc.version)}</p>
      {doc.sections.map((s) => (
        <section key={s.heading} className="flex flex-col gap-1">
          <Heading className="text-lg font-bold text-ink">{s.heading}</Heading>
          <p className="max-w-prose text-lg text-ink">{s.body}</p>
        </section>
      ))}
    </div>
  );
}
