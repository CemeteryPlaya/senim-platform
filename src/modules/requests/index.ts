import "server-only";

// Публичный API модуля requests: заявки (тендер и прямой запрос), отклики, торг → оферта (путь ТЗ, ADR-009),
// сценарии до договора — выбор, замер, проект, залог, замерщик площадки (ADR-005, только при флаге preContractFlows).
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
export { listMyOffers, type MyOfferItem } from "./my-offers";
export { geocodeAddress, geocodeSchema, type Geocoder, type GeocodePrecision, type GeocodeResult } from "./geocoder";
export { acceptPrice, getNegotiation, proposePrice, withdrawPrice, type NegotiationView } from "./negotiation";
import { JOB_MEASUREMENT_REMINDER, remindMeasurement } from "./measurements";

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
export { onDealCancelled, onDealSigned, requestsPort } from "./deal-hooks";
export { activePreContractFlow, newRequestPath, PRE_CONTRACT_FLOW_KEY, setPreContractFlow, setPreContractFlowSchema } from "./flow-setting";
export { approveProject, requestProjectChanges, submitProject, type ProjectVersion } from "./projects";
export { confirmDeposit, markDepositPaid } from "./deposits";
export {
  assignSiteMeasurer,
  completeSiteMeasurement,
  getSiteMeasurement,
  listAwaitingSiteMeasurer,
  listMySiteMeasurements,
  type SiteMeasurementView,
} from "./site-measurements";
export { allowOfferRetry, listRetryCandidates } from "./retries";
export { getFlowProgress, type FlowProgress } from "./progress";
export { segmentPriceHints, type PriceHint, type SegmentPriceHints } from "./price-hints";
export type { PriceRange } from "./price-range";
export type { PreContractView } from "./pre-contract";
export * from "./flows";
export * from "./pre-contract-schema";
export * from "./schema";
export { MEASUREMENT_TRANSITIONS, OFFER_TRANSITIONS, PROPOSAL_TRANSITIONS, REQUEST_TRANSITIONS } from "./transitions";

export const jobHandlers = { [JOB_MEASUREMENT_REMINDER]: remindMeasurement } as const;
