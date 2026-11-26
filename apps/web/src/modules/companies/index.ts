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
  findAddressableExecutor,
  findLikeablePortfolioItem,
  getCatalogFacets,
  getPortfolioForRequest,
  getPublicExecutorPage,
  listCatalog,
  listExecutorReviews,
  listPublicPortfolio,
  NAME_MASK_SELECT,
  type PortfolioForRequest,
  VISIBLE_EXECUTOR,
} from "./catalog";
export { catalogHref, parseCatalogFilter, PRICE_BUCKETS, type CatalogFilter, type PriceBucket, type SearchParams } from "./catalog-filter";

export {
  INSPIRATION_MAX,
  INSPIRATION_STEP,
  inspirationHref,
  parseInspirationFilter,
  type InspirationFilter,
} from "./inspiration-filter";
export { getInspirationItem, listInspiration, type InspirationDetail, type InspirationTile } from "./inspiration";
export {
  applyPortfolioConsent,
  consentSchema,
  createPortfolioFromDeal,
  featuredSchema,
  fromDealInputSchema,
  getDealPortfolioDraft,
  getDealPortfolioPanel,
  setPortfolioConsent,
  setPortfolioFeatured,
  type DealPortfolioDraft,
  type DealPortfolioPanel,
  type FromDealInput,
} from "./deal-portfolio";

export { executorDisplayOf, executorDisplays, publicExecutorView, publicExecutorViews } from "./anonymity";
export { EXECUTOR_IDENTITY_MODES, type ExecutorDisplay, type ExecutorIdentityMode } from "./display";
export { getExecutorIdentityMode, setExecutorIdentityMode } from "./identity-mode";
export { recalculateRating } from "./rating";
export { MASK, maskContacts, maskIdentity, maskPublicText, type MaskResult } from "./mask";
/** Текст исполнителя, который увидит заказчик: без контактов и без наименования/ФИО (до договора — анонимность). */
export { sanitizePublicText as sanitizeExecutorText } from "./own";
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
  PLACE_MAX,
  portfolioInputSchema,
  removePortfolioPhoto,
  setPortfolioPublished,
  updatePortfolioItem,
  type OwnPortfolioItem,
  type PortfolioInput,
} from "./portfolio";
export {
  CHAT_CLOSE_REASON_MAX,
  CHAT_CLOSE_REASON_MIN,
  CHAT_MAX_ATTACHMENTS,
  CHAT_MAX_LENGTH,
  closeChat,
  chatAttachments,
  chatSideOf,
  getChat,
  listChats,
  reopenChat,
  revokeClientPhone,
  sendMessage,
  shareClientPhone,
  type ChatAttachmentView,
  type ChatListItem,
  type ChatMessageView,
  type ClientPhoneView,
  type ChatView,
} from "./chat";
export type { ChatClosedReason } from "./chat-policy";
export {
  countHighlights,
  HIGHLIGHTS_MAX,
  listHighlightCandidates,
  publicHighlights,
  setHighlights,
  type HighlightCandidate,
  type HighlightCard,
  type HighlightRef,
} from "./highlights";
export { dealContacts, type PartyContacts } from "./contacts";
export { ENDED_DEAL, executorStats, isEndedSigned, type ExecutorStats } from "./deal-stats";
export { placeOf, SHOWCASE_ADDRESS_CHOICES, shownAddressOf, type ShowcaseAddressChoice } from "./showcase-place";
export { EXECUTORS_PAGE_SIZE, listExecutors, type ExecutorListItem } from "./executors-list";
export { CONTACTS, contactStage, type ContactStage } from "./contacts-policy";

export const jobHandlers = {} as const;
