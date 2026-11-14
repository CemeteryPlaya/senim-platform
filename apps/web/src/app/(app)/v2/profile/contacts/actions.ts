"use server";

import { z } from "zod";
import { instagramField, requireUser, updateContacts } from "@/modules/identity";
import { action } from "@/platform/action";

/**
 * Instagram своего профиля. Схема — правило модуля (без «@», латиница, цифры, точка, подчёркивание; пусто — не указан),
 * затем `requireUser` и модуль. Почта здесь НЕ передаётся: модуль оставляет прежний подтверждённый адрес, поэтому
 * сохранение Instagram не снимает подтверждение (смена адреса идёт отдельным экраном с кодом). Пользователь берётся из
 * сессии, id в запросе нет; тот же Instagram повторно — без записи (повтор безопасен).
 */
export const saveContactsAction = action("app.profile.saveContacts", z.strictObject({ instagram: instagramField }), async ({ instagram }) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  const saved = await updateContacts(user, { instagram: instagram ?? "" });
  return { instagram: saved.instagram };
});
