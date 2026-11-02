import "server-only";
import type { Segment } from "@/generated/prisma/enums";
import type { CurrentUser } from "./session";

// Публичный API модуля identity. Другие модули импортируют только отсюда.
export {
  SESSION_COOKIE,
  actorOf,
  becomeClient,
  endSession,
  getCurrentUser,
  requireUser,
  requireUserPage,
  revokeAllSessions,
  signOutEverywhere,
  startSession,
  switchRole,
  type CurrentUser,
} from "./session";
export { SWITCHABLE_ROLES, SWITCH_ROLE_PATH, canGrant, parseSwitchableRole, roleToSwitch, switchRoleHref, switchTargets } from "./roles";
export { OTP_MAX_ATTEMPTS, OTP_TTL_MIN, requestOtp, verifyOtp, type OtpRequested, type OtpVerified } from "./otp";
export { listDemoPersonas, loginAsDemoPersona, type DemoPersona } from "./demo";
export { authorize, can, type ActionOn, type Resource } from "./rbac";
export { EXECUTOR_REGISTRATION_PATH, LOGIN_PATH, homePathFor, loginHref, safeReturnTo } from "./return-to";
export { formatPhone, parsePhone, type Phone } from "./phone";
export { binIinKindFor, isValidBin, isValidIin, type BinIinKind } from "./kz-id";
export { isValidFullName, normalizeFullName } from "./full-name";
export { hasClientIdentity, limitIdentityAttempts, recordPersonIdentity, type PersonIdentity } from "./person-identity";
export { refineSigner, signerFields, signerOf } from "./registration-schema";
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
