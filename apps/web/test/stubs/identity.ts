import { clone, create, toBinary, type DescMessage, type MessageInitShape } from "@bufbuild/protobuf";
import { TimestampSchema, timestampFromDate } from "@bufbuild/protobuf/wkt";
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
  ResetDemoRequestSchema,
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
  /** По умолчанию `u-<цифры телефона>`; свой id нужен пользователям, которых тест создал в старой базе. */
  id?: string;
  phone: string;
  defaultRole?: Role;
  roles?: Role[];
  isDemo?: boolean;
  blocked?: boolean;
};

type StoredSession = { id: string; userId: string; activeRole: Role };

/** ConnectError с `ErrorDetail` — как отвечает настоящий identity. */
export function codedError(code: string, status: Code, params: Record<string, string> = {}): ConnectError {
  return new ConnectError(code, status, undefined, [{ desc: ErrorDetailSchema, value: create(ErrorDetailSchema, { code, params }) }]);
}

const STATUS_BY_CODE: Record<string, Code> = {
  invalid_phone: Code.InvalidArgument,
  otp_too_often: Code.ResourceExhausted,
  otp_expired: Code.InvalidArgument,
  otp_wrong_code: Code.InvalidArgument,
  user_blocked: Code.PermissionDenied,
  session_invalid: Code.Unauthenticated,
  session_token_invalid: Code.InvalidArgument,
  role_not_granted: Code.PermissionDenied,
  role_forbidden: Code.PermissionDenied,
  demo_disabled: Code.FailedPrecondition,
  user_not_found: Code.NotFound,
  invalid_request: Code.InvalidArgument,
};

