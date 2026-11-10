-- +goose Up

-- CHECK не принимает подзапрос, поэтому проверка уникальности элементов — в IMMUTABLE-функции.
-- +goose StatementBegin
CREATE FUNCTION identity_roles_distinct(roles text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT cardinality(roles) = (SELECT count(DISTINCT r) FROM unnest(roles) AS r)
$$;
-- +goose StatementEnd

-- У PUBLIC EXECUTE отзывается при каждой миграции (dbx.Migrate), рабочей роли функция нужна явно:
-- без права CHECK падает при любой вставке или обновлении.
GRANT EXECUTE ON FUNCTION identity_roles_distinct(text[]) TO identity_app;

ALTER TABLE users ADD CONSTRAINT users_roles_distinct CHECK (identity_roles_distinct(roles));
ALTER TABLE sessions ADD CONSTRAINT sessions_active_role_known
    CHECK (active_role IN ('CLIENT', 'EXECUTOR', 'OPERATOR', 'MEASURER'));

-- +goose Down
ALTER TABLE sessions DROP CONSTRAINT sessions_active_role_known;
ALTER TABLE users DROP CONSTRAINT users_roles_distinct;
DROP FUNCTION identity_roles_distinct(text[]);
