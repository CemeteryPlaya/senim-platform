import { AtSign, Phone } from "lucide-react";
import { ru } from "@/i18n/ru";
import type { PartyContacts as Contacts } from "@/modules/companies";
import { buttonClasses, cn } from "@/ui";

const t = ru.companies.chat.contacts;

export type PartyContactsProps = {
  /** Контакты другой стороны из companies.dealContacts или ChatView.contacts (только после оферты). */
  contacts: Contacts;
  /** Без заголовка и подсказки — строка под лентой чата. */
  compact?: boolean;
  className?: string;
};

/**
 * Контакты другой стороны сделки (ТЗ п. 3): телефон ссылкой tel: и Instagram, если указан.
 * Показывается только после заключения оферты — что показывать, решает companies (таблица CONTACTS).
 * Без хуков: работает и в серверном экране сделки, и в клиентской части чата.
 */
export function PartyContacts({ contacts, compact = false, className }: PartyContactsProps) {
  const title = contacts.of === "executor" ? t.titleOfExecutor : t.titleOfClient;
  return (
    <section aria-label={title} className={cn("flex flex-col gap-2", className)}>
      {!compact && (
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold text-ink">{title}</h2>
          <p className="text-base text-muted">{t.hint}</p>
        </div>
      )}
      {compact && <p className="text-sm text-muted">{title}</p>}
      <div className="flex flex-wrap gap-2">
        <a href={`tel:${contacts.phone}`} aria-label={t.call(contacts.phoneDisplay)} className={buttonClasses({ variant: "soft" })}>
          <Phone aria-hidden className="size-5" />
          {contacts.phoneDisplay}
        </a>
        {contacts.instagram && (
          <a
            href={`https://www.instagram.com/${encodeURIComponent(contacts.instagram)}/`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.openInstagram(contacts.instagram)}
            className={buttonClasses({ variant: "soft" })}
          >
            <AtSign aria-hidden className="size-5" />
            {contacts.instagram}
          </a>
        )}
      </div>
    </section>
  );
}
