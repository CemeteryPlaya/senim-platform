import "server-only";
import type { Segment } from "@/generated/prisma/enums";
import type { CurrentUser } from "./session";

// Публичный API модуля identity. Другие модули импортируют только отсюда.
export {
  actorOf,
  becomeClient,
  endSession,
  getAccessToken,
  getCurrentUser,
  getShellUser,
  needsSecondFactor,
  requireUser,
  requireIntroduced,
  requireUserPage,
  signOutEverywhere,
  switchRole,
  type CurrentUser,
} from "./session";
export {
  confirmTotpEnrollment,
  requireMfaUser,
  requireRecentMfa,
  startTotpEnrollment,
  verifySecondFactor,
  type TotpEnrollment,
} from "./mfa";
export { identityClientIp } from "./remote";
export { newSessionToken, sessionCookieName, sessionCookieOptions } from "./session-cookie";
export { STAFF_ROLES, SWITCHABLE_ROLES, SWITCH_ROLE_PATH, canGrant, isStaffRole, parseSwitchableRole, roleToSwitch, switchRoleHref, switchTargets } from "./roles";
export { requestOtp, verifyOtp, type OtpRequested, type OtpVerified } from "./otp";
export { listDemoPersonas, loginAsDemoPersona, resetIdentityDemo, seedIdentityUsers, type DemoPersona, type SeedPerson } from "./demo";
export { projectPerson, projectUser } from "./projection";
export { authorize, can, type ActionOn, type Resource } from "./rbac";
export { EXECUTOR_REGISTRATION_PATH, LOGIN_PATH, MFA_PATH, homePathFor, loginHref, mfaHref, safeReturnTo } from "./return-to";
export { formatPhone, parsePhone, type Phone } from "./phone";
export { binIinKindFor, isValidBin, isValidIin, type BinIinKind } from "./kz-id";
export { isValidFullName, normalizeFullName } from "./full-name";
export { hasClientIdentity, recordOwnIdentity, recordPersonIdentity, requirePersonIdentity, type PersonIdentity } from "./person-identity";
export { INTRODUCTION_PATH, introductionHref, needsIntroduction } from "./introduction";
export { INSTAGRAM_MAX, contactsInputSchema, emailField, instagramField, type ContactsInput } from "./instagram";
export { getOwnContacts, updateContacts, type OwnContacts } from "./contacts-profile";
export { ibanField, normalizeIban, parseKzIban, type IbanCheck } from "./iban";
export { getOwnPayout, payoutInputSchema, setPayoutIban, type OwnPayout, type PayoutInput } from "./payout";
/**
 * Открытые ИИН/БИН и IBAN — только сервер (договор, расписка, подпись, выплата): не логировать и не показывать.
 * Действующее лицо revealParties обязательно: на пути пользователя — сам пользователь (его сессия, у оператора — второй
 * фактор в identity); "system" — только системные пути без пользователя (выпуск оферты, mock-подпись, фоновая выплата).
 */
export { revealParties, verifySignerIin, type PartyDetails, type RevealActor, type RevealPurposeName, type SigningSideName } from "./reveal";
export { kycView, type KycState } from "./kyc-policy";
export {
  KYC_MAX_FILES,
  KYC_REASON_MAX,
  KYC_REASON_MIN,
  getOwnKyc,
  kycDecisionSchema,
  kycQueue,
  kycQueueCount,
  kycReviewSchema,
  kycSubmitSchema,
  reviewKyc,
  submitKycDocuments,
  type KycDecision,
  type KycDocument,
  type KycQueueItem,
  type KycReviewInput,
  type KycSubmitInput,
  type OwnKyc,
} from "./kyc";
export { addressFields, refineSigner, signerFields, signerOf } from "./registration-schema";
export {
  executorRegistrationSchema,
  getMyRegistration,
  registerExecutor,
  reviewExecutorRegistration,
  provisionExecutor,
  type ProvisionExecutorInput,
  type ExecutorRegistrationInput,
  type ExecutorSigner,
  type MyRegistration,
} from "./registration";

export type RegistrationDecision = { approve: true; segment: Segment } | { approve: false; reason: string };

/** operator → identity: решение по регистрации исполнителя (реализация — reviewExecutorRegistration). */
export type ReviewExecutorRegistration = (
  operator: CurrentUser,
  profileId: string,
  decision: RegistrationDecision,
) => Promise<void>;

export const jobHandlers = {} as const;
