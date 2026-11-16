import { Phone } from "lucide-react";
import { ru } from "@/i18n/ru";
import { buttonClasses } from "./button-styles";
import { CopyButton } from "./CopyButton";
import { telHref, whatsappHref } from "./external-links";

export type ContactActionsProps = {
  /** Номер в формате E.164 (как отдаёт модуль). */
  phone: string;
  /** Номер для показа («+7 700 123 45 67»). */
  phoneDisplay: string;
};

/**
 * Действия с номером другой стороны: «Позвонить» (`tel:`), «WhatsApp» (`wa.me`, новая вкладка или приложение) и копирование.
 * Показывать только там, где модуль уже отдал контакты (после оферты): компонент сам ничего не скрывает. Серверный компонент.
 */
export function ContactActions({ phone, phoneDisplay }: ContactActionsProps) {
  const t = ru.app.kit.contact;
  const wa = whatsappHref(phone);
  return (
    <div className="flex flex-wrap items-center gap-2 px-card pb-3">
      <a href={telHref(phone)} className={buttonClasses({ variant: "secondary", size: "sm" })}>
        <Phone aria-hidden className="size-5" />
        {t.call}
        <span className="sr-only">{`: ${phoneDisplay}`}</span>
      </a>
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "secondary", size: "sm" })}>
          {t.whatsapp}
          <span className="sr-only">{` (${ru.app.kit.externalHint})`}</span>
        </a>
      )}
      <CopyButton value={phoneDisplay} label={t.copy} />
    </div>
  );
}
