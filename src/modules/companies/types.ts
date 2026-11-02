import type { MeasurementTerms, Segment } from "@/generated/prisma/enums";
import type { Tx } from "@/platform/db";

/**
 * Контракты companies (зафиксированы в фазе A) и типы публичных представлений.
 * Анонимность: заказчику исполнитель доступен только как PublicExecutorView — без телефона и ИИН/БИН;
 * наименование и улица — только в режиме «имя показано» (ответ №6, ADR-006).
 */
export type PublicExecutorView = {
  id: string; // ExecutorProfile.id — для ссылок и форм; личность не раскрывает
  publicNumber: number;
  label: string; // «Исполнитель №17» или наименование (режим «имя показано»)
  labelGen: string; // «Исполнителя №17»
  labelDat: string; // «Исполнителю №17»
  address: string; // город и район; в режиме «имя показано» — с улицей и домом
  nameShown: boolean;
  segment: Segment | null;
  ratingAvg: number;
  reviewsCount: number;
  completedDeals: number;
  yearsExperience: number;
  measurementTerms: MeasurementTerms;
  measurementFee: number | null;
  specializations: { slug: string; name: string }[];
};

/** Публичное представление исполнителя без телефона и ИИН/БИН; наименование — по режиму №6. */
export type GetPublicExecutorView = (executorId: string) => Promise<PublicExecutorView>;

/** deal-core → companies: пересчитать рейтинг после отзыва (в той же транзакции). */
export type RecalculateRating = (tx: Tx, executorId: string) => Promise<void>;

/** Фото для карточки: src готов для <img>; null — файл ещё нельзя показать (заглушка). */
export type PhotoView = { id: string; src: string | null; alt: string };

/** Карточка работы в каталоге и на публичной странице. */
export type PortfolioCard = {
  id: string;
  title: string;
  description: string;
  furnitureType: { slug: string; name: string };
  style: { key: string; name: string };
  priceFrom: number | null;
  /** Где делали: город, район или ЖК; пустая строка — не указано. */
  place: string;
  /** «Подборка Сенім» во «Вдохновении». */
  featured: boolean;
  /** Работа из завершённой сделки на площадке — пометка «Выполнено на Сенім». */
  doneOnPlatform: boolean;
  /** Отзыв заказчика по этой сделке (якорь на странице исполнителя). */
  reviewId: string | null;
  photos: PhotoView[];
  executor: Pick<PublicExecutorView, "id" | "publicNumber" | "label" | "segment" | "ratingAvg" | "reviewsCount">;
};

export type PublicReview = { id: string; rating: number; text: string; createdAt: Date };

/** Публичная страница исполнителя /executors/[publicNumber]. */
export type PublicExecutorPage = {
  view: PublicExecutorView;
  about: string;
  portfolio: PortfolioCard[];
  reviews: PublicReview[];
};
