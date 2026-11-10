import "server-only";
import type { Segment } from "@/generated/prisma/enums";
import type { CurrentUser } from "./session";

// Публичный API модуля identity. Другие модули импортируют только отсюда.
export {
  SESSION_COOKIE,
  actorOf,
  becomeClient,
  endSession,
  getAccessToken,
  getCurrentUser,
  getShellUser,
  requireUser,
  requireIntroduced,
  requireUserPage,
  signOutEverywhere,
  switchRole,
  type CurrentUser,
} from "./session";
export { identityClientIp } from "./remote";
export { newSessionToken, sessionCookieName, sessionCookieOptions } from "./session-cookie";
export { STAFF_ROLES, SWITCHABLE_ROLES, SWITCH_ROLE_PATH, canGrant, isStaffRole, parseSwitchableRole, roleToSwitch, switchRoleHref, switchTargets } from "./roles";
export { requestOtp, verifyOtp, type OtpRequested, type OtpVerified } from "./otp";
export { listDemoPersonas, loginAsDemoPersona, type DemoPersona } from "./demo";
export { authorize, can, type ActionOn, type Resource } from "./rbac";
export { EXECUTOR_REGISTRATION_PATH, LOGIN_PATH, homePathFor, loginHref, safeReturnTo } from "./return-to";
export { formatPhone, parsePhone, type Phone } from "./phone";
export { binIinKindFor, isValidBin, isValidIin, type BinIinKind } from "./kz-id";
export { isValidFullName, normalizeFullName } from "./full-name";
export { hasClientIdentity, limitIdentityAttempts, recordOwnIdentity, recordPersonIdentity, type PersonIdentity } from "./person-identity";
export { INTRODUCTION_PATH, introductionHref, needsIntroduction } from "./introduction";
export { INSTAGRAM_MAX, contactsInputSchema, emailField, instagramField, type ContactsInput } from "./instagram";
export { getOwnContacts, updateContacts, type OwnContacts } from "./contacts-profile";
export { ibanField, normalizeIban, parseKzIban, type IbanCheck } from "./iban";
/** payoutRecipientOf — только серверный путь выплаты (deal-core, payments): IBAN не логировать и не показывать. */
export { getOwnPayout, payoutInputSchema, payoutRecipientOf, setPayoutIban, type OwnPayout, type PayoutInput } from "./payout";
export { KYC_TRANSITIONS, kycTarget, kycView, type KycAction, type KycState } from "./kyc-policy";
export {
  KYC_MAX_FILES,
  KYC_REASON_MAX,
  KYC_REASON_MIN,
  getOwnKyc,
  kycQueue,
  kycReviewSchema,
  kycSubmitSchema,
  reviewKyc,
  submitKycDocuments,
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
  signerColumns,
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
