"use client";

import { ru } from "@/i18n/ru";
import { ActionDock, Button, HiddenField } from "@/kit";
import { FormError } from "../../_shell/FormError";
import { useActionForm } from "../../_shell/form";
import { switchRoleAction } from "./actions";

const FORM = "switch-role-form";

/** Кнопка переключения — главное действие экрана (в доке на телефоне). Роль и возврат уходят скрытыми полями. */
export function SwitchRoleForm({ role, returnTo }: { role: "CLIENT" | "EXECUTOR"; returnTo: string | null }) {
  const form = useActionForm(switchRoleAction);
  return (
    <>
      <form id={FORM} method="post" onSubmit={form.onSubmit} noValidate>
        <HiddenField name="role" value={role} />
        <HiddenField name="returnTo" value={returnTo ?? ""} />
        <FormError error={form.error} />
      </form>
      <ActionDock>
        <Button type="submit" form={FORM} pending={form.pending}>
          {ru.app.profile.switchRole.action[role]}
        </Button>
      </ActionDock>
    </>
  );
}
