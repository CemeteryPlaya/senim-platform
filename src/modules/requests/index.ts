import "server-only";

// Публичный API модуля requests: заявки (тендер и прямой запрос), отклики, выбор, замер (ADR-003).
// Каждая функция принимает CurrentUser и сама проверяет права (IDOR: чужое — «не найдено»).
export {
  cancelRequest,
  getClientRequest,
  getDraft,
  listMyRequests,
  publishRequest,
  saveDraftStep,
  type ClientRequest,
  type Draft,
} from "./drafts";
export {
  chooseOffer,
  getIncomingRequest,
  getOfferForClient,
  listIncomingRequests,
  listOffers,
  sendOffer,
  withdrawOffer,
  type IncomingListItem,
  type IncomingRequest,
  type OfferDetail,
  type OfferListItem,
} from "./offers";
export {
  agreeToContract,
  completeMeasurement,
  listAwaitingMeasurement,
  listMyMeasurements,
  measurementNoDeal,
  onContractSigned,
  scheduleMeasurement,
  type MeasurementListItem,
} from "./measurements";
export * from "./schema";
export { MEASUREMENT_TRANSITIONS, OFFER_TRANSITIONS, REQUEST_TRANSITIONS } from "./transitions";

export const jobHandlers = {} as const;
