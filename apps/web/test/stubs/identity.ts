import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type Client } from "@connectrpc/connect";
import { ErrorDetailSchema } from "@/gen/senim/common/v1/error_pb";
import {
  AuthenticateRequestSchema,
  AuthenticateResponseSchema,
  GrantRoleRequestSchema,
  IdentityService,
  GrantRoleResponseSchema,
  RequestOtpRequestSchema,
  RequestOtpResponseSchema,
  ResetDemoResponseSchema,
  Role,
  SeedUsersRequestSchema,
  SeedUsersResponseSchema,
  SessionSchema,
  SignOutEverywhereRequestSchema,
  SignOutEverywhereResponseSchema,
  SignOutRequestSchema,
  SignOutResponseSchema,
  StartDemoSessionRequestSchema,
  StartDemoSessionResponseSchema,
  SwitchRoleRequestSchema,
  SwitchRoleResponseSchema,
  UserSchema,
  VerifyOtpRequestSchema,
  VerifyOtpResponseSchema,
  type Session,
  type User,
} from "@/gen/senim/identity/v1/identity_pb";
import { isIP } from "node:net";
// Прямой импорт файла, а не index.ts: index тянет next/headers, и подделка (она грузится в setup до vi.mock) закрепила бы настоящий модуль.
// eslint-disable-next-line no-restricted-imports
import { TOKEN_SHAPE } from "@/modules/identity/session-cookie";

/**
 * Подделка identity для тестов web: пользователи и сессии в памяти, семантика по контракту
 * (proto/senim/identity/v1/identity.proto). Не повторяет лимиты и сроки настоящего сервиса:
 * их проверяют тесты Go. `id` пользователя — `u-<цифры телефона>`.
 */

/** Тип клиента — тот же, что у `IdentityClient` из modules/identity/remote (импорт оттуда из test/ запрещён границей модулей). */
type IdentityClient = Client<typeof IdentityService>;

/** Код, который подделка принимает как верный одноразовый код. */
export const FAKE_OTP_CODE = "123456";
const MAX_KEY = 128;
const PHONE_RE = /^\+7\d{10}$/;
const STAFF: readonly Role[] = [Role.OPERATOR, Role.MEASURER];

export type FakeUserInit = {
  /** По умолчанию `u-<цифры телефона>`; свой id нужен запасным сессиям (id пользователя старой базы). */
  id?: string;
  phone: string;
  defaultRole?: Role;
  roles?: Role[];
  isDemo?: boolean;
  blocked?: boolean;
};

/** Сессия, которую подделка не создавала сама: её отдаёт запасной разрешитель (см. `setFallbackSessions`). */
export type FallbackSession = { user: FakeUserInit; activeRole: Role };

type StoredSession = { id: string; userId: string; activeRole: Role };

/** ConnectError с `ErrorDetail` — как отвечает настоящий identity. */
export function codedError(code: string, status: Code, params: Record<string, string> = {}): ConnectError {
  return new ConnectError(code, status, undefined, [{ desc: ErrorDetailSchema, value: create(ErrorDetailSchema, { code, params }) }]);
}

const STATUS_BY_CODE: Record<string, Code> = {
  invalid_phone: Code.InvalidArgument,
  otp_too_often: Code.ResourceExhausted,
  otp_expired: Code.FailedPrecondition,
  otp_wrong_code: Code.InvalidArgument,
  user_blocked: Code.PermissionDenied,
  session_invalid: Code.Unauthenticated,
  session_token_invalid: Code.InvalidArgument,
  role_not_granted: Code.PermissionDenied,
  role_forbidden: Code.PermissionDenied,
  demo_disabled: Code.PermissionDenied,
  user_not_found: Code.NotFound,
  invalid_request: Code.InvalidArgument,
};

const idOf = (phone: string) => `u-${phone.replace(/\D/g, "")}`;

export class FakeIdentity {
  readonly client: IdentityClient;
  private users = new Map<string, User>(); // по id
  private blocked = new Set<string>();
  private sessions = new Map<string, StoredSession>(); // по токену
  private otpRequested = new Set<string>();
  private nextFailure: unknown[] = [];
  private fallback: ((token: string) => Promise<FallbackSession | null>) | null = null;
  private counter = 0;
  private replays = new Map<string, { fingerprint: string; response: unknown }>();
  private effectThenFail = false;
  /** Включён ли демо-режим (DEMO_MODE у настоящего сервиса). */
  demoEnabled = true;
  /** Токены, с которыми были вызваны методы, — для проверок в тестах. */
  readonly calls: { method: string; request: unknown }[] = [];

  constructor() {
    this.client = this.build();
  }

