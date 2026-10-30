import { fail } from "@/platform/errors";
import type { CurrentUser } from "./session";

/**
 * Типовые проверки прав. Ресурс описывается минимумом полей, по которым решается доступ,
 * — сервис модуля читает их из БД и спрашивает `can`/`authorize`. Специальные правила
 * (видимость тендера по сегменту, шаги статусной машины) остаются в своих модулях.
 */
export type Resource =
  | { kind: "request"; clientId: string }
  /** executorId — ExecutorProfile.id */
  | { kind: "deal"; clientId: string; executorId: string }
  | { kind: "executorProfile"; id: string }
  | { kind: "platform" };

type Rule<R> = (user: CurrentUser, resource: R) => boolean;
type ResourceOf<K extends Resource["kind"]> = Extract<Resource, { kind: K }>;

const isOperator = (u: CurrentUser) => u.role === "OPERATOR";
const isOwnerClient = (u: CurrentUser, clientId: string) => u.role === "CLIENT" && u.id === clientId;
const isExecutor = (u: CurrentUser, profileId: string) => u.role === "EXECUTOR" && u.executor?.id === profileId;
const isApprovedExecutor = (u: CurrentUser, profileId: string) => isExecutor(u, profileId) && u.executor?.status === "APPROVED";

/** Таблица прав: ресурс → действие → правило. Набор действий для каждого ресурса проверяет компилятор. */
const POLICY = {
  request: {
    view: (u, r) => isOperator(u) || isOwnerClient(u, r.clientId),
    manage: (u, r) => isOwnerClient(u, r.clientId),
  },
  deal: {
    view: (u, r) => isOperator(u) || isOwnerClient(u, r.clientId) || isExecutor(u, r.executorId),
    act: (u, r) => isOwnerClient(u, r.clientId) || isApprovedExecutor(u, r.executorId),
    resolveDispute: (u) => isOperator(u),
  },
  executorProfile: {
    view: (u, r) => isOperator(u) || isExecutor(u, r.id),
    edit: (u, r) => isExecutor(u, r.id),
    moderate: (u) => isOperator(u),
  },
  platform: {
    administer: (u) => isOperator(u),
  },
} satisfies { [K in Resource["kind"]]: Record<string, Rule<ResourceOf<K>>> };

type Policy = typeof POLICY;
export type ActionOn<K extends Resource["kind"]> = keyof Policy[K] & string;

export function can<R extends Resource>(user: CurrentUser, action: ActionOn<R["kind"]>, resource: R): boolean {
  const rules = POLICY[resource.kind] as Record<string, Rule<R>>;
  return rules[action](user, resource);
}

/** То же, что `can`, но бросает FORBIDDEN — для сервисов. */
export function authorize<R extends Resource>(user: CurrentUser, action: ActionOn<R["kind"]>, resource: R): void {
  if (!can(user, action, resource)) fail.forbidden();
}