/** Как parsePhone в Go: «8 700 …», «+7 700 …», «700 …» -> +7700…; не телефон остаётся как есть и не пройдёт PHONE_RE. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && (digits[0] === "7" || digits[0] === "8") ? digits.slice(1) : digits;
  return /^[\d\s()+-]+$/.test(raw.trim()) && national.length === 10 ? `+7${national}` : raw;
}

const idOf = (phone: string) => `u-${phone.replace(/\D/g, "")}`;

export class FakeIdentity {
  readonly client: IdentityClient;
  private users = new Map<string, User>(); // по id
  private blocked = new Set<string>();
  private sessions = new Map<string, StoredSession>(); // по токену
  /** Номера с действующим кодом: не больше одного кода на номер, как RetireOtpCodes в Go (новый запрос заменяет прежний, вход гасит). */
  private otpRequested = new Set<string>();
  private nextFailure: unknown[] = [];
  private counter = 0;
  private replays = new Map<string, { fingerprint: string; response: unknown }>(); // ключ: (метод, ключ идемпотентности), как PRIMARY KEY (method, key) в pkg/idem
  private effectThenFail = false;
  /** Включён ли демо-режим (DEMO_MODE у настоящего сервиса). */
  demoEnabled = true;
  /** Токены, с которыми были вызваны методы, — для проверок в тестах. */
  readonly calls: { method: string; request: unknown }[] = [];

  constructor() {
    this.client = this.build();
  }

  /** Сбросить состояние перед тестом. */
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

  hasUser(id: string): boolean {
    return this.users.has(id);
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

  /** Формат токена, который задаёт вызывающий (VerifyOtp, StartDemoSession). */
  private checkTokenShape(token: string): void {
    if (!TOKEN_SHAPE.test(token)) throw codedError("session_token_invalid", Code.InvalidArgument);
  }

  /** Токен уже у другой сессии (новый ключ, старый токен). */
  private checkTokenFree(token: string): void {
    if (this.sessions.has(token)) throw codedError("session_token_invalid", Code.InvalidArgument);
  }

  private checkKey(key: string | undefined): void {
    if (!key || key.length > MAX_KEY) throw codedError("invalid_request", Code.InvalidArgument);
  }

  /** Демо-методы: сначала режим (в Go — после проверки вызывающего), потом остальные проверки. */
  private demoGate(): void {
    if (!this.demoEnabled) throw codedError("demo_disabled", Code.FailedPrecondition);
  }

  /**
   * Изменяющий метод по контракту. Порядок как в Go: проверки запроса (`pre`, по умолчанию только ключ 1..128 символов),
   * затем поиск сохранённого ответа по (метод, ключ): тот же запрос — прежний ответ без второго эффекта, другой запрос —
   * idempotency_key_reused (отпечаток — детерминированный protobuf без самого ключа), затем действие.
   */
  private async once<S extends DescMessage, R>(method: string, schema: S, req: MessageInitShape<S>, run: () => Promise<R>, pre?: () => void): Promise<R> {
    this.enter(method, req);
    const msg = create(schema, req);
    const key = "idempotencyKey" in msg && typeof msg.idempotencyKey === "string" ? msg.idempotencyKey : "";
    if (pre) pre();
    else this.checkKey(key);
    const copy = clone(schema, msg);
    if ("idempotencyKey" in copy) copy.idempotencyKey = "";
    const fingerprint = Buffer.from(toBinary(schema, copy)).toString("base64");
    const slot = `${method}/${key}`;
    const seen = this.replays.get(slot);
    if (seen) {
      if (seen.fingerprint !== fingerprint) throw codedError("idempotency_key_reused", Code.InvalidArgument);
      return seen.response as R;
    }
    const response = await run();
    this.replays.set(slot, { fingerprint, response });
    if (this.effectThenFail) {
      this.effectThenFail = false;
      throw new ConnectError("unavailable", Code.Unavailable);
    }
    return response;
  }

  /** validateSeed из demo.go: непустой список ≤ 200, телефоны верны и не повторяются, роли известны, роль по умолчанию выдана, сотрудник один в своей роли. */
  private validateSeed(users: { phone?: string; defaultRole?: Role; roles?: Role[] }[]): void {
    if (users.length === 0 || users.length > 200) throw codedError("invalid_request", Code.InvalidArgument);
    const seen = new Set<string>();
    for (const u of users) {
      const phone = normalizePhone(u.phone ?? "");
      if (!PHONE_RE.test(phone)) throw codedError("invalid_phone", Code.InvalidArgument);
      if (seen.has(phone)) throw codedError("invalid_request", Code.InvalidArgument);
      seen.add(phone);
      const roles = [...new Set(u.roles ?? [])];
      if (roles.some((r) => r === Role.UNSPECIFIED || !(r in Role))) throw codedError("invalid_request", Code.InvalidArgument);
      const def = u.defaultRole ?? Role.UNSPECIFIED;
      if (def === Role.UNSPECIFIED || !roles.includes(def)) throw codedError("invalid_request", Code.InvalidArgument);
      if (roles.some((r) => STAFF.includes(r)) && roles.length !== 1) throw codedError("invalid_request", Code.InvalidArgument);
    }
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
    throw codedError("session_invalid", Code.Unauthenticated);
  }

  private build(): IdentityClient {
    const mutating =
      <S extends DescMessage, R>(name: string, schema: S, fn: (req: MessageInitShape<S>) => Promise<R>, pre?: (req: MessageInitShape<S>) => void) =>
      (req: MessageInitShape<S>): Promise<R> =>
        this.once(name, schema, req, () => fn(req), pre && (() => pre(req)));
    const reading = <Q, R>(name: string, fn: (req: Q) => Promise<R>) => async (req: Q): Promise<R> => {
      this.enter(name, req);
      return fn(req);
    };
    const unimplemented = async (): Promise<never> => {
      throw new ConnectError("не реализовано в подделке", Code.Unimplemented);
    };
    return {
      requestOtp: mutating(
        "requestOtp",
        RequestOtpRequestSchema,
        async (req) => {
          const phone = req.phone ?? "";
          this.otpRequested.add(phone);
          return create(RequestOtpResponseSchema, { phone, expiresAt: timestampFromDate(new Date(Date.now() + 5 * 60_000)), demoCode: this.demoEnabled ? FAKE_OTP_CODE : "" });
        },
        (req) => {
          this.checkKey(req.idempotencyKey);
          if (!PHONE_RE.test(req.phone ?? "")) throw codedError("invalid_phone", Code.InvalidArgument);
          this.checkIp(req.clientIp ?? "");
        },
      ),
      verifyOtp: mutating(
        "verifyOtp",
        VerifyOtpRequestSchema,
        async (req) => {
          const phone = req.phone ?? "";
          this.checkTokenFree(req.sessionToken ?? "");
          if (!this.otpRequested.has(phone)) throw codedError("otp_expired", Code.InvalidArgument);
          if (req.code !== FAKE_OTP_CODE) throw codedError("otp_wrong_code", Code.InvalidArgument, { left: "4" });
          const existing = [...this.users.values()].find((u) => u.phone === phone); // как в Go: пользователь ищется по телефону
          if (existing && this.blocked.has(existing.id)) throw codedError("user_blocked", Code.PermissionDenied);
          const user = existing ?? this.addUser({ phone });
          this.otpRequested.delete(phone);
          const session: StoredSession = { id: `s-${++this.counter}`, userId: user.id, activeRole: user.defaultRole };
          this.sessions.set(req.sessionToken ?? "", session);
          return create(VerifyOtpResponseSchema, { user: this.view(user), session: this.sessionView(session), isNew: !existing });
        },
        (req) => {
          // Порядок Go (verify.go): формат токена, ключ, IP, телефон; дальше поиск ответа по ключу, занятый токен, код.
          this.checkTokenShape(req.sessionToken ?? "");
          this.checkKey(req.idempotencyKey);
          this.checkIp(req.clientIp ?? "");
          if (!PHONE_RE.test(req.phone ?? "")) throw codedError("invalid_phone", Code.InvalidArgument);
        },
      ),
      authenticate: reading("authenticate", async (req: MessageInitShape<typeof AuthenticateRequestSchema>) => {
        const { user, session } = await this.sessionOf(req.sessionToken ?? "");
        return create(AuthenticateResponseSchema, {
          user: this.view(user),
          session: this.sessionView(session),
          accessToken: `fake-access-${user.id}`,
          accessExpiresAt: timestampFromDate(new Date(Date.now() + 5 * 60_000)),
        });
      }),
      signOut: mutating("signOut", SignOutRequestSchema, async (req) => {
        // Неверный или неизвестный токен — не ошибка: выйти из несуществующей сессии можно.
        this.sessions.delete(req.sessionToken ?? "");
        return create(SignOutResponseSchema);
      }),
      signOutEverywhere: mutating("signOutEverywhere", SignOutEverywhereRequestSchema, async (req) => {
        // Токен, по которому нельзя доказать вход (кривой, неизвестный, отозванный, истёкший, заблокированный), — успех без изменений.
        const found = await this.lookup(req.sessionToken ?? "").catch(() => null);
        if (found) for (const [token, s] of this.sessions) if (s.userId === found.user.id) this.sessions.delete(token);
        return create(SignOutEverywhereResponseSchema);
      }),
      switchRole: mutating("switchRole", SwitchRoleRequestSchema, async (req) => {
        const { user, session } = await this.lookup(req.sessionToken ?? "");
        const role = req.role ?? Role.UNSPECIFIED;
        if (role === Role.UNSPECIFIED) throw codedError("invalid_request", Code.InvalidArgument);
        if (!user.roles.includes(role)) throw codedError("role_not_granted", Code.PermissionDenied);
        session.activeRole = role;
        const updated = create(UserSchema, { ...user, defaultRole: role });
        this.users.set(user.id, updated);
        return create(SwitchRoleResponseSchema, { user: this.view(updated), session: this.sessionView(session) });
      }),
      grantRole: mutating("grantRole", GrantRoleRequestSchema, async (req) => {
        const { user } = await this.sessionOf(req.sessionToken ?? "");
        const role = req.role ?? Role.UNSPECIFIED;
        if (role === Role.UNSPECIFIED) throw codedError("invalid_request", Code.InvalidArgument);
        if (STAFF.includes(role) || user.roles.some((r) => STAFF.includes(r))) throw codedError("role_forbidden", Code.PermissionDenied);
        if (user.roles.includes(role)) return create(GrantRoleResponseSchema, { user: this.view(user), granted: false });
        const updated = create(UserSchema, { ...user, roles: [...user.roles, role] });
        this.users.set(user.id, updated);
        return create(GrantRoleResponseSchema, { user: this.view(updated), granted: true });
      }),
      startDemoSession: mutating(
        "startDemoSession",
        StartDemoSessionRequestSchema,
        async (req) => {
          // Нет пользователя, он не демо или заблокирован — один отказ: метод не показывает, кто есть.
          const user = this.users.get(req.userId ?? "");
          if (!user || !user.isDemo || this.blocked.has(user.id)) throw codedError("user_not_found", Code.NotFound);
          const asRole = req.asRole ? req.asRole : user.defaultRole;
          if (!user.roles.includes(asRole)) throw codedError("role_not_granted", Code.PermissionDenied);
          this.checkTokenFree(req.sessionToken ?? "");
          const session: StoredSession = { id: `s-${++this.counter}`, userId: user.id, activeRole: asRole };
          this.sessions.set(req.sessionToken ?? "", session);
          return create(StartDemoSessionResponseSchema, { user: this.view(user), session: this.sessionView(session) });
        },
        (req) => {
          // Порядок Go (demo.go): режим, формат токена, ключ, роль.
          this.demoGate();
          this.checkTokenShape(req.sessionToken ?? "");
          this.checkKey(req.idempotencyKey);
          if (req.asRole !== undefined && req.asRole !== Role.UNSPECIFIED && !(req.asRole in Role)) throw codedError("invalid_request", Code.InvalidArgument);
        },
      ),
      seedUsers: mutating(
        "seedUsers",
        SeedUsersRequestSchema,
        async (req) => {
          // Как UpsertSeedUser в Go: по телефону; у существующего id прежний, роли, демо-флаг и created_at (если задан) — из запроса, блокировка снимается.
          const seeded: User[] = [];
          for (const u of req.users ?? []) {
            const phone = normalizePhone(u.phone ?? "");
            const existing = [...this.users.values()].find((x) => x.phone === phone);
            const user = this.addUser({ id: existing?.id, phone, defaultRole: u.defaultRole, roles: [...new Set((u.roles ?? []) as Role[])], isDemo: u.isDemo ?? false });
            const createdAt = u.createdAt ? create(TimestampSchema, u.createdAt) : existing?.createdAt;
            if (createdAt) user.createdAt = createdAt;
            this.blocked.delete(user.id);
            seeded.push(user);
          }
          return create(SeedUsersResponseSchema, { users: seeded.map((u) => this.view(u)) });
        },
        (req) => {
          this.demoGate();
          this.checkKey(req.idempotencyKey);
          this.validateSeed(req.users ?? []);
        },
      ),
      resetDemo: mutating(
        "resetDemo",
        ResetDemoRequestSchema,
        async () => {
          // Пользователи остаются; сессии, коды и сохранённые ответы стираются (свой ответ once() запишет после очистки).
          this.sessions.clear();
          this.otpRequested.clear();
          this.replays.clear();
          return create(ResetDemoResponseSchema);
        },
        (req) => {
          this.demoGate();
          this.checkKey(req.idempotencyKey);
        },
      ),
      getSigningKeys: unimplemented,
    };
  }
}

/** Единственный экземпляр на процесс тестов; `setup-integration.ts` подключает его и сбрасывает перед каждым тестом. */
export const identityFake = new FakeIdentity();
