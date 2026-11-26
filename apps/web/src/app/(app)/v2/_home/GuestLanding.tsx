import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, ChevronDown, ChevronRight, Hammer, Landmark, UserRound } from "lucide-react";
import { brand } from "@/config/brand";
import { ru } from "@/i18n/ru";
import { computeDealMoney } from "@/modules/payments";
import { ButtonLink, Money, PhoneFrame, TextLink, TopBarOverPhoto } from "@/kit";
import type { Device } from "@/platform/device";
import { to } from "../../_shell/paths";
import { ABOUT_ANCHORS } from "../about/anchors";
import type { HeroPhoto, LandingImage, WorkTile } from "./landing-media";
import { loginHref } from "./links";

/**
 * Части лендинга гостя (разбор 3.8): первый экран для телефона и компьютера и блоки ниже — «Как это работает» со
 * снимками экранов, тёмный раздел «Где ваши деньги», лента работ, «Помощь» и подвал (только компьютер). Сборка —
 * GuestHome. «Деньги в банке… мастер получит, когда вы примете мебель» говорят заголовок, шаг 3 и «Где ваши деньги» —
 * больше нигде (капсулы на фото и полосы фактов нет: аудит «лишнего», 26.11.2026).
 */

const t = ru.app.guest.home;

/** Цена в примере тёмного раздела: 200 000 ₸ в тиынах (как на «О сервисе»); остальное считает computeDealMoney. */
const EXAMPLE_PRICE_TIYN = 200_000n * 100n;

const captionOf = (photo: HeroPhoto) => (photo.temporary ? t.photoCaption.temporary : t.photoCaption.work);

/**
 * Первый экран компьютера: фото на всю ширину области содержимого (на лендинге она во всю ширину окна — landing.css) под
 * стеклянной шапкой, затемнение слева, сверху и снизу (`scrim-hero`), заголовок 64 px белым, подзаголовок 21 px, белая
 * главная кнопка и ссылка мастера, внизу справа — подпись фото; нижний край фото растворяется в
 * фоне страницы (`hero-fade`, ниже текста). Высота min(88vh, 860px), при крупном шрифте растёт. Кольцо фокуса — двойное.
 */
export function DesktopHero({ photo }: { photo: HeroPhoto }) {
  return (
    <section data-hero className="hero-fold relative isolate flex w-full flex-col justify-end overflow-hidden bg-photo-fallback">
      {/* Шапка над фото: прозрачная с белым текстом вверху, стекло с 1rem прокрутки (landing.css). */}
      <TopBarOverPhoto />
      <Image src={photo.src} alt={photo.alt} fill preload sizes="100vw" className="object-cover" />
      <div aria-hidden className="scrim-hero" />
      <div aria-hidden className="hero-fade" />
      {/* Нижнее поле (7rem) больше полосы растворения (4rem): текст стоит на затемнённом фото, а не на переходе в фон. */}
      <div className="relative mx-auto flex w-full max-w-content flex-col gap-8 px-6 pt-16 pb-28">
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
        <p className="self-end text-small text-on-photo">{captionOf(photo)}</p>
      </div>
    </section>
  );
}

/**
 * Первый экран телефона: название продукта, заголовок (`text-hero-mobile` — 36 px, три строки на 390 px), сразу под ним
 * фото 4:5 со скруглением 24, подпись фото — отдельно, под фото справа, тихим текстом. Подзаголовок и ссылка мастера — под фото: на первом экране фото видно
 * целиком над доком главной кнопки. Главная кнопка — в доке (GuestHome).
 */
export function MobileHero({ photo }: { photo: HeroPhoto }) {
  return (
    <div className="flex flex-col gap-stack-section">
      <header className="flex flex-col gap-3">
        <p className="text-headline text-ink">{ru.common.brand}</p>
        <h1 className="text-balance text-hero-mobile text-ink">{t.title}</h1>
      </header>
      <figure className="flex flex-col gap-2">
        <div className="photo-frame aspect-4/5 rounded-hero">
          <Image src={photo.src} alt={photo.alt} fill preload sizes="100vw" className="object-cover" />
        </div>
        <figcaption className="self-end text-small text-muted">{captionOf(photo)}</figcaption>
      </figure>
      <p className="text-body text-muted">{t.lead}</p>
      <div>
        <TextLink href={loginHref("executor")}>{t.executorLink}</TextLink>
      </div>
    </div>
  );
}

/**
 * «Как это работает»: три шага, у каждого снимок нашего экрана в рамке телефона и номер шага крупно (40 px, muted;
 * для читалки — «Шаг N»), заголовок шага 22 px. Компьютер — три колонки, рамка 19,5rem сверху (снимок читается).
 * Телефон — столбиком (разбор 2, 3.1): номер и заголовок в строку, абзац на всю ширину колонки, ниже снимок шириной
 * 70 % по центру — текст читается строками, а не по два слова, и снимок крупнее. Рамка обрезана снизу (`cropped`):
 * виден верх экрана — главное, без меню и мелких строк.
 */
