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

export const jobHandlers = {} as const;
