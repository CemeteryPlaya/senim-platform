"use client";

import { ru } from "@/i18n/ru";
import { Button, ConfirmDialog, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { logoutEverywhere } from "./session-actions";

const t = ru.app.profile.logoutEverywhere;

/**
 * «Выйти на всех устройствах» внизу профиля: тихая кнопка по левой линии заголовков и карточек (`flush`) и окно подтверждения с последствиями (необратимо для других
 * устройств). Отказ identity — тостом, окно остаётся открытым (повтор); сбой связи показывает само окно. После выхода действие
 * ведёт на вход v2 (`redirect` в действии).
 */
export function LogoutEverywhere({ device }: { device: Device }) {
  return (
    <ConfirmDialog
      device={device}
      title={t.title}
      description={t.description}
      confirmLabel={t.confirm}
      tone="danger"
      trigger={
        <Button variant="quiet" size="sm" flush>
          {t.action}
        </Button>
      }
      onConfirm={async () => {
        const result = await logoutEverywhere({});
        if (!result.ok) {
          toast.error(result.error);
          return false;
        }
      }}
    />
  );
}
