-- +goose Up

-- Согласия (план 2б, правовое исследование A.2 и A.8): на обработку ПДн и на передачу
-- данных банку-партнёру по сделке. Запись — доказательство: кто (user_id), когда
-- (granted_at), на какой текст (version и SHA-256 показанного текста), на какие цели и
-- каким способом (channel: otp_session — в сессии, открытой входом по коду из SMS,
-- session_id — эта сессия; seed — сид демо-стенда). Запись не меняется и не удаляется
-- (триггер ниже, и у рабочей роли нет DELETE): позволено только один раз отметить отзыв
-- (revoked_at из NULL). Новая версия текста — новая запись.
--
-- session_id без внешнего ключа: сессии чистятся по сроку хранения, доказательство остаётся.
CREATE TABLE consents (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users (id),
    kind         text NOT NULL CHECK (kind IN ('PD_PROCESSING', 'BANK_TRANSFER')),
    version      text NOT NULL CHECK (version ~ '^[A-Za-z0-9.-]{1,32}$'),
    text_sha256  bytea NOT NULL CHECK (length(text_sha256) = 32),
    purposes     text[] NOT NULL,
    reference_id text NOT NULL DEFAULT '',
    channel      text NOT NULL CHECK (channel IN ('otp_session', 'seed')),
    session_id   uuid,
    granted_at   timestamptz NOT NULL DEFAULT now(),
    revoked_at   timestamptz,
    -- Согласие на ПДн — общее; передача банку — к сделке (reference_id обязателен).
    CONSTRAINT consents_reference CHECK ((kind = 'PD_PROCESSING') = (reference_id = '')),
    -- Сессия указана ровно у согласия, данного в сессии.
    CONSTRAINT consents_session CHECK ((channel = 'otp_session') = (session_id IS NOT NULL)),
    CONSTRAINT consents_revoked_after_granted CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

-- Одно действующее согласие на вид, версию и предмет; отозванные копятся.
CREATE UNIQUE INDEX consents_active_key ON consents (user_id, kind, version, reference_id) WHERE revoked_at IS NULL;
-- HasConsents: кто из участников сделки дал согласие.
CREATE INDEX consents_active_reference_idx ON consents (kind, reference_id) WHERE revoked_at IS NULL;

-- Неизменность записи-доказательства: UPDATE разрешён только как отметка отзыва (revoked_at
-- из NULL в значение, остальные столбцы те же), DELETE и TRUNCATE запрещены — и владельцу.
-- +goose StatementBegin
CREATE FUNCTION identity_consents_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE'
        AND OLD.revoked_at IS NULL
        AND NEW.revoked_at IS NOT NULL
        AND (to_jsonb(NEW) - 'revoked_at') = (to_jsonb(OLD) - 'revoked_at') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'consent_immutable: запись согласия не меняется (%)', TG_OP;
END
$$;
-- +goose StatementEnd

-- У PUBLIC EXECUTE отзывается при каждой миграции (dbx.Migrate): рабочей роли — явно.
GRANT EXECUTE ON FUNCTION identity_consents_immutable() TO identity_app;

CREATE TRIGGER consents_immutable_row BEFORE UPDATE OR DELETE ON consents
    FOR EACH ROW EXECUTE FUNCTION identity_consents_immutable();
CREATE TRIGGER consents_immutable_truncate BEFORE TRUNCATE ON consents
    FOR EACH STATEMENT EXECUTE FUNCTION identity_consents_immutable();

-- Заявки на отзыв согласия (ст. 8 п. 7 Закона № 94-V): в течение 15 рабочих дней обработку
-- прекращают (COMPLETED) или дают мотивированный отказ (REFUSED, причина обязательна).
-- due_at — срок по рабочим дням Алматы. Решает оператор (decided_by). Одна открытая
-- заявка на пользователя и вид. Рабочая роль строки не удаляет.
CREATE TABLE consent_revocations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users (id),
    kind         text NOT NULL CHECK (kind IN ('PD_PROCESSING', 'BANK_TRANSFER')),
    requested_at timestamptz NOT NULL,
    due_at       timestamptz NOT NULL,
    status       text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'COMPLETED', 'REFUSED')),
    decided_at   timestamptz,
    decided_by   uuid REFERENCES users (id),
    reason       text,
    CONSTRAINT consent_revocations_due CHECK (due_at > requested_at),
    -- Решение — с датой и автором; открытая заявка — без них.
    CONSTRAINT consent_revocations_decided CHECK (
        (status = 'REQUESTED') = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL)
    ),
    -- Причина — только у отказа и у отказа обязательна.
    CONSTRAINT consent_revocations_reason CHECK ((status = 'REFUSED') = (reason IS NOT NULL))
);
CREATE UNIQUE INDEX consent_revocations_open ON consent_revocations (user_id, kind) WHERE status = 'REQUESTED';
CREATE INDEX consent_revocations_queue_idx ON consent_revocations (due_at) WHERE status = 'REQUESTED';

-- +goose Down
DROP TABLE consent_revocations;
DROP TABLE consents;
DROP FUNCTION identity_consents_immutable();
