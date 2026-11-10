# «Сенім» v2 — план 2б: ПДн, KYC, согласия и 2FA операторов в `identity`. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `identity` владеет персональными данными (ФИО, ИИН, контакты, реквизиты исполнителя, IBAN — под envelope-шифрованием с `kid`), KYC исполнителя, согласиями на ПДн и второй ступенью входа операторов (TOTP с повторным вводом для денежных действий). `web` больше не шифрует и не хранит ИИН/БИН/IBAN сам: пишет через gRPC, читает открытые значения только через `RevealPartyDetails` с событием аудита чтения. Все сценарии e2e проходят против стенда v2.

**Architecture:** Как в плане 2: `web` (BFF) зовёт `IdentityService` через mesh; `identity` проверяет вызывающего, роль и сессию, пишет изменение и событие аудита в одной транзакции, изменяющие методы идемпотентны. Шифрование — новый пакет `pkg/pii`: ключ данных на каждое значение под ключом шифрования ключей (`kid`), AAD привязывает шифртекст к таблице, полю и `user_id`; поиск и уникальность — HMAC с отдельным ключом. Старая база `web` остаётся проекцией: `User.fullName`, `iinLast4`, `instagram`, `email` и поля `ExecutorProfile` (форма, название, последние 4 символа, KYC) `web` пишет из ответов `identity`, поэтому экраны, показывающие последние 4 символа, не меняются. 2FA: `sessions.mfa_verified_at`; внутренний токен получает `mfa=true` и `mfa_at`; `pkg/authz.RequireRecentMFA` — для `deal` в плане 3, а пока денежные действия живут в `web`, повторную 2FA проверяет `web`.

