-- +goose Up

-- Роль ADMIN — администратор площадки (спека админки, 2026-11-20): сотрудник, как оператор
-- и замерщик, — не совмещается ни с какой другой ролью; второй фактор обязателен (проверяет
-- код сервиса). Ограничения 0002 и 0003 пересоздаются с теми же именами.

ALTER TABLE users DROP CONSTRAINT users_roles_known;
ALTER TABLE users ADD CONSTRAINT users_roles_known CHECK (
    cardinality(roles) >= 1
    AND roles <@ ARRAY['CLIENT', 'EXECUTOR', 'OPERATOR', 'MEASURER', 'ADMIN']
);

-- Оператор, замерщик площадки и администратор не совмещаются ни с какой другой ролью.
ALTER TABLE users DROP CONSTRAINT users_staff_role_alone;
ALTER TABLE users ADD CONSTRAINT users_staff_role_alone CHECK (
    NOT (roles && ARRAY['OPERATOR', 'MEASURER', 'ADMIN']) OR cardinality(roles) = 1
);

ALTER TABLE sessions DROP CONSTRAINT sessions_active_role_known;
ALTER TABLE sessions ADD CONSTRAINT sessions_active_role_known
    CHECK (active_role IN ('CLIENT', 'EXECUTOR', 'OPERATOR', 'MEASURER', 'ADMIN'));

-- +goose Down
-- Откат не удаляет данные: пока есть пользователи или сессии с ролью ADMIN, он падает на
-- проверке ограничений — сначала их нужно убрать вручную.

ALTER TABLE sessions DROP CONSTRAINT sessions_active_role_known;
ALTER TABLE sessions ADD CONSTRAINT sessions_active_role_known
    CHECK (active_role IN ('CLIENT', 'EXECUTOR', 'OPERATOR', 'MEASURER'));

ALTER TABLE users DROP CONSTRAINT users_staff_role_alone;
ALTER TABLE users ADD CONSTRAINT users_staff_role_alone CHECK (
    NOT (roles && ARRAY['OPERATOR', 'MEASURER']) OR cardinality(roles) = 1
);

ALTER TABLE users DROP CONSTRAINT users_roles_known;
ALTER TABLE users ADD CONSTRAINT users_roles_known CHECK (
    cardinality(roles) >= 1
    AND roles <@ ARRAY['CLIENT', 'EXECUTOR', 'OPERATOR', 'MEASURER']
);
