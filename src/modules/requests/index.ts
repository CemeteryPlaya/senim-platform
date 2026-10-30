import "server-only";

// Публичный API модуля requests: заявки (тендер и прямой запрос), отклики, выбор, замер (ADR-003).
// Каждая функция принимает CurrentUser и сама проверяет права (IDOR: чужое — «не найдено»).
export {
  cancelRequest,
  getClientRequest,
  getDraft,
  likeTarget,
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
import { JOB_MEASUREMENT_REMINDER, remindMeasurement } from "./measurements";

export {
  agreeToContract,
  completeMeasurement,
  listAwaitingMeasurement,
  listMyMeasurements,
  measurementNoDeal,
  onContractSigned,
  onDealDocumentSigned,
  scheduleMeasurement,
  type MeasurementListItem,
} from "./measurements";
export { onDealCancelled } from "./deal-cancelled";
export * from "./schema";
export { MEASUREMENT_TRANSITIONS, OFFER_TRANSITIONS, REQUEST_TRANSITIONS } from "./transitions";

export const jobHandlers = { [JOB_MEASUREMENT_REMINDER]: remindMeasurement } as const;
