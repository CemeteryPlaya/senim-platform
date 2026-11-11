-- +goose Up

-- Как открыта сессия (финальное ревью плана 2б, Ruling AL): otp — входом по коду из SMS
-- (VerifyOtp), demo — демо-входом без кода (StartDemoSession, только DEMO_MODE).
--
-- Согласие пишет канал по способу открытия сессии: otp_session — только в сессии, открытой
-- кодом (это и утверждает канал: человек подтвердил владение номером), demo — в демо-сессии.
-- Раньше любое согласие в сессии записывалось как otp_session, в том числе в демо-сессии,
-- открытой без кода, — доказательство утверждало то, чего не было.
--
-- Уже открытые сессии: способ не записан. Сессии демо-пользователей помечаются demo, прочие —
-- otp (у настоящего пользователя другого способа входа нет). Демо-пользователь мог войти и
-- кодом — тогда его прежняя сессия получает более слабый канал demo, а не наоборот.
ALTER TABLE sessions ADD COLUMN opened_by text;
UPDATE sessions s SET opened_by = CASE WHEN u.is_demo THEN 'demo' ELSE 'otp' END
FROM users u WHERE u.id = s.user_id;
ALTER TABLE sessions
    ALTER COLUMN opened_by SET NOT NULL,
    ADD CONSTRAINT sessions_opened_by CHECK (opened_by IN ('otp', 'demo'));

-- Канал demo: согласие в демо-сессии, session_id — эта сессия (как у otp_session). Триггеры
-- неизменности и признака демо не меняются: меняются только допустимые значения канала.
ALTER TABLE consents
    DROP CONSTRAINT consents_channel_check,
    ADD CONSTRAINT consents_channel_check CHECK (channel IN ('otp_session', 'demo', 'seed')),
    DROP CONSTRAINT consents_session,
    ADD CONSTRAINT consents_session CHECK ((channel IN ('otp_session', 'demo')) = (session_id IS NOT NULL));

-- +goose Down
-- Записи с каналом demo не удаляются (доказательства неизменны): прежние ограничения
-- возвращаются без проверки уже записанных строк.
ALTER TABLE consents
    DROP CONSTRAINT consents_session,
    ADD CONSTRAINT consents_session CHECK ((channel = 'otp_session') = (session_id IS NOT NULL)) NOT VALID,
    DROP CONSTRAINT consents_channel_check,
    ADD CONSTRAINT consents_channel_check CHECK (channel IN ('otp_session', 'seed')) NOT VALID;
ALTER TABLE sessions DROP COLUMN opened_by;
