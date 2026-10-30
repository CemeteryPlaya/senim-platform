import "server-only";
import type { Segment } from "@/generated/prisma/enums";
import type { CurrentUser } from "./session";

// Публичный API модуля identity. Другие модули импортируют только отсюда.
export {
  SESSION_COOKIE,
  actorOf,
  endSession,
  getCurrentUser,
  requireApprovedExecutor,
  requireUser,
  revokeAllSessions,
  startSession,
  type CurrentUser,
} from "./session";

export type RegistrationDecision = { approve: true; segment: Segment } | { approve: false; reason: string };

/** operator → identity: решение по регистрации исполнителя. Реализацию экспортирует identity-engineer. */
export type ReviewExecutorRegistration = (
  operator: CurrentUser,
  profileId: string,
  decision: RegistrationDecision,
) => Promise<void>;

export const jobHandlers = {} as const;