**Tech Stack:** Go (toolchain из `go.mod`), connect-go v2, pgx v5 + sqlc + goose, testcontainers-go, `pgregory.net/rapid`; TOTP — RFC 6238 на стандартной библиотеке (HMAC-SHA1, 30 с, 6 цифр); `@connectrpc/connect`, `qrcode` (уже в `apps/web`), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-platform-v2-architecture-design.md` — §4.1 (identity), §4.4 (2FA и повторная 2FA), §5 (ПДн, envelope, HMAC, согласия), §7 (`pkg/pii`), §8 (2FA, журнал чтения ПДн). Правовая основа: `docs/legal/2026-11-07-legal-research.md` — A.2 (согласие, отзыв 15 рабочих дней), A.7 (P2, P3, P4, P6, P7, P14), A.8 (структура текста). Образец и решения: план 2 `docs/superpowers/plans/2026-11-10-platform-v2-02-identity.md`, ADR-013, `docs/PROGRESS.md` («План 2», «Следующая миграция identity (план 2б)»).

### Объём и решения (решения контроллера, можно оспорить)

- **2FA — только TOTP**; WebAuthn позже, за флагом. Причина: TOTP закрывает §4.4 без браузерных API и ключей устройства; код считается стандартной библиотекой. Вторая ступень обязательна для роли `OPERATOR` (§4.4 называет операторов; `MEASURER` — нет).
- **Первое подключение TOTP — по сессии, открытой кодом входа** (доверие при первом использовании), с событием аудита. Сброс фактора — подкоманда `identity mfa-reset --phone …`, которую запускает владелец. Цена: кто перехватил SMS оператора до первого подключения TOTP, подключит свой.
- **Повторная 2FA** для денежных действий — код TOTP, введённый не раньше 5 минут назад (`MFA_STEP_UP_WINDOW=5m`). Пока деньги в `web`, проверяет `web`; в плане 3 — `deal` через `authz.RequireRecentMFA`. Цена: два денежных действия в пределах 5 минут — один ввод кода.
- **Демо:** в `DEMO_MODE` демо-сессия оператора считается прошедшей вторую ступень (`mfa_verified_at = now`), иначе 147 сценариев e2e оператора ломаются. `APP_ENV=prod` запрещает `DEMO_MODE` (уже так).
- **Что шифруется:** ИИН человека, БИН/ИИН исполнителя, ИИН подписанта, IBAN. ФИО, Instagram и e-mail хранятся открыто (их показывают всюду), телефон — открыто (вход по нему). Как в `CLAUDE.md`.
- **Ключ шифрования ключей — из переменной окружения**, KMS — интерфейсом позже: облако в РК не выбрано, API не выдумываем. Prod требует сильные и разные ключи (`config.Secret`, `config.Distinct`).
- **Данные не переносятся**: v2 стартует с чистой базой и демо-сидом (спека §9.2). Старые столбцы `*Enc`/`*Hash` в Prisma перестают заполняться; `binIinEnc` становится необязательным (одна миграция Prisma); удаление столбцов — план 7.
- **Согласие на ПДн подтверждается сессией, открытой одноразовым кодом**: экран согласия идёт сразу после входа, в записи — версия, sha256 текста, цели, канал `otp_session`, `session_id`. Без согласия текущей версии `web` пускает только на экран согласия и выход. Номер телефона собирается до согласия — он нужен для самого входа. Цена: юрист может потребовать код именно на согласие (A.2 «надёжнее»).
- **Тексты согласий — черновики** в `apps/web/src/i18n/ru/consent.ts` со структурой A.8 и пометкой «требует юридической проверки»; версия и sha256 считаются из текста. Казахский язык (P18) — после юриста.
- **Отзыв согласия на ПДн** — заявка со сроком 15 рабочих дней (считаются только пн–пт; праздники РК не учитываются — срок получается не позже законного), очередь у оператора, решение «выполнено» или «отказ с причиной». Само удаление и блокировка данных по всем сервисам — до пилота, когда появятся `deal` и `marketplace` (обязательства известны только им). Цена: до этого оператор выполняет отзыв по регламенту вручную.
- **Согласие на передачу банку (P3)** — отдельный вид `BANK_TRANSFER` на сделку: исполнитель даёт его при подписании оферты, покупатель — на шаге оплаты; оплата без согласий обеих сторон отклоняется.
- **Открытые ИИН/БИН/IBAN** выдаёт только `RevealPartyDetails{purpose}` — каждому субъекту событие аудита `pii.revealed` в outbox. Вызывающий — `web`; сессия действующего лица необязательна (оплата и выплата идут и из фоновых задач), тогда действующее лицо — сервис. Сверка ИИН подписи — `VerifySignerIin` без раскрытия.
- **Файлы KYC остаются в `web`** (`StoredFile`, сервис `files` — план 4); `identity` хранит их `id`. Владение файлом проверяет `web` до вызова.
- **Блокировка выплаты при смене IBAN** (`payments/payout-lock.ts`) проверяется в `web` до `SetPayoutIban`; в плане 3 — в `deal`.

## Global Constraints

- Всё из `CLAUDE.md` (Definition of Done, продуктовые инварианты, «Окружение агента») и Global Constraints плана 2 действует для каждой задачи: коды ошибок вместо текстов, `idempotency_key` (непустой, ≤ 128) у каждого изменяющего метода, `idempotency_key_reused`, изменение и событие аудита в одной транзакции (`outbox.Add`), первая строка обработчика — `requireCaller` (новые методы — только `web`), Conventional Commits на русском с телом «почему / что / как проверено» и последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Методы, которые меняют чужие данные или видят чужие ПДн по роли `OPERATOR` (`ProvisionExecutor`, `ListKycQueue`, `ReviewKyc`, `ListConsentRevocations`, `ResolveConsentRevocation`), требуют у сессии `mfa_verified_at` — иначе `PermissionDenied`, код `mfa_required`.
- Открытые ИИН, БИН, IBAN, секрет TOTP и код не попадают ни в лог, ни в ответ, кроме `RevealPartyDetails` и `StartTotpEnrollment`. `pkg/logging` маскирует ключи `iin`, `bin_iin`, `signer_iin`, `iban`, `secret`, `full_name`, `email`, `instagram` (добавляет Task 3) — поля называть только так.
- Шифртекст: `v2.<kid>.<base64url(обёрнутый ключ данных)>.<base64url(nonce‖шифртекст‖tag)>`, AES-256-GCM и для ключа данных, и для значения; AAD — `"identity.<таблица>.<поле>:<user_id>"`. В интерфейсе — только последние 4 символа.
- Проверки форматов переносятся из `apps/web` один к одному: ИИН/БИН — `src/modules/identity/kz-id.ts` (контрольная сумма), IBAN — `iban.ts`, Instagram — `instagram.ts`, ФИО — `full-name.ts`, правила заявки исполнителя — `registration-schema.ts`, KYC — `kyc-policy.ts` (переходы, 3–500 символов причины, не больше 4 файлов каждого вида). Те же тестовые случаи — в Go.
- Подделка `apps/web/test/stubs/identity.ts` получает каждый новый RPC в той задаче web, которая начинает его звать, — с тем же порядком проверок и кодами, что в Go.
- Тексты интерфейса — только в `apps/web/src/i18n/ru/*` (новые: `identity.ts` для 2FA и данных, `consent.ts` для согласий). Нет слов «комиссия» и «эскроу» у покупателя и мастера; в тексте согласия банк называется «банк-партнёр», деньги — «деньги в банке под защитой».
- Тесты `apps/web` — только базы `senim_v2web_test` и `senim_v2web_e2e` на `localhost:5442`; Go — testcontainers (`DOCKER_HOST=npipe:////./pipe/docker_engine`), без `-race` локально.

## Review Focus

1. **Шифртекст перенесён в чужую строку** (ИИН пользователя A скопирован в строку B — ошибка оператора или атака на базу): расшифровка для B падает, а не показывает чужой ИИН (AAD с `user_id`; тесты в Task 3 и Task 6).
2. **Оператор с сессией по SMS, но без TOTP, зовёт операторский метод напрямую** (в обход экранов `web`): `identity` отказывает `mfa_required`; тот же код TOTP второй раз в том же окне — `mfa_code_reused` (тесты в Task 4).
3. **Два человека одновременно регистрируют один ИИН или БИН**: один успешен, второй получает `iin_taken`, а не `Internal` (уникальный HMAC; тесты в Task 6 и Task 7).
4. **Смена ключа посреди жизни данных**: значения под прежним `kid` читаются после смены текущего ключа; `rewrap-pii` переводит их на новый; ключ убран из конфига раньше перешифровки — сервис не стартует и называет `kid` (тесты в Task 3 и Task 7).
5. **Новая версия текста согласия, пока человек на середине формы**: следующий запрос уводит на экран согласия с возвратом на ту же страницу, ничего не теряя; дата исполнения отзыва пропускает выходные (тесты в Task 9 и Task 14).

---

### Task 1: Контракт — ПДн, KYC, согласия, 2FA

**Files:**
- Modify: `proto/senim/identity/v1/identity.proto`, `proto/senim/events/v1/identity.proto`
- Generated: `gen/go/senim/identity/v1/**`, `gen/go/senim/events/v1/*`, `apps/web/src/gen/senim/**`

**Interfaces — Produces** (все поля добавляются, существующие номера не меняются):
- Перечисления: `LegalForm { LEGAL_FORM_UNSPECIFIED=0; LEGAL_FORM_SELF_EMPLOYED=1; LEGAL_FORM_IP=2; LEGAL_FORM_TOO=3; }`; `KycStatus { KYC_STATUS_UNSPECIFIED=0; KYC_STATUS_NOT_SUBMITTED=1; KYC_STATUS_PENDING=2; KYC_STATUS_VERIFIED=3; KYC_STATUS_REJECTED=4; }`; `ConsentKind { CONSENT_KIND_UNSPECIFIED=0; CONSENT_KIND_PD_PROCESSING=1; CONSENT_KIND_BANK_TRANSFER=2; }`; `RevealPurpose { REVEAL_PURPOSE_UNSPECIFIED=0; REVEAL_PURPOSE_CONTRACT=1; REVEAL_PURPOSE_RELEASE_RECEIPT=2; REVEAL_PURPOSE_PAYOUT=3; }`; `RevocationStatus { REVOCATION_STATUS_UNSPECIFIED=0; REVOCATION_STATUS_REQUESTED=1; REVOCATION_STATUS_COMPLETED=2; REVOCATION_STATUS_REFUSED=3; }`.
- `Session` + `bool mfa_required; google.protobuf.Timestamp mfa_verified_at;`. `AuthenticateResponse` + `repeated Consent consents` (действующие, без отозванных).
- `Person{user_id, full_name, iin_last4, instagram, email}`; `Party{user_id, legal_form, legal_name, bin_iin_last4, signer_full_name, signer_iin_last4, payout_iban_last4, kyc_status, kyc_reject_reason, kyc_submitted_at, kyc_reviewed_at, repeated string kyc_id_file_ids, repeated string kyc_registration_file_ids}`; `PartyDetails{user_id, full_name, iin, legal_form, legal_name, bin_iin, signer_full_name, signer_iin, payout_iban}`; `Consent{id, kind, version, text_sha256, repeated string purposes, reference_id, channel, granted_at, revoked_at}`; `ConsentRevocation{id, user_id, kind, requested_at, due_at, status, decided_at, reason}`.
- RPC 2FA: `StartTotpEnrollment{session_token, idempotency_key} → {secret_base32}`; `ConfirmTotpEnrollment{session_token, code, idempotency_key} → {session}`; `VerifySecondFactor{session_token, code, idempotency_key} → {session}`.
- RPC ПДн: `RecordPerson{session_token, full_name, iin, idempotency_key} → {person}`; `UpdateContacts{session_token, instagram, email, idempotency_key} → {person}`; `GetProfile{session_token} → {person, party}` (чтение; `party` пуст, если нет); `RegisterParty{session_token, legal_form, legal_name, bin_iin, signer_full_name, signer_iin, idempotency_key} → {party}`; `ProvisionExecutor{session_token, phone, legal_form, legal_name, bin_iin, signer_full_name, signer_iin, idempotency_key} → {user, party}`; `SetPayoutIban{session_token, iban, idempotency_key} → {party}`; `VerifySignerIin{user_id, iin} → {matches}` (чтение); `RevealPartyDetails{actor_session_token, repeated string user_ids, purpose, reference_id} → {repeated PartyDetails parties}`.
- RPC KYC: `SubmitKyc{session_token, repeated string id_file_ids, repeated string registration_file_ids, idempotency_key} → {party}`; `ListKycQueue{session_token} → {repeated Party parties, repeated Person people}` (чтение); `ReviewKyc{session_token, user_id, bool verify, reason, idempotency_key} → {party}`.
- RPC согласия: `GrantConsent{session_token, kind, version, text_sha256, repeated string purposes, reference_id, idempotency_key} → {consent}`; `RevokeConsent{session_token, kind, idempotency_key} → {revocation}`; `ListMyConsents{session_token} → {consents (с отозванными), revocations}` (чтение); `HasConsents{repeated string user_ids, kind, reference_id} → {repeated string granted_user_ids}` (чтение); `ListConsentRevocations{session_token} → {revocations, people}` (чтение); `ResolveConsentRevocation{session_token, revocation_id, bool completed, reason, idempotency_key} → {revocation}`.
- `SeedUser` + `string full_name; string iin; string instagram; string email; SeedParty party; string consent_version; string consent_text_sha256;`; `SeedParty{legal_form, legal_name, bin_iin, signer_full_name, signer_iin, payout_iban, kyc_status}`.
- Новые коды (дописать в список кодов сервиса): `mfa_required`, `mfa_not_required`, `mfa_not_enrolled`, `mfa_already_enrolled`, `mfa_wrong_code`, `mfa_code_reused`, `mfa_too_many_attempts`, `iin_invalid`, `iin_taken`, `person_missing`, `person_already_recorded`, `person_too_many_attempts`, `full_name_invalid`, `instagram_invalid`, `email_invalid`, `bin_iin_invalid`, `signer_required`, `iban_invalid`, `party_missing`, `party_exists`, `kyc_documents_missing`, `kyc_transition_forbidden`, `kyc_reason_invalid`, `consent_version_invalid`, `consent_not_revocable`, `consent_missing`, `revocation_closed`, `reveal_purpose_invalid`, `pii_key_unknown`.
- События: `MfaEnrolled{user_id}`, `MfaReset{user_id}`, `KycReviewed{user_id, KycStatus status}`, `ConsentGranted{user_id, ConsentKind kind, version, reference_id}`, `ConsentRevocationRequested{revocation_id, user_id, ConsentKind kind, due_at}`, `ConsentRevocationResolved{revocation_id, user_id, RevocationStatus status}`.

- [ ] **Step 1:** Дописать proto по интерфейсам выше, комментарии — по-русски, как у соседних полей.
- [ ] **Step 2:** Run `go tool buf lint && go tool buf breaking --against '.git#ref=HEAD~1' && go tool buf generate && go build ./... && npm --prefix apps/web run typecheck` — Expected: без ошибок; `breaking` молчит (только добавления). Сервис компилируется: новые методы отвечают `Unimplemented` от встроенной заглушки connect.
- [ ] **Step 3: Commit** — `feat(proto): identity — ПДн, KYC, согласия и 2FA`.

---

### Task 2: Долг схемы identity — CHECK и тесты плана 2

**Files:**
- Create: `services/identity/migrations/0003_constraints.sql`
- Modify: `services/identity/platform_schema.sql` (если тест сверки требует), `services/identity/internal/roles_test.go`

**Interfaces — Produces:** функция `identity_roles_distinct(text[]) RETURNS boolean IMMUTABLE`; CHECK `users_roles_distinct` (`identity_roles_distinct(roles)`), CHECK `sessions_active_role_known` (`active_role IN ('CLIENT','EXECUTOR','OPERATOR','MEASURER')`).

- [ ] **Step 1: Тесты:** `TestUsersRejectDuplicateRoles` (INSERT с `roles = {CLIENT,CLIENT}` → ошибка CHECK `users_roles_distinct`); `TestSessionsRejectUnknownRole`; `TestSwitchRoleBlockedUser` и `TestGrantRoleBlockedUser` → `user_blocked`; `TestGrantRoleRevokedSession` и `TestGrantRoleIdleSession` → `session_invalid`.
- [ ] **Step 2:** Run `go test ./services/identity/...` — Expected: два теста CHECK падают; если тесты ролей проходят сразу, это закрывает долг плана 2 (записать в отчёт).
- [ ] **Step 3:** Миграция `0003` (goose Up/Down) с функцией и двумя CHECK.
- [ ] **Step 4:** Run `go test ./services/identity/... && go tool sqlc generate && git diff --exit-code services/identity/internal/store` — Expected: PASS, без дрейфа.
- [ ] **Step 5: Commit** — `fix(identity): CHECK на повтор ролей и роль сессии, тесты блокировки`.

---

### Task 3: `pkg/pii` — envelope-шифрование с `kid` и HMAC-индекс

**Files:**
- Create: `pkg/pii/{pii.go,keyring.go,index.go,config.go}`, тесты `pkg/pii/*_test.go`
- Modify: `pkg/logging/*.go` (маскируемые ключи + тест), `services/identity/internal/config.go` (+ тест)

**Interfaces — Produces:**
- `func NewKeyring(currentKID string, keks map[string][]byte) (*Keyring, error)` — ключи по 32 байта, `kid` — `[a-z0-9-]{1,32}`, текущий обязан быть в списке.
- `func (k *Keyring) Seal(plain []byte, aad string) (string, error)`; `func (k *Keyring) Open(blob, aad string) ([]byte, error)` — ошибки `ErrUnknownKID`, `ErrMalformed`, `ErrAuth`; `func (k *Keyring) Rewrap(blob, aad string) (string, bool, error)` — перешифровывает только ключ данных под текущим `kid`, `false` — уже текущий; `func (k *Keyring) KIDOf(blob string) (string, error)`.
- `func NewIndex(key []byte) *Index`; `func (i *Index) Of(domain, normalized string) []byte` — HMAC-SHA256(key, domain ‖ 0x00 ‖ value); домены: `iin`, `bin_iin`.
- `func Last4(s string) string`.
- `func LoadKeyring(l *config.Loader) *Keyring` и `func LoadIndex(l *config.Loader) *Index`: переменные `PII_KEKS` (`kid:base64,kid:base64`), `PII_KEK_CURRENT`, `PII_INDEX_KEY` (base64, ≥ 32 байта); вне dev — сильные ключи (`Secret`), все ключи разные между собой и с `OTP_HMAC_KEY` (`Distinct`).
- `ServeConfig` + `PII *pii.Keyring`, `PIIIndex *pii.Index`. Стенд: значения в `deploy/compose/*.vars` и генераторе `npm run v2:config` (как `OTP_HMAC_KEY`).
- `pkg/logging` маскирует `iin`, `bin_iin`, `signer_iin`, `iban`, `secret`, `full_name`, `email`, `instagram`.

- [ ] **Step 1: Тесты:** `TestSealOpenRoundTrip` (rapid: любые байты и AAD); `TestOpenWrongAAD` → `ErrAuth`; `TestOpenTampered` (любой изменённый байт любой части) → `ErrAuth` или `ErrMalformed`; `TestOpenUnknownKID`; `TestFormat` (префикс `v2.<kid>.`, 4 части); `TestRewrapToCurrent` (старый `kid` → текущий, `Open` даёт то же, повтор → `false`); `TestSealTwiceDiffers`; `TestIndexDomainsSeparate` (`Of("iin", x) != Of("bin_iin", x)`); `TestLoadKeyringProdRejectsWeakOrSame` (prod: ключ < 32 байт, одинаковые ключи, текущий `kid` не в списке — ошибка с именем переменной); `TestLoggerMasksPIIKeys`.
- [ ] **Step 2:** Run `go test ./pkg/pii/... ./pkg/logging/...` — Expected: FAIL.
- [ ] **Step 3:** Реализовать (`crypto/aes`, `crypto/cipher`, `crypto/hmac`, `crypto/rand`); комментарий-TODO: KMS облака РК — отдельная реализация обёртки ключа, когда облако выбрано.
- [ ] **Step 4:** Run `go vet ./... && go tool golangci-lint run ./... && go test ./pkg/... ./services/identity/...` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(pkg/pii): envelope-шифрование с kid и HMAC-индекс`.

---

### Task 4: Вторая ступень входа — TOTP в identity

**Files:**
- Create: `services/identity/migrations/0004_mfa.sql`, `services/identity/queries/mfa.sql`, `services/identity/internal/totp.go`, `services/identity/internal/mfa.go`, тесты `totp_test.go`, `mfa_test.go`
- Modify: `services/identity/internal/{authenticate.go,session.go,token.go,demo.go,run.go,config.go,caller.go,service.go}`, `pkg/authz/authz.go` (+ тест)

**Interfaces:**
- Consumes: Task 1 (RPC 2FA, поля `Session`); Task 3 (`pii.Keyring` — секрет TOTP шифруется).
- Produces:
  - таблица `mfa_factors(user_id uuid PRIMARY KEY REFERENCES users, secret_enc text NOT NULL, confirmed_at timestamptz, last_used_step bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now())`; `sessions` + `mfa_verified_at timestamptz`.
  - `totpCode(secret []byte, step int64) string`; `totpVerify(secret []byte, code string, now time.Time, lastUsed int64) (step int64, ok bool)` — окно ±1 шаг, шаг 30 с, 6 цифр, шаг ≤ `lastUsed` — не принимается.
  - `Session.mfa_required = active_role == OPERATOR`; `Session.mfa_verified_at` в ответах `Authenticate`, `VerifyOtp`, `SwitchRole`, `StartDemoSession`.
  - Внутренний токен: `mfa = mfa_verified_at != null`, новое поле `mfa_at` (Unix-секунды, 0 — нет). `authz.Claims` + `MFAAt time.Time`; `func RequireRecentMFA(c Claims, now time.Time, window time.Duration) error` → `connect.CodePermissionDenied` с деталью `mfa_required`, если `!c.MFA || now.Sub(c.MFAAt) > window`.
  - Конфиг: `MFA_STEP_UP_WINDOW` (по умолчанию `5m`, 1m…30m) — отдаётся только в документации для web и `deal`; `identity` его не применяет.
  - Подкоманда `identity mfa-reset --phone <E.164>`: удаляет фактор, сбрасывает `mfa_verified_at` всех сессий пользователя, событие `MfaReset` и аудит с `actor_kind="cli"` в одной транзакции.
  - Отказ по лимиту: 5 неверных кодов за 15 минут на пользователя — `mfa_too_many_attempts` (таблица `rate_limits`, ключ `mfa:<user_id>`).
  - `StartDemoSession` в `DEMO_MODE` для роли `OPERATOR` ставит `mfa_verified_at = now`.

- [ ] **Step 1: Тесты TOTP:** `TestTotpRFC6238Vectors` — ключ `"12345678901234567890"` (ASCII), время 59 → `287082`, 1111111109 → `081804`, 1234567890 → `005924`, 2000000000 → `279037` (6 младших цифр векторов RFC 6238 для SHA1); `TestTotpVerifyWindow` (шаги −1, 0, +1 принимаются, −2 и +2 — нет); `TestTotpVerifyRejectsUsedStep`.
- [ ] **Step 2: Тесты сервиса (реальная БД):** `TestEnrollAndConfirm` (Start → секрет 32 символа base32; Confirm с верным кодом → `mfa_verified_at` задан, `confirmed_at` задан; событие `MfaEnrolled` и аудит в outbox); `TestStartEnrollmentTwiceAfterConfirm` → `mfa_already_enrolled`; `TestStartEnrollmentNonOperator` → `mfa_not_required`; `TestVerifyWrongCode` → `mfa_wrong_code`; `TestVerifyReusedCode` → `mfa_code_reused`; `TestVerifyTooManyAttempts` (6-я неверная попытка) → `mfa_too_many_attempts`; `TestVerifyNotEnrolled` → `mfa_not_enrolled`; `TestAuthenticateTokenMfaClaims` (до проверки `mfa=false, mfa_at=0`; после — `mfa=true`, `mfa_at` = время проверки); `TestDemoOperatorSessionMfaSatisfied`; `TestMfaResetCommand`; `TestVerifySecondFactorReplayAfterLostResponse` (тот же ключ — тот же ответ, шаг не «сгорает» дважды).
- [ ] **Step 3: Тест `pkg/authz`:** `TestRequireRecentMFA` — граница: ровно `window` — проходит, `window + 1s` — `mfa_required`, `MFA=false` — `mfa_required`.
- [ ] **Step 4:** Run `go test ./services/identity/... ./pkg/authz/...` — Expected: FAIL (нет кода).
- [ ] **Step 5:** Реализовать: миграция `0004`, запросы, `totp.go`, обработчики (`requireCaller` → разбор сессии → роль `OPERATOR` → `idem.Lookup`/`Do`), поля токена, `RequireRecentMFA`, демо, подкоманда. Секрет — `pkg/pii` (Task 3), AAD `identity.mfa_factors.secret:<user_id>`; `StartTotpEnrollment` повторно до подтверждения выдаёт **новый** секрет (старый неподтверждённый заменяется).
- [ ] **Step 6:** Run `go vet ./... && go tool golangci-lint run ./... && go test ./services/identity/... ./pkg/authz/...` — Expected: PASS.
- [ ] **Step 7: Commit** — `feat(identity): вторая ступень входа оператора — TOTP и повторная проверка`.

---

### Task 5: web — 2FA оператора и повторная 2FA для денег

**Files:**
- Create: `apps/web/src/app/operator/mfa/{page.tsx,MfaForm.tsx,actions.ts}`, `apps/web/src/modules/identity/mfa.ts` (+ `mfa.int.test.ts`), `apps/web/e2e/operator-mfa.spec.ts`, `apps/web/e2e/totp.ts`
- Modify: `apps/web/src/modules/identity/{session.ts,remote-errors.ts}`, `apps/web/src/app/operator/_lib/guard.ts`, `apps/web/src/app/operator/money/actions.ts`, `apps/web/src/app/operator/disputes/actions.ts`, `apps/web/src/i18n/ru/identity.ts`, `apps/web/test/stubs/identity.ts`

**Interfaces:**
- Consumes: Task 4 (RPC, `Session.mfa_required/mfa_verified_at`).
- Produces: `CurrentUser` + `mfa: { required: boolean; verifiedAt: Date | null }`; `startTotpEnrollment(user): Promise<{ secret: string; otpauthUrl: string; qrSvg: string }>` (URI `otpauth://totp/<brand>:<phone>?secret=…&issuer=<brand>&digits=6&period=30`, бренд — из `src/config/brand.ts`); `confirmTotpEnrollment(user, code)`, `verifySecondFactor(user, code)`; `requireRecentMfa(user, now = new Date()): void` — бросает `fail.forbidden()` с кодом `MFA_REQUIRED`, если `verifiedAt` старше `MFA_STEP_UP_WINDOW` (env `web`, по умолчанию 5 мин).

- [ ] **Step 1: Тесты:** `mfa.int.test.ts` — подключение и проверка через подделку; `requireRecentMfa` на границе 5 мин (ровно 5 мин — проходит, +1 с — отказ); операторская страница без `mfa.verifiedAt` → переход на `/operator/mfa?next=…`; `confirmBankOperation`, `failBankOperation`, `retryBankOperation`, `resolveDispute` без свежей 2FA → результат с кодом `MFA_REQUIRED`, без вызова сервиса денег.
- [ ] **Step 2:** Run `npm --prefix apps/web run test -- mfa` — Expected: FAIL.
- [ ] **Step 3:** Реализовать: подделка (паритет с Go: лимит, повтор шага, демо-оператор с пройденной 2FA); экран `/operator/mfa` — одно главное действие: подключение (QR + секрет текстом для ручного ввода) или ввод кода; защита операторских страниц; на `MFA_REQUIRED` в денежных формах — поле кода и повтор действия (через `leaveIfSignedOut`-подобный помощник `askSecondFactor`, тексты из `ru`).
- [ ] **Step 4:** e2e `operator-mfa.spec.ts`: не-демо оператор (засеять через `SeedUsers` с `is_demo=false`) входит по коду → `/operator/mfa` → читает секрет со страницы → `e2e/totp.ts` (RFC 6238 на `node:crypto`) считает код → попадает в кабинет; через 5 минут (часы Playwright) подтверждение банковской операции просит код.
- [ ] **Step 5:** Run `npm --prefix apps/web run check` и `npx playwright test e2e/operator-mfa.spec.ts` против `npm run v2:up` — Expected: зелёные.
- [ ] **Step 6: Commit** — `feat(web): 2FA оператора и повторный код для денежных действий`.

---

### Task 6: identity — личность и контакты

**Files:**
- Create: `services/identity/migrations/0005_persons.sql`, `queries/persons.sql`, `internal/person.go`, `internal/kzid.go`, тесты `person_test.go`, `kzid_test.go`
- Modify: `internal/demo.go` (сид личности), `internal/service.go`, `internal/caller.go`

**Interfaces — Produces:**
- `persons(user_id uuid PRIMARY KEY REFERENCES users, full_name text, iin_enc text, iin_hash bytea UNIQUE, iin_last4 text, instagram text, email text, updated_at timestamptz NOT NULL DEFAULT now())`.
- `validIIN(s string) bool`, `validBINorIIN(s string) bool` — как `kz-id.ts`; `normalizeFullName`, `normalizeInstagram`, `normalizeEmail` — как `full-name.ts`, `instagram.ts` и схема в `contacts-profile.ts`.
- `RecordPerson`: правила `person-identity.ts` (повторная запись того же ИИН — тот же ответ; другой ИИН поверх записанного — `person_already_recorded`; лимит попыток как в `limitIdentityAttempts` — `person_too_many_attempts`); занятый ИИН — `iin_taken` (уникальный `iin_hash`, конфликт `23505` → код, не `Internal`). Аудит `user.identity.recorded` без значений.
- `UpdateContacts`, `GetProfile` (`person` + `party`, если есть; `party` появится в Task 7). Аудит `user.instagram_changed` / `user.email_changed` без значений.
- `SeedUsers` пишет личность из `SeedUser.full_name/iin/instagram/email`.

- [ ] **Step 1: Тесты:** `TestKzIDVectors` (те же случаи, что в `kz-id.test.ts`); `TestRecordPerson` (в базе `iin_enc` с префиксом `v2.`, `iin_last4`, ответ без ИИН); `TestRecordPersonSameIINIdempotent`; `TestRecordPersonOtherIIN` → `person_already_recorded`; `TestRecordPersonIINTakenRace` (две горутины, два пользователя, один ИИН → ровно один успех и один `iin_taken`); `TestRecordPersonSwappedCiphertext` (скопировать `iin_enc` пользователя A в строку B → расшифровка для B даёт `ErrAuth`); `TestUpdateContactsValidation` (те же случаи, что в `instagram.test.ts`); `TestNoPIIInLogs` (буфер логгера после `RecordPerson` не содержит ИИН и ФИО).
- [ ] **Step 2:** Run — Expected: FAIL. **Step 3:** Реализовать. **Step 4:** Run `go test ./services/identity/... && go tool sqlc generate && git diff --exit-code` — Expected: PASS, без дрейфа.
- [ ] **Step 5: Commit** — `feat(identity): личность и контакты — ФИО, ИИН, Instagram, e-mail`.

---

### Task 7: identity — реквизиты исполнителя, IBAN, раскрытие с аудитом, перешифровка

**Files:**
- Create: `services/identity/migrations/0006_parties.sql`, `queries/parties.sql`, `internal/party.go`, `internal/reveal.go`, `internal/rewrap.go`, тесты `party_test.go`, `reveal_test.go`, `rewrap_test.go`
- Modify: `internal/run.go` (подкоманда `rewrap-pii`), `internal/demo.go`, `internal/caller.go`

**Interfaces — Produces:**
- `parties(user_id uuid PRIMARY KEY REFERENCES users, legal_form text NOT NULL CHECK (legal_form IN ('SELF_EMPLOYED','IP','TOO')), legal_name text NOT NULL, bin_iin_enc text NOT NULL, bin_iin_hash bytea NOT NULL UNIQUE, bin_iin_last4 text NOT NULL, signer_full_name text, signer_iin_enc text, signer_iin_hash bytea, payout_iban_enc text, payout_iban_last4 text, kyc_status text NOT NULL DEFAULT 'NOT_SUBMITTED', kyc_reject_reason text, kyc_submitted_at timestamptz, kyc_reviewed_at timestamptz, kyc_id_file_ids text[] NOT NULL DEFAULT '{}', kyc_registration_file_ids text[] NOT NULL DEFAULT '{}', created_at, updated_at)`; CHECK: подписант обязателен у `TOO`.
- `RegisterParty`: требует роль `EXECUTOR` у пользователя; правила `registration-schema.ts` и `registration.ts` (у `IP` и `SELF_EMPLOYED` БИН/ИИН = ИИН личности, `bin_iin` в запросе игнорируется; нет личности — `person_missing`); повтор с теми же данными — тот же ответ; другие данные при существующей — `party_exists`.
- `ProvisionExecutor` (оператор с 2FA): создаёт пользователя с ролью `EXECUTOR` (или берёт существующего по телефону без других ролей сотрудника) и реквизиты; событие `UserRegistered` при новом.
- `SetPayoutIban` — `iban.ts`; аудит `executor.payout_iban_changed` с `{set: true}`.
- `VerifySignerIin{user_id, iin}` — сравнение HMAC с `signer_iin_hash`, а для `IP`/`SELF_EMPLOYED` — с `bin_iin_hash`; без раскрытия, без аудита.
- `RevealPartyDetails`: `purpose` обязателен (`reveal_purpose_invalid`), `reference_id` обязателен; для каждого `user_id` — аудит `pii.revealed` (`actor` — пользователь сессии или `service:web`, `meta: {purpose, reference_id, fields}`) в outbox в одной транзакции с чтением; неизвестный пользователь — пропускается без ошибки (сделка могла пережить пользователя), но попадает в аудит с `found=false`.
- `identity rewrap-pii [--batch 500]`: все `*_enc` в `persons`, `parties`, `mfa_factors`, чей `kid` не текущий, — `Rewrap` пачками в отдельных транзакциях; печатает число по таблицам. При старте `serve` — проверка: в базе нет `kid`, которого нет в `PII_KEKS` (иначе ошибка с именем `kid`).

- [ ] **Step 1: Тесты:** `TestRegisterPartyIPUsesPersonIIN`; `TestRegisterPartyTOORequiresSigner` → `signer_required`; `TestRegisterPartyBinTakenRace` → один `iin_taken`; `TestRegisterPartyNotExecutor` → `role_not_granted`; `TestProvisionExecutorRequiresMfa` → `mfa_required`; `TestProvisionExecutorStaffPhone` (телефон оператора) → `role_forbidden`; `TestSetPayoutIbanValidation` (случаи `iban.test.ts`); `TestVerifySignerIin` (совпало / не совпало / ИП по своему ИИН); `TestRevealWritesAuditPerSubject` (два пользователя → два события `pii.revealed` с `purpose` и без значений в `after_json`); `TestRevealUnknownPurpose`; `TestRewrapMovesToCurrentKID` (данные под `k1`, конфиг `k2` текущий + `k1` → после команды все `v2.k2.`, значения те же); `TestServeRefusesMissingKID`.
- [ ] **Step 2:** Run — Expected: FAIL. **Step 3:** Реализовать. **Step 4:** Run `go vet ./... && go tool golangci-lint run ./... && go test ./services/identity/...` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(identity): реквизиты исполнителя, IBAN, раскрытие ПДн с аудитом и перешифровка`.

---

### Task 8: identity — KYC

**Files:**
- Create: `services/identity/internal/kyc.go`, `internal/kyc_policy.go`, тесты `kyc_test.go`, `kyc_policy_test.go`; `queries/kyc.sql`

**Interfaces — Produces:**
- Таблица переходов в коде: `var kycTransitions = []kycTransition{{action: "submit", from: {NOT_SUBMITTED, PENDING, REJECTED}, to: PENDING, by: EXECUTOR}, {action: "verify", from: {PENDING}, to: VERIFIED, by: OPERATOR}, {action: "reject", from: {PENDING}, to: REJECTED, by: OPERATOR, needsReason}}` — как `kyc-policy.ts` (статус `NOT_SUBMITTED` хранится явно; `submit` из `PENDING` заменяет файлы).
- `SubmitKyc`: оба вида файлов, не больше 4 каждого, `id` — UUID (`kyc_documents_missing`, `invalid_request`); аудит `executor.kyc_submitted`.
- `ReviewKyc` (оператор с 2FA): условный `UPDATE … WHERE user_id = $1 AND kyc_status = 'PENDING'`, 0 строк — `kyc_transition_forbidden`; причина 3–500 символов при отказе (`kyc_reason_invalid`); аудит `executor.kyc_verified` / `executor.kyc_rejected` (причина в `after_json`) и событие `KycReviewed` в одной транзакции.
- `ListKycQueue` (оператор с 2FA): `PENDING` с обоими видами файлов, старые первыми; `people` — ФИО тех же пользователей.

- [ ] **Step 1: Тесты:** `TestKycTransitions` — каждый разрешённый и каждый запрещённый переход таблицы на реальной БД (`from × action × роль`); `TestReviewKycConcurrent` (два оператора одновременно verify и reject → один успех, второй `kyc_transition_forbidden`); `TestReviewKycReplay` (тот же ключ — тот же ответ, одно событие); `TestKycQueueOrderAndFilter`; `TestKycRequiresMfa`.
- [ ] **Step 2:** Run — Expected: FAIL. **Step 3:** Реализовать. **Step 4:** Run `go test ./services/identity/...` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(identity): KYC исполнителя — подача, очередь и решение оператора`.

---

### Task 9: identity — согласия и отзыв

**Files:**
- Create: `services/identity/migrations/0007_consents.sql`, `queries/consents.sql`, `internal/consent.go`, `internal/workdays.go`, тесты `consent_test.go`, `workdays_test.go`
- Modify: `internal/authenticate.go` (поле `consents`), `internal/demo.go`

**Interfaces — Produces:**
- `consents(id uuid PK, user_id uuid NOT NULL REFERENCES users, kind text NOT NULL, version text NOT NULL, text_sha256 bytea NOT NULL CHECK (length(text_sha256) = 32), purposes text[] NOT NULL, reference_id text NOT NULL DEFAULT '', channel text NOT NULL, session_id uuid, granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz)`; уникальный индекс `(user_id, kind, version, reference_id) WHERE revoked_at IS NULL`; триггер: `UPDATE` разрешён только `revoked_at` из NULL, `DELETE` запрещён (запись доказательства не меняется).
- `consent_revocations(id uuid PK, user_id, kind, requested_at, due_at, status text CHECK (status IN ('REQUESTED','COMPLETED','REFUSED')), decided_at, decided_by uuid, reason text)`; один открытый отзыв на `(user_id, kind)`.
- `addWorkdays(t time.Time, n int, loc *time.Location) time.Time` — только пн–пт, часовой пояс `Asia/Almaty`; `due_at = addWorkdays(requested_at, 15)`.
- `GrantConsent`: `version` — `[A-Za-z0-9.-]{1,32}`, `text_sha256` — 64 hex (`consent_version_invalid`); `PD_PROCESSING` — `reference_id` пуст; `BANK_TRANSFER` — `reference_id` обязателен; канал `otp_session`, `session_id` — текущая сессия. Повтор действующего согласия той же версии — тот же ответ. Событие `ConsentGranted` и аудит.
- `RevokeConsent`: только `PD_PROCESSING` (`consent_not_revocable`); нет действующего — `consent_missing`; создаёт заявку `REQUESTED`, ставит `revoked_at` действующей записи; событие `ConsentRevocationRequested`.
- `ResolveConsentRevocation` (оператор с 2FA): условный `UPDATE … WHERE status = 'REQUESTED'` (`revocation_closed`); отказ требует причину 3–500; событие `ConsentRevocationResolved` и аудит.
- `HasConsents`: возвращает тех из `user_ids`, у кого действующее согласие вида и `reference_id`.
- `Authenticate.consents` — действующие записи; `SeedUsers` даёт демо-персонам `PD_PROCESSING` версии `consent_version` с каналом `seed`.

- [ ] **Step 1: Тесты:** `TestAddWorkdays` (пятница + 1 → понедельник; суббота + 15 → третья пятница; переход через полночь по Алматы); `TestGrantConsentRecordsProof` (версия, хэш, цели, канал, `session_id`); `TestGrantConsentIdempotent`; `TestConsentRowImmutable` (UPDATE `version` и DELETE → ошибка триггера); `TestRevokeCreatesRequestWithDueDate`; `TestRevokeBankTransfer` → `consent_not_revocable`; `TestResolveRevocationConcurrent` → один успех; `TestHasConsentsPerDeal`; `TestAuthenticateReturnsActiveConsents`.
- [ ] **Step 2:** Run — Expected: FAIL. **Step 3:** Реализовать. **Step 4:** Run `go test ./services/identity/... && go tool sqlc generate && git diff --exit-code` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(identity): согласия на ПДн и передачу банку, отзыв со сроком 15 рабочих дней`.

---

### Task 10: web — личность и контакты через identity

**Files:**
- Modify: `apps/web/src/modules/identity/{person-identity.ts,contacts-profile.ts,projection.ts,session.ts,remote-errors.ts}` и их тесты, `apps/web/src/app/welcome/actions.ts`, места, где `recordPersonIdentity(tx, …)` зовётся внутри чужой транзакции (найти поиском), `apps/web/test/stubs/identity.ts`, `apps/web/src/i18n/ru/identity.ts`

**Interfaces:**
- Consumes: Task 6.
- Produces: `projectPerson(person: Person): Promise<void>` — пишет `User.fullName`, `iinLast4`, `instagram`, `email` (только изменившиеся поля); `recordOwnIdentity`, `updateContacts`, `getOwnContacts` — прежние сигнатуры, внутри — `identity()` и проекция; столбцы `iinEnc`, `iinHash` больше не пишутся.
- Порядок там, где запись личности шла внутри чужой транзакции: сначала `RecordPerson` (идемпотентный ключ на попытку формы), затем транзакция `web` как прежде — как «роль, потом профиль» в плане 2.

- [ ] **Step 1: Тесты:** существующие `person-identity.int.test.ts`, `contacts-profile.int.test.ts`, `introduction.int.test.ts` переписать на подделку (смысл тот же); новый — `iin_taken`, `person_already_recorded` и `person_too_many_attempts` дают тексты из `ru`; после записи `User.iinEnc` и `iinHash` пусты, `iinLast4` задан.
- [ ] **Step 2:** Run `npm --prefix apps/web run test -- identity` — Expected: FAIL. **Step 3:** Реализовать. **Step 4:** Run `npm --prefix apps/web run check` — Expected: зелёный.
- [ ] **Step 5: Commit** — `feat(web): личность и контакты через identity, проекция в User`.

---

### Task 11: web — регистрация исполнителя, IBAN, «Добавить исполнителя»

**Files:**
- Create: `apps/web/prisma/migrations/<дата>_bin_iin_enc_optional/migration.sql`
- Modify: `apps/web/prisma/schema.prisma` (`binIinEnc String?`), `apps/web/src/modules/identity/{registration.ts,payout.ts,projection.ts}`, `apps/web/src/modules/operator/executors.ts`, `apps/web/src/app/executor/profile/payout/actions.ts`, тесты, подделка, `ru`

**Interfaces:**
- Consumes: Task 7.
- Produces: `projectParty(party: Party, tx?): Promise<void>` — пишет в `ExecutorProfile` `legalForm`, `legalName`, `binIinLast4`, `signerFullName`, `payoutIbanLast4`, `kycStatus`, `kycRejectReason`, `kycReviewedAt`; `*Enc`/`*Hash` не пишутся. `registerExecutor`: `GrantRole` (как в плане 2) → `RegisterParty` → транзакция `web` (профиль с сегментом, городом и проекцией). `setPayoutIban`: проверка `payout-lock` → `SetPayoutIban` → проекция. `addExecutor` (оператор): `ProvisionExecutor` → проекция `User` и профиля; прямого `prisma.user.create` больше нет.

- [ ] **Step 1: Тесты:** переписать `registration.int.test.ts`, `payout.int.test.ts`, тест «Добавить исполнителя» на подделку; новые — ИП берёт ИИН личности; `iin_taken` на БИН — текст из `ru`; смена IBAN при ждущей выплате не вызывает `SetPayoutIban`; профиль после регистрации без `binIinEnc`.
- [ ] **Step 2:** Run — Expected: FAIL. **Step 3:** Миграция Prisma (`npm --prefix apps/web run db:generate` или как принято в `apps/web/CLAUDE.md`, база — только `senim_v2web_test`), реализация. **Step 4:** Run `npm --prefix apps/web run check` — Expected: зелёный.
- [ ] **Step 5: Commit** — `feat(web): реквизиты исполнителя и IBAN через identity`.

---

### Task 12: web — договор, подпись и выплата читают ПДн через identity

**Files:**
- Modify: `apps/web/src/modules/documents/{data.ts,signing.ts,providers/mock-signature.ts}`, `apps/web/src/modules/payments/execute.ts`, `apps/web/src/modules/identity/payout.ts` (удалить неиспользуемый `payoutRecipientOf`), тесты, подделка

**Interfaces:**
- Consumes: Task 7 (`RevealPartyDetails`, `VerifySignerIin`).
- Produces: `revealParties(userIds: string[], purpose: "CONTRACT" | "RELEASE_RECEIPT" | "PAYOUT", referenceId: string, actor?: CurrentUser): Promise<Map<string, PartyDetails>>` в `modules/identity`; `decryptPii` в этих модулях больше не зовётся (поиск по `src/modules/documents`, `src/modules/payments` — пусто).

- [ ] **Step 1: Тесты:** PDF оферты и расписки получают ИИН/БИН/IBAN из `revealParties` с `purpose` и `referenceId = dealId` (подделка запоминает вызовы); подпись ЭЦП с чужим ИИН отклоняется по `VerifySignerIin`; выплата передаёт IBAN из `revealParties(…, "PAYOUT")`; суммы в PDF и журнале денег не изменились (существующие тесты документов зелёные).
- [ ] **Step 2:** Run — Expected: FAIL. **Step 3:** Реализовать. **Step 4:** Run `npm --prefix apps/web run check` — Expected: зелёный.
- [ ] **Step 5: Commit** — `feat(web): договор, подпись и выплата получают ПДн из identity`.

---

### Task 13: web — KYC через identity

**Files:**
- Modify: `apps/web/src/modules/identity/{kyc.ts,kyc-policy.ts}`, `apps/web/src/modules/operator/kyc.ts`, `apps/web/src/app/executor/profile/kyc/actions.ts`, `apps/web/src/app/operator/kyc/{page.tsx,actions.ts}`, тесты, подделка

**Interfaces:**
- Consumes: Task 8.
- Produces: `submitKycDocuments(user, input)` — сначала `attachFiles` в `web` (владение и тип файла — как сейчас), затем `SubmitKyc` с `id` файлов, проекция, уведомление операторов; `kycQueue(operator)` — `ListKycQueue` + ссылки на файлы на 15 минут + событие аудита `web` `pii.kyc_file_link_issued` (`recordAudit`, без значений) на каждую выданную ссылку; `reviewKyc(operator, userId, decision)` — `ReviewKyc` → проекция → уведомление мастеру. `kyc-policy.ts` в web остаётся только для экрана (`NOT_SUBMITTED` и подписи) — переходы решает `identity`.

- [ ] **Step 1: Тесты:** переписать `kyc.int.test.ts` на подделку (смысл тот же); новые — выдача ссылок пишет аудит; повторное решение по уже проверенному → текст `kyc_transition_forbidden` из `ru`.
- [ ] **Step 2:** Run — Expected: FAIL. **Step 3:** Реализовать. **Step 4:** Run `npm --prefix apps/web run check` — Expected: зелёный.
- [ ] **Step 5: Commit** — `feat(web): KYC исполнителя через identity, аудит выдачи ссылок на документы`.

---

### Task 14: web — согласия: экран после входа, «Мои данные», отзыв, передача банку

**Files:**
- Create: `apps/web/src/i18n/ru/consent.ts`, `apps/web/src/modules/identity/consent.ts` (+ тест), `apps/web/src/app/consent/{page.tsx,ConsentForm.tsx,actions.ts}`, `apps/web/src/app/profile/data/{page.tsx,RevokeForm.tsx,actions.ts}`, `apps/web/src/app/operator/consents/{page.tsx,ResolveForm.tsx,actions.ts}`, `apps/web/e2e/consent.spec.ts`
- Modify: `apps/web/src/modules/identity/session.ts` (`CurrentUser.consents`), корневая защита страниц (там же, где переход на вход), шаг оплаты и подписания оферты (найти поиском `payForDeal` и экран подписи оферты), `apps/web/src/modules/deal-core/service.ts` (`payForDeal`), подделка

**Interfaces:**
- Consumes: Task 9.
- Produces: `CONSENT_DOCUMENTS: Record<"PD_PROCESSING" | "BANK_TRANSFER", { version: string; purposes: string[]; title: string; sections: { heading: string; body: string }[] }>` в `ru/consent.ts` — структура A.8 (12 разделов для ПДн; для банка — цель, перечень данных, банк-партнёр), первая строка каждого — «Черновик, требует юридической проверки»; `consentTextSha256(kind): string` — sha256 канонического JSON документа (вычисляется, не хранится руками; тест ловит изменение текста без смены версии через снимок хэша). `needsConsent(user): boolean` — нет действующего `PD_PROCESSING` текущей версии. Защита: при `needsConsent` любая страница, кроме `/consent`, `/logout` и статических, уводит на `/consent?next=…`; Server Action получает `UNAUTHENTICATED`-подобный код `CONSENT_REQUIRED` и `leaveIfSignedOut` уводит туда же.
- «Мои данные» (`/profile/data`, P7): ФИО, последние 4 символа ИИН, контакты, действующие согласия с датой и версией, кнопка «Отозвать согласие» (подтверждение с последствиями из `ru`) и статус заявки со сроком.
- Оператор: `/operator/consents` — очередь отзывов (срок, ФИО), решение «выполнено» / «отказ с причиной».
- Передача банку: исполнитель отмечает согласие на экране подписания оферты (до подписи), покупатель — на шаге оплаты; `payForDeal` до списания зовёт `HasConsents([clientId, executorId], BANK_TRANSFER, dealId)` — не хватает → `CONFLICT` с кодом `BANK_CONSENT_MISSING`, денег не трогает.

- [ ] **Step 1: Тесты:** новый пользователь после входа → `/consent`, после согласия — на `next`; смена версии в `ru/consent.ts` (тестом через подмену) → следующий запрос уводит на `/consent` с возвратом; запись согласия несёт версию и хэш текущего текста; отзыв → статус с датой через 15 рабочих дней; оператор закрывает отзыв; `payForDeal` без согласия исполнителя → `BANK_CONSENT_MISSING` и ни одной `MoneyTransaction`; снимок `consentTextSha256`; в текстах покупателя и мастера нет «комиссия» и «эскроу» (существующий тест словаря охватывает `consent.ts`).
- [ ] **Step 2:** Run — Expected: FAIL. **Step 3:** Реализовать (экраны — одно главное действие, «Назад» видна, поля и кнопки ≥ 48 px, текст ≥ 17 px). **Step 4:** e2e `consent.spec.ts`: вход новым номером → экран согласия → кабинет; «Мои данные» → отзыв → статус. Run `npm --prefix apps/web run check` — Expected: зелёный.
- [ ] **Step 5: Commit** — `feat(web): согласия на ПДн и передачу банку, «Мои данные», очередь отзывов`.

---

### Task 15: Демо-сид с ПДн и прогон e2e против стенда v2

**Files:**
- Modify: `apps/web/src/demo/{seed.ts,data.ts}`, `apps/web/e2e/global-setup.ts`, `apps/web/e2e/support.ts`, сценарии e2e — только минимальные правки (список с причинами — в отчёт), `deploy/compose/*` (ключи `PII_*` для стенда через `npm run v2:config`)

**Interfaces:** `seedDemo` передаёт в `SeedUsers` ФИО, ИИН, контакты, реквизиты (`SeedParty`, в том числе IBAN и `kyc_status`) и согласие текущей версии; затем проекция каждого пользователя и профиля; старый сид больше не шифрует ИИН/БИН/IBAN сам.

- [ ] **Step 1:** Run `npm run v2:up`, затем `E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5442/senim_v2web_e2e npm --prefix apps/web run test:e2e` — Expected до правок: падения в сценариях входа новым номером (экран согласия), KYC и регистрации — записать.
- [ ] **Step 2:** Сид и инфраструктура e2e; сценарии, которые вводят новый номер, проходят экран согласия (одна общая функция в `support.ts`).
- [ ] **Step 3:** Run полный e2e — Expected: прежние сценарии + `operator-mfa` + `consent` — 0 упавших, пропущенные — те же 3; записать длительность. Run `npm run v2:down`.
- [ ] **Step 4: Commit** — `feat(web): демо-сид с ПДн через identity, e2e против стенда v2`.

---

### Task 16: Документы — ADR-014, PROGRESS, README

**Files:**
- Create: `docs/adr/014-pii-consents-and-operator-mfa.md`
- Modify: `docs/PROGRESS.md`, `README.md`, `CLAUDE.md` (ссылка на ADR-014 в п. 1)

- [ ] **Step 1:** ADR-014: формат шифртекста и AAD, ключи и перешифровка, `RevealPartyDetails` и аудит чтения, проекция ПДн в старую базу, канал согласия `otp_session`, отзыв (срок, ручное исполнение до пилота), TOTP и первое подключение, повторная 2FA (5 мин, где проверяется до и после плана 3); цена ошибки каждого решения.
- [ ] **Step 2:** PROGRESS, раздел «План 2б»: что сделано, проверки (числа — с источником), решения с ценой, «Ждёт владельца»: юрист — тексты согласий, канал подтверждения, казахский язык, перечень ПДн (P5), ответственное лицо (P12); исполнение отзыва по всем сервисам — до пилота. Закрыть пункты «Следующая миграция identity (план 2б)».
- [ ] **Step 3:** Run `go vet ./... && go tool golangci-lint run ./... && go tool buf lint && go test ./...` и `npm --prefix apps/web run check`, `npm run v2:up` + smoke — Expected: всё зелёное; память identity в простое ≤ 64 МБ (`docker stats`), записать.
- [ ] **Step 4: Commit** — `docs: итоги плана 2б, ADR-014`.

---

## Порядок исполнения

Задачи идут по номерам. Пуш — после Task 9 (весь Go готов, CI проверяет сервис) и в конце плана.
