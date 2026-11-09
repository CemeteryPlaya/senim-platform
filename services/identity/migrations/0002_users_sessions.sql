-- +goose Up

-- Срок хранения этих таблиц ограничен: рабочая роль чистит их сама (Task 10).
-- senim:app-delete sessions
-- senim:app-delete otp_codes
-- senim:app-delete rate_limits

CREATE TABLE users (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone        text NOT NULL UNIQUE,
    roles        text[] NOT NULL,
    default_role text NOT NULL,
    is_demo      boolean NOT NULL DEFAULT false,
    blocked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_roles_known CHECK (
        cardinality(roles) >= 1
        AND roles <@ ARRAY['CLIENT', 'EXECUTOR', 'OPERATOR', 'MEASURER']
    ),
    CONSTRAINT users_default_role_granted CHECK (default_role = ANY (roles)),
    -- Оператор и замерщик площадки не совмещаются ни с какой другой ролью.
    CONSTRAINT users_staff_role_alone CHECK (
        NOT (roles && ARRAY['OPERATOR', 'MEASURER']) OR cardinality(roles) = 1
    )
);

CREATE TABLE sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash   bytea NOT NULL UNIQUE,
    user_id      uuid NOT NULL REFERENCES users (id),
    active_role  text NOT NULL,
    user_agent   text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE otp_codes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone       text NOT NULL,
    code_hash   bytea NOT NULL,
    attempts    integer NOT NULL DEFAULT 0,
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_created_idx ON otp_codes (phone, created_at DESC);

CREATE TABLE rate_limits (
    key          text PRIMARY KEY,
    window_start timestamptz NOT NULL,
    count        integer NOT NULL
);

-- +goose Down
DROP TABLE rate_limits;
DROP TABLE otp_codes;
DROP TABLE sessions;
DROP TABLE users;