  /** Сбросить состояние перед тестом. Запасной разрешитель остаётся: его ставит setup. */
  reset(): void {
    this.users.clear();
    this.blocked.clear();
    this.sessions.clear();
    this.otpRequested.clear();
    this.nextFailure = [];
    this.replays.clear();
    this.effectThenFail = false;
    this.calls.length = 0;
    this.demoEnabled = true;
  }

  /** Как искать сессии, которых подделка не создавала (старая таблица Session до перехода входа на identity). */
  setFallbackSessions(resolver: ((token: string) => Promise<FallbackSession | null>) | null): void {
    this.fallback = resolver;
  }

  /** Следующий вызов (любого метода) бросит эту ошибку; можно поставить несколько — по одной на вызов. */
  failNext(error: unknown): void {
    this.nextFailure.push(error);
  }

  /** Следующий вызов вернёт identity с кодом ошибки контракта. */
  failNextWithCode(code: string, params: Record<string, string> = {}, status?: Code): void {
    this.failNext(codedError(code, status ?? STATUS_BY_CODE[code] ?? Code.FailedPrecondition, params));
  }

  /** Следующий вызов упадёт как при недоступном сервисе. */
  failNextUnavailable(): void {
    this.failNext(new ConnectError("unavailable", Code.Unavailable));
  }

  /** Следующий изменяющий вызов выполнит действие (и запомнит ответ по ключу), а потом бросит Unavailable: «обрыв связи после ответа». */
  failNextAfterEffect(): void {
    this.effectThenFail = true;
  }

  addUser(init: FakeUserInit): User {
    const defaultRole = init.defaultRole ?? Role.CLIENT;
    const user = create(UserSchema, {
      id: init.id ?? idOf(init.phone),
      phone: init.phone,
      defaultRole,
      roles: init.roles ?? [defaultRole],
      isDemo: init.isDemo ?? false,
      createdAt: timestampFromDate(new Date()),
    });
    this.users.set(user.id, user);
    if (init.blocked) this.block(user.id);
    return user;
  }

  block(userId: string): void {
    this.blocked.add(userId);
  }

  /** Создать сессию в обход OTP и вернуть токен — для тестов, которым нужен уже вошедший пользователь. */
  signIn(userId: string, token: string, activeRole?: Role): void {
    const user = this.mustUser(userId);
    this.sessions.set(token, { id: `s-${++this.counter}`, userId, activeRole: activeRole ?? user.defaultRole });
  }

  sessionCount(userId?: string): number {
    return [...this.sessions.values()].filter((s) => userId === undefined || s.userId === userId).length;
  }

  private mustUser(id: string): User {
    const user = this.users.get(id);
    if (!user) throw codedError("user_not_found", Code.NotFound);
    return user;
  }

  private view(user: User): User {
    return create(UserSchema, {
      ...user,
      blockedAt: this.blocked.has(user.id) ? timestampFromDate(new Date()) : undefined,
    });
  }

  private sessionView(s: StoredSession): Session {
    const now = Date.now();
    return create(SessionSchema, {
      id: s.id,
      activeRole: s.activeRole,
      expiresAt: timestampFromDate(new Date(now + 7 * 24 * 3600_000)),
      idleExpiresAt: timestampFromDate(new Date(now + 30 * 60_000)),
    });
  }

  private enter(method: string, request: unknown): void {
    this.calls.push({ method, request });
    const failure = this.nextFailure.shift();
    if (failure !== undefined) throw failure;
  }

  /** Формат токена, который задаёт вызывающий (VerifyOtp, StartDemoSession): неверный вид или уже занятый токен. */
  private checkNewToken(token: string): void {
    if (!TOKEN_SHAPE.test(token) || this.sessions.has(token)) throw codedError("session_token_invalid", Code.InvalidArgument);
  }

  private checkKey(key: string | undefined): string {
    if (!key || key.length > MAX_KEY) throw codedError("invalid_request", Code.InvalidArgument);
    return key;
  }

  /**
   * Изменяющий метод по контракту: ключ идемпотентности обязателен (1..128 символов); повтор с тем же ключом и тем же
   * запросом возвращает прежний ответ без второго эффекта, с другим запросом — idempotency_key_reused.
   */
  private async once<R>(method: string, req: { idempotencyKey?: string }, run: () => Promise<R>): Promise<R> {
    this.enter(method, req);
    const key = this.checkKey(req.idempotencyKey);
    const fingerprint = JSON.stringify({ method, req: { ...req, idempotencyKey: undefined } });
    const seen = this.replays.get(key);
    if (seen) {
      if (seen.fingerprint !== fingerprint) throw codedError("idempotency_key_reused", Code.InvalidArgument);
      return seen.response as R;
    }
    const response = await run();
    this.replays.set(key, { fingerprint, response });
    if (this.effectThenFail) {
      this.effectThenFail = false;
      throw new ConnectError("unavailable", Code.Unavailable);
    }
    return response;
  }

