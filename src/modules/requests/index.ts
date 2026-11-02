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
export { listMyOffers, type MyOfferItem } from "./my-offers";
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
export { activePreContractFlow, PRE_CONTRACT_FLOW_KEY, setPreContractFlow, setPreContractFlowSchema } from "./flow-setting";
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
export type { PreContractView } from "./pre-contract";
export * from "./flows";
export * from "./pre-contract-schema";
export * from "./schema";
export { MEASUREMENT_TRANSITIONS, OFFER_TRANSITIONS, REQUEST_TRANSITIONS } from "./transitions";

export const jobHandlers = { [JOB_MEASUREMENT_REMINDER]: remindMeasurement } as const;
