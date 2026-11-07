-- Несколько ролей у одного пользователя (ADR-004).
-- User.roles — выданные роли; User.role остаётся ролью по умолчанию при следующем входе (последняя активная).
-- Session.activeRole — роль, в которой человек действует в этой сессии.

ALTER TABLE "Session" ADD COLUMN "activeRole" "Role";

ALTER TABLE "User" ADD COLUMN "roles" "Role"[];
UPDATE "User" SET "roles" = ARRAY["role"];

-- Роль по умолчанию всегда среди выданных (заодно roles не NULL и не пуст:
-- NULL в CHECK считался бы выполненным, поэтому проверка явная).
ALTER TABLE "User" ADD CONSTRAINT "User_role_in_roles"
  CHECK ("roles" IS NOT NULL AND "role" = ANY ("roles"));

-- Оператор не совмещается с другими ролями: его действия — администрирование, а не сделки.
ALTER TABLE "User" ADD CONSTRAINT "User_operator_alone"
  CHECK (NOT ('OPERATOR' = ANY ("roles")) OR "roles" = ARRAY['OPERATOR']::"Role"[]);
