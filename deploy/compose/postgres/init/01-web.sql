-- База legacy-приложения web (Prisma 7). Пишется руками, tools/dbinit её не генерирует.
-- Пароль совпадает с WEB_DB_PASSWORD в dev.vars (проверяет tools/dbinit/main_test.go).
-- Роль web — владелец своей базы: prisma migrate deploy выполняется ею (сервис web-migrate).
\set ON_ERROR_STOP on
CREATE ROLE web LOGIN PASSWORD 'dev-web' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE web OWNER web;
REVOKE ALL ON DATABASE web FROM PUBLIC;
GRANT CONNECT ON DATABASE web TO web;
\connect web
ALTER SCHEMA public OWNER TO web;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