  private checkIp(ip: string): void {
    if (ip !== "" && isIP(ip) === 0) throw codedError("invalid_request", Code.InvalidArgument);
  }

  /** Активная роль по правилу сервиса: выданная роль сессии, иначе роль по умолчанию. */
  private effective(user: User, session: StoredSession): StoredSession {
    return user.roles.includes(session.activeRole) ? session : { ...session, activeRole: user.defaultRole };
  }

  private async sessionOf(token: string): Promise<{ user: User; session: StoredSession }> {
    const found = await this.lookup(token);
    return { user: found.user, session: this.effective(found.user, found.session) };
  }

  private async lookup(token: string): Promise<{ user: User; session: StoredSession }> {
    if (!TOKEN_SHAPE.test(token)) throw codedError("session_invalid", Code.Unauthenticated);
    const session = this.sessions.get(token);
    if (session) {
      if (this.blocked.has(session.userId)) throw codedError("session_invalid", Code.Unauthenticated);
      return { user: this.mustUser(session.userId), session };
    }
    // Запасной путь не запоминает ничего: каждый вызов читает актуальное состояние старой таблицы.
    const found = this.fallback ? await this.fallback(token) : null;
    if (!found || found.user.blocked) throw codedError("session_invalid", Code.Unauthenticated);
    const user = create(UserSchema, {
      id: found.user.id ?? idOf(found.user.phone),
      phone: found.user.phone,
      defaultRole: found.user.defaultRole ?? Role.CLIENT,
      roles: found.user.roles ?? [found.user.defaultRole ?? Role.CLIENT],
      isDemo: found.user.isDemo ?? false,
    });
    return { user, session: { id: `legacy-${token.slice(0, 8)}`, userId: user.id, activeRole: found.activeRole } };
  }

