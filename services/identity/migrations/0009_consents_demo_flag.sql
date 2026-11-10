-- +goose Up

-- Признак демо — в самой записи согласия и заявки (ревью Task 9, раунд 2).
--
-- В 0008 удаление при сбросе демо проверяло текущий users.is_demo. У рабочей роли есть
-- UPDATE на users, поэтому «UPDATE users SET is_demo = true …» и вызов
-- identity_purge_demo_consents стирали доказательство согласия настоящего человека (и в
-- prod: функция не знает про DEMO_MODE). Комментарий 0008 о том, что настройка
-- identity.demo_purge рабочей роли ничего не даёт, был неверен: через функцию она получала
-- удаление строк любого пользователя, которого сама пометила демо.
--
-- Теперь:
-- - consents.is_demo и consent_revocations.is_demo заполняет триггер при INSERT из
--   users.is_demo (значение из запроса игнорируется) и дальше не меняется: у consents —
--   тем же триггером неизменности (сравнение всей строки, кроме revoked_at), у
--   consent_revocations — отдельным триггером на is_demo и user_id;
-- - триггер удаления и функция очистки смотрят на is_demo записи, а не на users: пометка
--   пользователя демо задним числом уже записанные согласия не открывает для удаления;
-- - SeedUsers не поднимает is_demo существующего пользователя с false на true (отказ в
--   сервисе), так что сид с телефоном настоящего человека его записи демо не делает.
-- Остаётся: согласие, данное после того, как рабочая роль пометила пользователя демо,
-- запишется демо — защита касается уже записанных доказательств.

ALTER TABLE consents ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE consent_revocations ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

-- Уже записанные строки: признак по пользователю на момент миграции (до неё признака не
-- было). Триггер неизменности на время заполнения выключается — в той же транзакции.
ALTER TABLE consents DISABLE TRIGGER consents_immutable_row;
UPDATE consents c SET is_demo = u.is_demo FROM users u WHERE u.id = c.user_id AND u.is_demo;
ALTER TABLE consents ENABLE TRIGGER consents_immutable_row;
UPDATE consent_revocations r SET is_demo = u.is_demo FROM users u WHERE u.id = r.user_id AND u.is_demo;

-- Признак демо при вставке — из users, а не из запроса.
-- +goose StatementBegin
CREATE FUNCTION identity_consent_demo_flag() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.is_demo := COALESCE((SELECT u.is_demo FROM public.users u WHERE u.id = NEW.user_id), false);
    RETURN NEW;
END
$$;
-- +goose StatementEnd

-- Заявка: решение оператора меняет статус, но не владельца и не признак демо.
-- +goose StatementBegin
CREATE FUNCTION identity_revocation_identity_fixed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.is_demo IS DISTINCT FROM OLD.is_demo OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'revocation_immutable: владелец и признак демо заявки не меняются';
    END IF;
    RETURN NEW;
END
$$;
-- +goose StatementEnd

-- Удаление согласия — только функцией очистки и только демо-записи (по is_demo строки).
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
CREATE OR REPLACE FUNCTION identity_purge_demo_consents() RETURNS bigint
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

-- У PUBLIC EXECUTE отзывается при каждой миграции (dbx.Migrate): рабочей роли — явно.
GRANT EXECUTE ON FUNCTION identity_consent_demo_flag() TO identity_app;
GRANT EXECUTE ON FUNCTION identity_revocation_identity_fixed() TO identity_app;

CREATE TRIGGER consents_demo_flag BEFORE INSERT ON consents
    FOR EACH ROW EXECUTE FUNCTION identity_consent_demo_flag();
CREATE TRIGGER consent_revocations_demo_flag BEFORE INSERT ON consent_revocations
    FOR EACH ROW EXECUTE FUNCTION identity_consent_demo_flag();
CREATE TRIGGER consent_revocations_identity_fixed BEFORE UPDATE ON consent_revocations
    FOR EACH ROW EXECUTE FUNCTION identity_revocation_identity_fixed();

-- +goose Down
DROP TRIGGER consent_revocations_identity_fixed ON consent_revocations;
DROP TRIGGER consent_revocations_demo_flag ON consent_revocations;
DROP TRIGGER consents_demo_flag ON consents;
DROP FUNCTION identity_revocation_identity_fixed();
DROP FUNCTION identity_consent_demo_flag();
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION identity_purge_demo_consents() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    n bigint;
BEGIN
    PERFORM set_config('identity.demo_purge', 'on', true);
    DELETE FROM consent_revocations r USING users u WHERE r.user_id = u.id AND u.is_demo;
    DELETE FROM consents c USING users u WHERE c.user_id = u.id AND u.is_demo;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('identity.demo_purge', 'off', true);
    RETURN n;
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
        AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.user_id AND u.is_demo) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'consent_immutable: запись согласия не меняется (%)', TG_OP;
END
$$;
-- +goose StatementEnd
ALTER TABLE consent_revocations DROP COLUMN is_demo;
ALTER TABLE consents DROP COLUMN is_demo;