export function Steps({ device, screens }: { device: Device; screens: LandingImage[] }) {
  return (
    <section aria-labelledby="landing-steps" className="flex flex-col gap-8">
      <h2 id="landing-steps" className="text-title text-ink">
        {t.stepsTitle}
      </h2>
      <ol className="grid gap-14 desktop:grid-cols-3 desktop:gap-8">
        {t.steps.map((step, index) => {
          const shot = screens[index];
          return (
            <li key={step.title} className="flex flex-col gap-6">
              {shot && device === "desktop" && <PhoneFrame {...shot} sizes="20rem" className="mx-auto w-78" cropped />}
              <div className="flex min-w-0 flex-col gap-2 desktop:gap-3">
                <div className="flex flex-wrap items-baseline gap-x-3 desktop:flex-col desktop:gap-3">
                  <p className="text-display text-muted">
                    <span aria-hidden>{index + 1}</span>
                    <span className="sr-only">{t.stepLabel(index + 1)}</span>
                  </p>
                  <h3 className="min-w-0 text-title-2 text-ink">{step.title}</h3>
                </div>
                <p className="text-body text-ink">{step.text}</p>
              </div>
              {shot && device === "mobile" && <PhoneFrame {...shot} sizes="70vw" className="mx-auto w-7/10" cropped />}
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
 * (`data-theme="dark"` на разделе), фон `surface` тёмной темы. Слева схема «Вы → банк → мастер» с состояниями и два
 * абзаца (счета сервиса, спор), справа пример: цена мастера и одна крупная сумма «Вы платите» со словами «Без доплат». От края до края: на компьютере —
 * во всю ширину области содержимого лендинга (`w-full`), на телефоне — за поля колонки (`rail-bleed`, внутри — те же
 * поля) без `w-full`: ширину по отрицательным полям даёт растяжение в колонке, а `width: 100%` оставил бы раздел шириной
 * колонки, сдвинутым влево (разбор 2, 3.1). Метка `data-landing-money` — для дока над тёмным разделом (landing.css).
 */
export function MoneySection({ device }: { device: Device }) {
  const money = computeDealMoney(EXAMPLE_PRICE_TIYN);
  const Arrow = device === "desktop" ? ArrowRight : ArrowDown;
  return (
    <section
      data-theme="dark"
      data-landing-money
      aria-labelledby="landing-money"
      className="bg-surface text-ink desktop:w-full mobile:rail-bleed"
    >
      <div className="mx-auto grid w-full max-w-content gap-10 py-14 desktop:grid-cols-split desktop:gap-16 desktop:px-6 desktop:py-24">
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
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-6 desktop:justify-center">
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
 * «Помощь» на лендинге: два вопроса аккордеоном (`<details>`: открывается с клавиатуры, без JavaScript), в ответе —
 * тексты «О сервисе»; у вопроса о цене — ссылка «Подробнее» на раздел (там пример для обеих сторон), ответ о споре — тот
 * же текст, что на «О сервисе», ссылки нет. Последняя строка карточки — связь с поддержкой. Колонка 680 px на компьютере.
 * О деньгах вопроса нет: на него отвечает раздел «Где ваши деньги» выше.
 */
export function Help() {
  const about = ru.app.guest.about;
  const items = [
    { question: t.helpPrice, answer: [about.price.buyerTitle, about.price.buyerNote], anchor: ABOUT_ANCHORS.price, more: true },
    { question: t.helpRefusal, answer: about.refusal.paragraphs, anchor: ABOUT_ANCHORS.refusal, more: false },
  ];
  return (
    <section aria-labelledby="landing-help" className="flex flex-col gap-6 desktop:max-w-help">
      <h2 id="landing-help" className="text-title text-ink">
        {ru.app.kit.help.title}
      </h2>
      <div className="flex flex-col rounded-card bg-surface">
        {items.map((item) => (
          <details key={item.anchor} className="group border-b border-line">
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
              {item.more && (
                <div>
                  <TextLink href={`${to("/about")}#${item.anchor}`}>{t.helpMore}</TextLink>
                </div>
              )}
            </div>
          </details>
        ))}
        <a
          href={`mailto:${encodeURI(brand.support.email)}`}
          className="flex min-h-control items-center px-5 py-4 text-body font-medium text-accent no-underline hover:underline"
        >
          {ru.app.kit.help.contact}
        </a>
      </div>
    </section>
  );
}

/**
 * Подвал компьютера: название продукта и разделы. На телефоне подвала нет — разделы есть в панели вкладок (вернуть,
 * когда появятся юридические ссылки).
 */
export function Footer() {
  const nav = ru.app.shell.nav;
  return (
    <footer className="flex flex-row items-start justify-between gap-4 border-t border-line pt-8">
      <p className="text-headline text-ink">{ru.common.brand}</p>
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
