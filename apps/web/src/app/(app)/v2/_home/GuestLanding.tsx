import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, ChevronDown, ChevronRight, Hammer, Landmark, UserRound } from "lucide-react";
import { brand } from "@/config/brand";
import { ru } from "@/i18n/ru";
import { computeDealMoney } from "@/modules/payments";
import { ButtonLink, Explain, Money, PhoneFrame, TextLink, TrustCapsule } from "@/kit";
import type { Device } from "@/platform/device";
import { to } from "../../_shell/paths";
import { ABOUT_ANCHORS } from "../about/anchors";
import type { HeroPhoto, LandingImage, WorkTile } from "./landing-media";
import { loginHref } from "./links";

/**
 * Части лендинга гостя (разбор 3.8): первый экран для телефона и компьютера и блоки ниже — три факта, «Как это
 * работает» со снимками экранов, тёмный раздел «Где ваши деньги», лента работ, «Помощь» и подвал. Сборка — GuestHome.
 */

const t = ru.app.guest.home;

/** Цена в примере тёмного раздела: 200 000 ₸ в тиынах (как на «О сервисе»); остальное считает computeDealMoney. */
const EXAMPLE_PRICE_TIYN = 200_000n * 100n;

const captionOf = (photo: HeroPhoto) => (photo.temporary ? t.photoCaption.temporary : t.photoCaption.work);

/**
 * Первый экран компьютера: фото на всю ширину окна под стеклянной шапкой, затемнение слева и снизу (`scrim-hero`),
 * заголовок 64 px белым, подзаголовок 21 px, белая главная кнопка и ссылка мастера, внизу — капсула доверия на стекле и
 * подпись фото. Высота min(88vh, 860px), при крупном шрифте растёт.
 */
export function DesktopHero({ photo }: { photo: HeroPhoto }) {
  return (
    <section data-bleed data-hero className="bleed hero-fold relative isolate flex flex-col justify-end overflow-hidden bg-photo-fallback">
      <Image src={photo.src} alt={photo.alt} fill preload sizes="100vw" className="object-cover" />
      <div aria-hidden className="scrim-hero" />
      <div className="relative mx-auto flex w-full max-w-content flex-col gap-8 px-6 pt-16 pb-12">
        <div className="flex max-w-hero flex-col gap-5">
          <h1 className="text-balance text-display desktop:text-display-xl text-on-photo">{t.title}</h1>
          <p className="max-w-lead text-lead text-on-photo">{t.lead}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <ButtonLink variant="inverse" href={loginHref("client")}>
            {t.clientAction}
          </ButtonLink>
          <Link
            href={loginHref("executor")}
            className="inline-flex min-h-control items-center gap-1 text-body font-medium text-on-photo no-underline hover:underline"
          >
            {t.executorLink}
            <ChevronRight aria-hidden className="size-4 shrink-0" />
          </Link>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <TrustCapsule>
            {t.trustCapsule} · {t.trustCapsuleMore}
          </TrustCapsule>
          <p className="text-small text-on-photo">{captionOf(photo)}</p>
        </div>
      </div>
    </section>
  );
}

/**
 * Первый экран телефона: название продукта, заголовок 40 px, подзаголовок, фото 4:5 со скруглением 24 и капсулой доверия
 * у верхнего края (на затемнении `scrim-photo-top`: у нижнего её закрыли бы док и панель вкладок на первом экране),
 * подпись фото, ссылка мастера. Главная кнопка — в доке (GuestHome).
 */
export function MobileHero({ photo }: { photo: HeroPhoto }) {
  return (
    <div className="flex flex-col gap-stack-section">
      <header className="flex flex-col gap-3">
        <p className="text-headline text-ink">{ru.common.brand}</p>
        <h1 className="text-balance wrap-break-word text-display text-ink">{t.title}</h1>
        <p className="text-body text-muted">{t.lead}</p>
      </header>
      <figure className="flex flex-col gap-2">
        <div className="photo-frame aspect-4/5 rounded-hero">
          <Image src={photo.src} alt={photo.alt} fill preload sizes="100vw" className="object-cover" />
          <div aria-hidden className="scrim-photo-top" />
          <div className="absolute inset-x-3 top-3 flex">
            <TrustCapsule>{t.trustCapsule}</TrustCapsule>
          </div>
        </div>
        <figcaption className="text-small text-muted">{captionOf(photo)}</figcaption>
      </figure>
      <div>
        <TextLink href={loginHref("executor")}>{t.executorLink}</TextLink>
      </div>
    </div>
  );
}

