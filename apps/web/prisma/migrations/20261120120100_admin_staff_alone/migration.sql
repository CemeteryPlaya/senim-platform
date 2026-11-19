-- Администратор — сотрудник, как оператор и замерщик: роль не совмещается с другими (как users_staff_role_alone в identity).
ALTER TABLE "User" DROP CONSTRAINT "User_staff_alone";
ALTER TABLE "User" ADD CONSTRAINT "User_staff_alone" CHECK (
  (NOT ('OPERATOR' = ANY ("roles")) OR "roles" = ARRAY['OPERATOR']::"Role"[])
  AND (NOT ('MEASURER' = ANY ("roles")) OR "roles" = ARRAY['MEASURER']::"Role"[])
  AND (NOT ('ADMIN' = ANY ("roles")) OR "roles" = ARRAY['ADMIN']::"Role"[])
);
