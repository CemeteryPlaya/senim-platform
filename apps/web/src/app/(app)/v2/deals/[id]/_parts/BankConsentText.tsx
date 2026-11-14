"use client";

import { useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import type { ConsentDocument } from "@/i18n/ru/consent";
import { Card, cn, Notice, Stack } from "@/kit";
import { isScrolledToEnd } from "../../../consent/ConsentForm";

const t = ru.app.deal.pay.consent;

/**
 * Текст согласия на передачу данных банку (`consentDocument("BANK_TRANSFER")` — правовой текст как есть): плашка
 * «Черновик…» и карточка со своей прокруткой — затухание и «Прокрутите…», пока не дочитан (как экран согласия). Общий для
 * оплаты покупателя и подписи оферты мастером.
 */
export function BankConsentText({ document: doc }: { document: ConsentDocument }) {
  const region = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const checkEnd = () => {
    if (region.current) setAtEnd(isScrolledToEnd(region.current));
  };
  useEffect(checkEnd, [doc.version]);
  return (
    <Stack>
      <Notice tone="warn">{doc.draft}</Notice>
      <Card>
        <div data-end={atEnd} className="scroll-fade">
          <div ref={region} role="region" aria-label={t.textLabel} tabIndex={0} onScroll={checkEnd} className="max-h-64 overflow-y-auto desktop:max-h-80">
            <Stack>
              <p className="text-sub text-muted">{ru.app.onboarding.consent.edition(doc.version)}</p>
              <p className="text-card text-ink">{doc.title}</p>
              {doc.sections.map((section) => (
                <section key={section.heading} className="flex flex-col gap-1">
                  <h3 className="text-card text-ink">{section.heading}</h3>
                  <p className="text-body text-ink">{section.body}</p>
                </section>
              ))}
            </Stack>
          </div>
        </div>
        <p aria-hidden={atEnd} className={cn("mt-3 text-sub text-muted transition-opacity duration-100", atEnd && "opacity-0")}>
          {t.scrollHint}
        </p>
      </Card>
    </Stack>
  );
}