/** Полоса из трёх фактов: значение 22 px, пояснение 15 px; на компьютере — в ряд, разделены линией сверху. */
export function Facts() {
  return (
    <section aria-label={t.factsLabel}>
      <ul className="grid gap-6 desktop:grid-cols-3 desktop:gap-8">
        {t.facts.map((fact) => (
          <li key={fact.value} className="flex flex-col gap-1 border-t border-line pt-4">
            <p className="text-title-2 text-ink">{fact.value}</p>
            <p className="text-sub text-muted">{fact.note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * «Как это работает»: три шага, у каждого снимок нашего экрана в рамке телефона и номер шага крупно (40 px, muted;
 * для читалки — «Шаг N»). Компьютер — три колонки, рамка сверху; телефон — строка: рамка слева, текст справа.
 */
export function Steps({ device, screens }: { device: Device; screens: LandingImage[] }) {
  return (
    <section aria-labelledby="landing-steps" className="flex flex-col gap-8">
      <h2 id="landing-steps" className="text-title text-ink">
        {t.stepsTitle}
      </h2>
      <ol className="grid gap-10 desktop:grid-cols-3 desktop:gap-8">
        {t.steps.map((step, index) => {
          const shot = screens[index];
          return (
            <li key={step.title} className="flex flex-wrap gap-5 desktop:flex-col desktop:flex-nowrap desktop:gap-6">
              {shot && (
                <PhoneFrame
                  {...shot}
                  sizes={device === "desktop" ? "15rem" : "10rem"}
                  className="w-40 desktop:mx-auto desktop:w-60"
                />
              )}
              {/* Текст не уже 10rem: при крупном шрифте он уходит под рамку, а не за край экрана. */}
              <div className="flex min-w-40 flex-1 flex-col gap-2">
                <p className="text-display text-muted">
                  <span aria-hidden>{index + 1}</span>
                  <span className="sr-only">{t.stepLabel(index + 1)}</span>
                </p>
                <h3 className="text-headline text-ink">{step.title}</h3>
                <p className="text-body text-ink">{step.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const FLOW_ICONS = [UserRound, Landmark, Hammer] as const;

/**
 * «Где ваши деньги» — единственный тёмный раздел, тёмный в обеих темах: роли цветов внутри — тёмной темы
 * (`data-theme="dark"` на разделе), фон `surface` тёмной темы. Слева схема «Вы → банк → мастер» с состояниями и три
 * абзаца с пояснением «Что такое защита сделки?», справа пример суммы крупными цифрами. На всю ширину окна.
 */
export function MoneySection({ device }: { device: Device }) {
  const money = computeDealMoney(EXAMPLE_PRICE_TIYN);
  const Arrow = device === "desktop" ? ArrowRight : ArrowDown;
  return (
    <section data-bleed data-theme="dark" aria-labelledby="landing-money" className="bleed bg-surface text-ink">
      <div className="mx-auto grid w-full max-w-content gap-10 py-14 mobile:safe-gutter desktop:grid-cols-split desktop:gap-16 desktop:px-6 desktop:py-24">
        <div className="flex min-w-0 flex-col gap-8">
          <h2 id="landing-money" className="wrap-break-word text-title text-ink">
            {t.trustTitle}
          </h2>
          <ol aria-label={t.flowLabel} className="flex flex-col gap-2 desktop:flex-row desktop:items-stretch">
            {t.flow.map((node, index) => {
              const Icon = FLOW_ICONS[index] ?? UserRound;
              return (
                <li key={node.label} className="flex flex-col items-start gap-2 desktop:flex-1 desktop:flex-row desktop:items-center">
                  <div className="flex w-full flex-1 items-center gap-4 self-stretch rounded-card bg-fill p-4 desktop:flex-col desktop:items-start desktop:gap-3 desktop:p-5">
                    <Icon aria-hidden className="size-7 shrink-0 text-accent" />
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="text-title-2 text-ink">{node.label}</p>
                      <p className="text-sub text-muted">{node.state}</p>
                    </div>
                  </div>
                  {index < t.flow.length - 1 && <Arrow aria-hidden className="size-5 shrink-0 text-muted mobile:ml-5" />}
                </li>
              );
            })}
          </ol>
          <div className="flex flex-col gap-4">
            {t.trustParagraphs.map((text) => (
              <p key={text} className="text-body text-muted">
                {text}
              </p>
            ))}
            <p className="text-body">
              <Explain label={t.explainLabel} title={t.explainTitle} device={device}>
                <p>{t.explainBody}</p>
              </Explain>
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-6 desktop:justify-center">
          <p className="text-sub text-muted">{t.example.title}</p>
          <div className="flex flex-col gap-1">
            <p className="text-body text-muted">{t.example.price}</p>
            <p className="text-title-2 tabular-nums text-ink desktop:text-amount">
              <Money tiyn={money.priceTiyn} tone="inherit" />
            </p>
          </div>
          <div className="flex flex-col gap-1 border-t border-line pt-6">
            <p className="text-body text-muted">{t.example.pays}</p>
            {/* На телефоне 28 px: сумма не переносится (Money), и при шрифте 200% на 360 px крупнее не помещается. */}
            <p className="text-amount tabular-nums text-ink desktop:text-display-amount">
              <Money tiyn={money.buyerTotalTiyn} tone="inherit" />
            </p>
            <p className="text-sub text-muted">{t.example.note}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** «Работы мастеров»: фото 4:3 с типом мебели под фото; компьютер — сетка 4 × 2, телефон — лента вбок до края экрана. */
export function Works({ device, tiles }: { device: Device; tiles: WorkTile[] }) {
  const catalog = ru.app.guest.catalog;
  return (
    <section aria-labelledby="landing-works" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4">
        <h2 id="landing-works" className="text-title text-ink">
          {catalog.title}
        </h2>
        <TextLink href={to("/catalog")}>{t.worksAll}</TextLink>
      </div>
      <ul
        className={
          device === "desktop"
            ? "grid grid-cols-4 gap-x-5 gap-y-8"
            : "rail-bleed flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
        }
      >
        {tiles.map((tile) => (
          <li key={tile.key} className={device === "desktop" ? "min-w-0" : "w-hero-tile shrink-0 snap-start"}>
            <Link href={tile.href} className="group flex flex-col gap-3 no-underline">
              <div className="photo-frame aspect-4/3 rounded-card">
                <Image
                  src={tile.image.src}
                  alt={tile.image.alt}
                  fill
                  sizes="17rem"
                  className="object-cover"
                />
              </div>
              <p className="text-headline text-ink group-hover:underline">{tile.title}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * «Помощь» на лендинге: три вопроса аккордеоном (`<details>`: открывается с клавиатуры, без JavaScript), в ответе —
 * тексты «О сервисе» и ссылка «Подробнее» на раздел; ниже — связь с поддержкой. Колонка 680 px на компьютере.
 */
export function Help() {
  const about = ru.app.guest.about;
  const items = [
    { question: t.helpMoney, answer: about.money.paragraphs, anchor: ABOUT_ANCHORS.money },
    { question: t.helpPrice, answer: [about.price.buyerTitle, about.price.buyerNote], anchor: ABOUT_ANCHORS.price },
    { question: t.helpRefusal, answer: about.refusal.paragraphs, anchor: ABOUT_ANCHORS.refusal },
  ];
  return (
    <section aria-labelledby="landing-help" className="flex flex-col gap-6 desktop:max-w-help">
      <h2 id="landing-help" className="text-title text-ink">
        {ru.app.kit.help.title}
      </h2>
      <div className="flex flex-col rounded-card bg-surface">
        {items.map((item) => (
          <details key={item.anchor} className="group border-b border-line last:border-b-0">
            <summary className="flex min-h-control cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-headline text-ink [&::-webkit-details-marker]:hidden">
              {item.question}
              <ChevronDown aria-hidden className="size-5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <div className="flex flex-col gap-3 px-5 pb-5">
              {item.answer.map((text) => (
                <p key={text} className="text-body text-muted">
                  {text}
                </p>
              ))}
              <div>
                <TextLink href={`${to("/about")}#${item.anchor}`}>{t.helpMore}</TextLink>
              </div>
            </div>
          </details>
        ))}
      </div>
      <div>
        <a href={`mailto:${encodeURI(brand.support.email)}`} className="inline-flex min-h-control items-center text-body font-medium text-accent no-underline hover:underline">
          {ru.app.kit.help.contact}
        </a>
      </div>
    </section>
  );
}

/** Подвал: название и обещание продукта, разделы. */
export function Footer() {
  const nav = ru.app.shell.nav;
  return (
    <footer className="flex flex-col gap-4 border-t border-line pt-8 desktop:flex-row desktop:items-start desktop:justify-between">
      <div className="flex flex-col gap-1">
        <p className="text-headline text-ink">{ru.common.brand}</p>
        <p className="text-sub text-muted">{ru.common.tagline}</p>
      </div>
      <ul className="flex flex-wrap gap-x-6">
        <li>
          <Link href={to("/catalog")} className="inline-flex min-h-control items-center text-sub text-muted no-underline hover:underline">
            {nav.masters}
          </Link>
        </li>
        <li>
          <Link href={to("/about")} className="inline-flex min-h-control items-center text-sub text-muted no-underline hover:underline">
            {nav.about}
          </Link>
        </li>
      </ul>
    </footer>
  );
}
