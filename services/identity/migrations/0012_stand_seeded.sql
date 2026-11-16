-- +goose Up

-- Демо-режима больше нет (этап 5 редизайна, решения R2 и R3): признак «демо-персона»
-- становится признаком «создан сидом стенда» (seeded). Смысл тот же, что у is_demo в 0009:
-- - users.seeded ставит только SeedUsers; сид перезаписывает только таких пользователей;
-- - consents.seeded и consent_revocations.seeded заполняет триггер при INSERT из
--   users.seeded (значение из запроса игнорируется) и дальше не меняется;
-- - сброс стенда (ResetStand, вне APP_ENV=prod) удаляет согласия и заявки только по
--   признаку самой записи — функцией владельца identity_purge_seeded_consents.
-- Переименование не трогает строки: уже записанные доказательства остаются как были.
--
-- Демо-вход без кода удалён. Значения 'demo' в sessions.opened_by и consents.channel
-- остаются допустимыми в CHECK — ими помечены уже записанные строки (согласия неизменны), —
-- но новые строки с ними база не принимает (триггер ниже). Действующие демо-сессии
-- отзываются: согласие в них записалось бы каналом, которого больше нет.

ALTER TABLE users RENAME COLUMN is_demo TO seeded;
ALTER TABLE consents RENAME COLUMN is_demo TO seeded;
ALTER TABLE consent_revocations RENAME COLUMN is_demo TO seeded;

UPDATE sessions SET revoked_at = now() WHERE opened_by = 'demo' AND revoked_at IS NULL;

-- Признак сида при вставке — из users, а не из запроса.
-- +goose StatementBegin
CREATE FUNCTION identity_consent_seeded_flag() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.seeded := COALESCE((SELECT u.seeded FROM public.users u WHERE u.id = NEW.user_id), false);
    RETURN NEW;
END
$$;
-- +goose StatementEnd

DROP TRIGGER consents_demo_flag ON consents;
DROP TRIGGER consent_revocations_demo_flag ON consent_revocations;
DROP FUNCTION identity_consent_demo_flag();
CREATE TRIGGER consents_seeded_flag BEFORE INSERT ON consents
    FOR EACH ROW EXECUTE FUNCTION identity_consent_seeded_flag();
CREATE TRIGGER consent_revocations_seeded_flag BEFORE INSERT ON consent_revocations
    FOR EACH ROW EXECUTE FUNCTION identity_consent_seeded_flag();

-- Заявка: решение оператора меняет статус, но не владельца и не признак сида.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION identity_revocation_identity_fixed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.seeded IS DISTINCT FROM OLD.seeded OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'revocation_immutable: владелец и признак сида заявки не меняются';
    END IF;
    RETURN NEW;
END
$$;
-- +goose StatementEnd

-- Удаление согласия — только функцией очистки стенда и только записи сида (по seeded строки).
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION identity_consents_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE'
        AND OLD.revoked_at IS NULL
        AND NEW.revoked_at IS NOT NULL
        AND (to_jsonb(NEW) - 'revoked_at') = (to_jsonb(OLD) - 'revoked_at') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE'
        AND current_setting('identity.stand_purge', true) = 'on'
        AND OLD.seeded THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'consent_immutable: запись согласия не меняется (%)', TG_OP;
END
$$;
-- +goose StatementEnd

DROP FUNCTION identity_purge_demo_consents();

-- +goose StatementBegin
CREATE FUNCTION identity_purge_seeded_consents() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    n bigint;
BEGIN
    PERFORM set_config('identity.stand_purge', 'on', true);
    DELETE FROM consent_revocations WHERE seeded;
    DELETE FROM consents WHERE seeded;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('identity.stand_purge', 'off', true);
    RETURN n;
END
$$;
-- +goose StatementEnd

