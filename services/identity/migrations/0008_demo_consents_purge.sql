-- +goose Up

-- Сброс демо-стенда (ResetDemo, только DEMO_MODE) убирает согласия и заявки на отзыв
-- демо-пользователей: иначе повторный прогон e2e видит прежнюю открытую заявку.
--
-- Записи согласий защищены триггером (0007) и от владельца, у рабочей роли нет DELETE.
-- Удаляет их только функция identity_purge_demo_consents: SECURITY DEFINER (права
-- владельца), фиксированный search_path, удаляет строки только пользователей с is_demo и на
-- время своей работы ставит локальную для транзакции настройку identity.demo_purge.
-- Триггер пропускает DELETE, только если настройка включена И строка принадлежит
-- демо-пользователю.
--
-- ВНИМАНИЕ (исправлено в 0009): проверка по текущему users.is_demo ненадёжна — у рабочей
-- роли есть UPDATE на users, и, пометив настоящего человека демо, она удаляла бы его
-- согласия через эту функцию. 0009 переносит признак демо в саму запись согласия и заявки.

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

-- +goose StatementBegin
CREATE FUNCTION identity_purge_demo_consents() RETURNS bigint
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

-- У PUBLIC EXECUTE отзывается при каждой миграции (dbx.Migrate): рабочей роли — явно.
REVOKE ALL ON FUNCTION identity_purge_demo_consents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity_purge_demo_consents() TO identity_app;

-- +goose Down
DROP FUNCTION identity_purge_demo_consents();
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
    RAISE EXCEPTION 'consent_immutable: запись согласия не меняется (%)', TG_OP;
END
$$;
-- +goose StatementEnd
