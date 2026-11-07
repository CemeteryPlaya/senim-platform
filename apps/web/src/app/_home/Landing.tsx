import { ru } from "@/i18n/ru";
import { ButtonLink, Container } from "@/ui";
import { LOGIN_HREF } from "../_shell/nav";

const t = ru.landing;

// Мастер заявки — marketplace-engineer; гостя он сам отправит на вход и вернёт обратно.
const NEW_REQUEST_HREF = "/requests/new";

/**
 * Фото стартового экрана: декоративные интерьеры (сгенерированы для стартового экрана, не работы исполнителей).
 * Владелец заменяет файлы в public/landing/ с теми же именами — код не меняется (docs/OWNER_TODO.md, п. 13).
 * Правый столбец на широком экране сдвинут вниз — коллаж, а не таблица.
 */
const PHOTOS = [
  { src: "/landing/kitchen.jpg", column: 0 },
  { src: "/landing/living.jpg", column: 0 },
  { src: "/landing/wardrobe.jpg", column: 1 },
  { src: "/landing/hallway.jpg", column: 1 },
] as const;

/**
 * Стартовый экран гостя в духе приложения Upwork (уточнение владельца 02.11): несколько фото мебели, заголовок
 * в две строки, одна главная кнопка и «Войти». Как всё устроено — на отдельной странице /about (ссылка в подвале).
 */
export function Landing() {
  return (
    <section aria-labelledby="start-title" className="pt-4 pb-8 sm:pt-10 lg:pt-14">
      <Container className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2 sm:gap-3 lg:order-last">
          {[0, 1].map((column) => (
            <div key={column} className={column === 1 ? "flex flex-col gap-2 sm:gap-3 lg:pt-10" : "flex flex-col gap-2 sm:gap-3 lg:pb-10"}>
              {PHOTOS.filter((p) => p.column === column).map((photo, i) => (
                // Декоративные фото: смысл экрана несут заголовок и кнопка. Файлы готовы по размеру — оптимизатор не нужен.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={photo.src}
                  src={photo.src}
                  alt=""
                  width={800}
                  height={1000}
                  fetchPriority={column === 0 && i === 0 ? "high" : undefined}
                  className="aspect-[5/4] w-full rounded-card bg-sunken object-cover sm:aspect-square"
                />
              ))}
            </div>
          ))}
        </div>

        <div className="flex min-w-0 flex-col gap-6 lg:gap-8">
          <h1 id="start-title" className="text-2xl font-extrabold text-ink sm:text-3xl lg:text-display">
            {t.title}
          </h1>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-start">
            <ButtonLink href={NEW_REQUEST_HREF} className="sm:min-w-64">
              {t.action}
            </ButtonLink>
            <ButtonLink href={LOGIN_HREF} variant="secondary" className="sm:min-w-64">
              {t.login}
            </ButtonLink>
          </div>
        </div>
      </Container>
    </section>
  );
}