-- Выведенное из употребления значение столбца (аргументы триггера: столбец, значение) в
-- новую строку не пишется — 23514, как нарушение CHECK. Старые строки с ним остаются.
-- +goose StatementBegin
CREATE FUNCTION identity_reject_retired_value() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF to_jsonb(NEW) ->> TG_ARGV[0] = TG_ARGV[1] THEN
        RAISE EXCEPTION 'retired_value: %.% = % больше не записывается', TG_TABLE_NAME, TG_ARGV[0], TG_ARGV[1]
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER sessions_opened_by_retired BEFORE INSERT OR UPDATE OF opened_by ON sessions
    FOR EACH ROW EXECUTE FUNCTION identity_reject_retired_value('opened_by', 'demo');
CREATE TRIGGER consents_channel_retired BEFORE INSERT OR UPDATE OF channel ON consents
    FOR EACH ROW EXECUTE FUNCTION identity_reject_retired_value('channel', 'demo');

-- У PUBLIC EXECUTE отзывается при каждой миграции (dbx.Migrate): рабочей роли — явно.
REVOKE ALL ON FUNCTION identity_purge_seeded_consents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity_purge_seeded_consents() TO identity_app;
GRANT EXECUTE ON FUNCTION identity_consent_seeded_flag() TO identity_app;
GRANT EXECUTE ON FUNCTION identity_reject_retired_value() TO identity_app;

-- +goose Down
-- Отозванные демо-сессии не восстанавливаются.
DROP TRIGGER consents_channel_retired ON consents;
DROP TRIGGER sessions_opened_by_retired ON sessions;
DROP FUNCTION identity_reject_retired_value();
DROP FUNCTION identity_purge_seeded_consents();

ALTER TABLE consent_revocations RENAME COLUMN seeded TO is_demo;
ALTER TABLE consents RENAME COLUMN seeded TO is_demo;
ALTER TABLE users RENAME COLUMN seeded TO is_demo;

-- +goose StatementBegin
CREATE FUNCTION identity_consent_demo_flag() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.is_demo := COALESCE((SELECT u.is_demo FROM public.users u WHERE u.id = NEW.user_id), false);
    RETURN NEW;
END
$$;
-- +goose StatementEnd

DROP TRIGGER consent_revocations_seeded_flag ON consent_revocations;
DROP TRIGGER consents_seeded_flag ON consents;
DROP FUNCTION identity_consent_seeded_flag();
CREATE TRIGGER consents_demo_flag BEFORE INSERT ON consents
    FOR EACH ROW EXECUTE FUNCTION identity_consent_demo_flag();
CREATE TRIGGER consent_revocations_demo_flag BEFORE INSERT ON consent_revocations
    FOR EACH ROW EXECUTE FUNCTION identity_consent_demo_flag();

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION identity_revocation_identity_fixed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.is_demo IS DISTINCT FROM OLD.is_demo OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'revocation_immutable: владелец и признак демо заявки не меняются';
    END IF;
    RETURN NEW;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION identity_consents_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE'
        AND OLD.revoked_at IS NULL
        AND NEW.revoked_at IS NOT NULL
        AND (to_jsonb(NEW) - 'revoked_at') = (to_jsonb(OLD) - 'revoked_at') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE'
        AND current_setting('identity.demo_purge', true) = 'on'
        AND OLD.is_demo THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'consent_immutable: запись согласия не меняется (%)', TG_OP;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION identity_purge_demo_consents() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    n bigint;
BEGIN
    PERFORM set_config('identity.demo_purge', 'on', true);
    DELETE FROM consent_revocations WHERE is_demo;
    DELETE FROM consents WHERE is_demo;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('identity.demo_purge', 'off', true);
    RETURN n;
END
$$;
-- +goose StatementEnd

REVOKE ALL ON FUNCTION identity_purge_demo_consents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity_purge_demo_consents() TO identity_app;
GRANT EXECUTE ON FUNCTION identity_consent_demo_flag() TO identity_app;