  private build(): IdentityClient {
    const mutating = <Q extends { idempotencyKey?: string }, R>(name: string, fn: (req: Q) => Promise<R>) => (req: Q): Promise<R> => this.once(name, req, () => fn(req));
    const reading = <Q, R>(name: string, fn: (req: Q) => Promise<R>) => async (req: Q): Promise<R> => {
      this.enter(name, req);
      return fn(req);
    };
    const unimplemented = async (): Promise<never> => {
      throw new ConnectError("не реализовано в подделке", Code.Unimplemented);
    };
    return {
      requestOtp: mutating("requestOtp", async (req: MessageInitShape<typeof RequestOtpRequestSchema>) => {
        const phone = req.phone ?? "";
        if (!PHONE_RE.test(phone)) throw codedError("invalid_phone", Code.InvalidArgument);
        this.checkIp(req.clientIp ?? "");
        this.otpRequested.add(phone);
        return create(RequestOtpResponseSchema, { phone, expiresAt: timestampFromDate(new Date(Date.now() + 5 * 60_000)), demoCode: this.demoEnabled ? FAKE_OTP_CODE : "" });
      }),
      verifyOtp: mutating("verifyOtp", async (req: MessageInitShape<typeof VerifyOtpRequestSchema>) => {
        const phone = req.phone ?? "";
        this.checkNewToken(req.sessionToken ?? "");
        this.checkIp(req.clientIp ?? "");
        if (!PHONE_RE.test(phone)) throw codedError("invalid_phone", Code.InvalidArgument);
        if (!this.otpRequested.has(phone)) throw codedError("otp_expired", Code.FailedPrecondition);
        if (req.code !== FAKE_OTP_CODE) throw codedError("otp_wrong_code", Code.InvalidArgument, { left: "4" });
        const existing = this.users.get(idOf(phone));
        if (existing && this.blocked.has(existing.id)) throw codedError("user_blocked", Code.PermissionDenied);
        const user = existing ?? this.addUser({ phone });
        this.otpRequested.delete(phone);
        const session: StoredSession = { id: `s-${++this.counter}`, userId: user.id, activeRole: user.defaultRole };
        this.sessions.set(req.sessionToken ?? "", session);
        return create(VerifyOtpResponseSchema, { user: this.view(user), session: this.sessionView(session), isNew: !existing });
      }),
      authenticate: reading("authenticate", async (req: MessageInitShape<typeof AuthenticateRequestSchema>) => {
        const { user, session } = await this.sessionOf(req.sessionToken ?? "");
        return create(AuthenticateResponseSchema, {
          user: this.view(user),
          session: this.sessionView(session),
          accessToken: `fake-access-${user.id}`,
          accessExpiresAt: timestampFromDate(new Date(Date.now() + 5 * 60_000)),
        });
      }),
      signOut: mutating("signOut", async (req: MessageInitShape<typeof SignOutRequestSchema>) => {
        // Неверный или неизвестный токен — не ошибка: выйти из несуществующей сессии можно.
        this.sessions.delete(req.sessionToken ?? "");
        return create(SignOutResponseSchema);
      }),
      signOutEverywhere: mutating("signOutEverywhere", async (req: MessageInitShape<typeof SignOutEverywhereRequestSchema>) => {
        const { user } = await this.sessionOf(req.sessionToken ?? "");
        for (const [token, s] of this.sessions) if (s.userId === user.id) this.sessions.delete(token);
        return create(SignOutEverywhereResponseSchema);
      }),
      switchRole: mutating("switchRole", async (req: MessageInitShape<typeof SwitchRoleRequestSchema>) => {
        const { user, session } = await this.lookup(req.sessionToken ?? "");
        const role = req.role ?? Role.UNSPECIFIED;
        if (role === Role.UNSPECIFIED) throw codedError("invalid_request", Code.InvalidArgument);
        if (!user.roles.includes(role)) throw codedError("role_not_granted", Code.PermissionDenied);
        session.activeRole = role;
        const updated = create(UserSchema, { ...user, defaultRole: role });
        this.users.set(user.id, updated);
        return create(SwitchRoleResponseSchema, { user: this.view(updated), session: this.sessionView(session) });
      }),
      grantRole: mutating("grantRole", async (req: MessageInitShape<typeof GrantRoleRequestSchema>) => {
        const { user } = await this.sessionOf(req.sessionToken ?? "");
        const role = req.role ?? Role.UNSPECIFIED;
        if (role === Role.UNSPECIFIED) throw codedError("invalid_request", Code.InvalidArgument);
        if (STAFF.includes(role) || user.roles.some((r) => STAFF.includes(r))) throw codedError("role_forbidden", Code.PermissionDenied);
        if (user.roles.includes(role)) return create(GrantRoleResponseSchema, { user: this.view(user), granted: false });
        const updated = create(UserSchema, { ...user, roles: [...user.roles, role] });
        this.users.set(user.id, updated);
        return create(GrantRoleResponseSchema, { user: this.view(updated), granted: true });
      }),
      startDemoSession: mutating("startDemoSession", async (req: MessageInitShape<typeof StartDemoSessionRequestSchema>) => {
        if (!this.demoEnabled) throw codedError("demo_disabled", Code.PermissionDenied);
        this.checkNewToken(req.sessionToken ?? "");
        const user = this.users.get(req.userId ?? "");
        if (!user || !user.isDemo) throw codedError("user_not_found", Code.NotFound);
        const asRole = req.asRole ? req.asRole : user.defaultRole;
        if (!user.roles.includes(asRole)) throw codedError("role_not_granted", Code.PermissionDenied);
        const session: StoredSession = { id: `s-${++this.counter}`, userId: user.id, activeRole: asRole };
        this.sessions.set(req.sessionToken ?? "", session);
        return create(StartDemoSessionResponseSchema, { user: this.view(user), session: this.sessionView(session) });
      }),
      seedUsers: mutating("seedUsers", async (req: MessageInitShape<typeof SeedUsersRequestSchema>) => {
        const seeded: User[] = [];
        for (const u of req.users ?? []) {
          const phone = u.phone ?? "";
          if (!PHONE_RE.test(phone)) throw codedError("invalid_phone", Code.InvalidArgument);
          const defaultRole = u.defaultRole ?? Role.UNSPECIFIED;
          const roles = (u.roles ?? []) as Role[];
          if (defaultRole === Role.UNSPECIFIED || !roles.includes(defaultRole)) throw codedError("invalid_request", Code.InvalidArgument);
          seeded.push(this.addUser({ phone, defaultRole, roles, isDemo: u.isDemo ?? false }));
        }
        return create(SeedUsersResponseSchema, { users: seeded.map((u) => this.view(u)) });
      }),
      resetDemo: mutating("resetDemo", async () => {
        if (!this.demoEnabled) throw codedError("demo_disabled", Code.PermissionDenied);
        for (const user of [...this.users.values()].filter((u) => u.isDemo)) {
          this.users.delete(user.id);
          for (const [token, s] of this.sessions) if (s.userId === user.id) this.sessions.delete(token);
        }
        return create(ResetDemoResponseSchema);
      }),
      getSigningKeys: unimplemented,
    };
  }
}

/** Единственный экземпляр на процесс тестов; `setup-integration.ts` подключает его и сбрасывает перед каждым тестом. */
export const identityFake = new FakeIdentity();
