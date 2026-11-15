"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import type { ConsentDocument } from "@/i18n/ru/consent";
import { ActionDock, Button, Card, Checkbox, cn, Explain, HiddenField, Notice, Stack } from "@/kit";
import type { ActionResult } from "@/platform/action";
import type { Device } from "@/platform/device";
import { FormError } from "../../_shell/FormError";
import { useActionForm } from "../../_shell/form";
import { OnboardingHeader } from "../../_shell/OnboardingHeader";
import { grantConsentAction } from "./actions";

const t = ru.app.onboarding.consent;
const screen = ru.consent.screen;
const FORM = "consent-form";

/** Допуск (px) на дробные размеры: область считается прокрученной до конца, если до нижнего края меньше двух пикселей. */
const END_TOLERANCE = 2;

/** Прокручен ли текст до конца (или он помещается целиком). Чистая функция: размеры берёт вызывающий. */
export function isScrolledToEnd(box: { scrollTop: number; clientHeight: number; scrollHeight: number }): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= END_TOLERANCE;
}

/**
 * Ответ «текст согласия обновился» (CONFLICT): экран просит сервер перечитать страницу — придёт новая редакция, а форма
 * с отметкой пересоздаётся (key по версии), так что новую редакцию подтверждают заново. Остальные ответы — как есть.
 */
export function refreshOnConflict<T>(result: ActionResult<T>, refresh: () => void): ActionResult<T> {
  if (!result.ok && result.code === "CONFLICT") refresh();
  return result;
}

type Props = {
  /** Текущая редакция текста согласия. */
  document: ConsentDocument;
  /** У человека было согласие прежней редакции — текст обновился. */
  updated: boolean;
  /** Возврат после первых шагов (уже проверен safeNext). */
  next: string | null;
  step: number;
  total: number;
  device: Device;
};

/**
 * Экран согласия: текст в прокручиваемой карточке (область доступна с клавиатуры), отметка «Я согласен», одна главная
 * кнопка в доке («Выйти» — в шапке оболочки, «Назад» на шагах нет). Текст согласия показывается как есть — хэш, который хранит identity, считается от него.
 * Сервер получает редакцию, которую человек видел: если текст сменился между показом и нажатием, действие отвечает
 * CONFLICT, экран перечитывается, а форма (вместе с отметкой) пересоздаётся — новую редакцию подтверждают заново.
 */
export function ConsentForm({ document: doc, updated, next, step, total, device }: Props) {
  const router = useRouter();
  const form = useActionForm(async (input: Parameters<typeof grantConsentAction>[0]) =>
    refreshOnConflict(await grantConsentAction(input), () => router.refresh()),
  );
  // До конца прокрутки у нижнего края области — затухание и подпись; без JavaScript они просто остаются.
  const region = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const checkEnd = () => {
    if (region.current) setAtEnd(isScrolledToEnd(region.current));
  };
  useEffect(checkEnd, [doc.version]);

  return (
    <div className="desktop:mx-auto desktop:max-w-narrow">
      <Stack gap="section">
        <Stack gap="tight">
          <OnboardingHeader step={step} total={total} title={t.title} />
          {/* Первый раз заголовок говорит сам за себя; про обновлённую редакцию человеку нужно сказать. */}
          {updated && <p className="text-body text-muted">{screen.updated}</p>}
          {/* Кнопка пояснения встаёт по левой линии текста, а не по центру растянутой колонки. */}
          <div>
            <Explain label={t.explain.label} title={t.explain.title} device={device}>
              <p>{t.explain.body}</p>
            </Explain>
          </div>
        </Stack>
        {/* Высота области текста: телефон — до max-h-64 (отметка и кнопка остаются на первом экране 390x844 и 412x839),
            компьютер — до max-h-80. Растяжение flex-1 на свободное место не годится: высоту содержимого колонки оно не
            ограничивает, и отметка уходила под док. */}
        <Stack>
          <Notice tone="warn">{doc.draft}</Notice>
          <Card>
            {/* Область со своей прокруткой, в фокусе клавиатуры: стрелки и PageDown читают текст, диктор называет область.
                Что текст длиннее показанного, видно по затуханию у нижнего края и подписи (scroll-fade). */}
            <div data-end={atEnd} className="scroll-fade">
              <div
                ref={region}
                role="region"
                aria-label={t.textLabel}
                tabIndex={0}
                onScroll={checkEnd}
                className="max-h-64 overflow-y-auto desktop:max-h-80"
              >
                <Stack>
                  <p className="text-sub text-muted">{t.edition(doc.version)}</p>
                  <p className="text-headline text-ink">{doc.title}</p>
                  {doc.sections.map((section) => (
                    <section key={section.heading} className="flex flex-col gap-1">
                      <h2 className="text-headline text-ink">{section.heading}</h2>
                      <p className="text-body text-ink">{section.body}</p>
                    </section>
                  ))}
                </Stack>
              </div>
            </div>
            {/* Подпись держит место всегда (раскладка не прыгает); в конце текста гаснет и уходит от диктора. */}
            <p aria-hidden={atEnd} className={cn("mt-3 text-sub text-muted transition-opacity duration-100", atEnd && "opacity-0")}>
              {t.scrollHint}
            </p>
          </Card>
        </Stack>
        <form key={doc.version} id={FORM} method="post" onSubmit={form.onSubmit} noValidate>
          <Stack gap="section">
            <Checkbox name="agreed" value="on" label={t.agree} error={form.fieldErrors.agreed} />
            <HiddenField name="version" value={doc.version} />
            <HiddenField name="next" value={next ?? ""} />
            <FormError error={form.error} atField={Boolean(form.fieldErrors.agreed)} />
          </Stack>
        </form>
        <ActionDock>
          <Button type="submit" form={FORM} pending={form.pending}>
            {t.submit}
          </Button>
        </ActionDock>
      </Stack>
    </div>
  );
}
