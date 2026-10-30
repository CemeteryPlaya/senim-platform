import "server-only";

/**
 * Публичный API companies. Контракты (типы и сигнатуры) зафиксированы в фазе A,
 * реализация экспортируется отсюда под теми же именами.
 * Анонимность: заказчику исполнитель доступен только как PublicExecutorView.
 */
export type {
  GetPublicExecutorView,
  PhotoView,
  PortfolioCard,
  PublicExecutorPage,
  PublicExecutorView,
  PublicReview,
  RecalculateRating,
} from "./types";
export {
  CATALOG_PAGE_SIZE,
  getCatalogFacets,
  getPortfolioForRequest,
  getPublicExecutorPage,
  listCatalog,
  listExecutorReviews,
  listPublicPortfolio,
  type PortfolioForRequest,
} from "./catalog";
export { catalogHref, parseCatalogFilter, PRICE_BUCKETS, type CatalogFilter, type PriceBucket, type SearchParams } from "./catalog-filter";

export { publicExecutorView, publicExecutorViews } from "./anonymity";
export { recalculateRating } from "./rating";
export { MASK, maskContacts, maskIdentity, type MaskResult } from "./mask";
export {
  ABOUT_MAX_LENGTH,
  getOwnProfile,
  listFurnitureTypes,
  MEASUREMENT_FEE_MAX,
  MEASUREMENT_FEE_MIN,
  profileInputSchema,
  updateProfile,
  type OwnProfile,
  type ProfileInput,
} from "./profile";
export {
  attachPortfolioPhotos,
  createPortfolioItem,
  deletePortfolioItem,
  getOwnPortfolioItem,
  listOwnPortfolio,
  PORTFOLIO_DESCRIPTION_MAX,
  PORTFOLIO_MAX_PHOTOS,
  PORTFOLIO_TITLE_MAX,
  portfolioInputSchema,
  removePortfolioPhoto,
  setPortfolioPublished,
  updatePortfolioItem,
  type OwnPortfolioItem,
  type PortfolioInput,
} from "./portfolio";
export { CHAT_MAX_ATTACHMENTS, CHAT_MAX_LENGTH, getChat, sendMessage, type ChatMessageView, type ChatView } from "./chat";

export const jobHandlers = {} as const;
