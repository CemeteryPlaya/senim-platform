"use client";

import { useEffect } from "react";
import { ru } from "@/i18n/ru";
import { toast } from "@/kit";

/**
 * Разовый тост «Почта изменена» после подтверждения нового адреса. Убирает `?email=changed` из адреса без перезагрузки,
 * поэтому при обновлении страницы тост не повторяется.
 */
export function EmailChangedToast({ href }: { href: string }) {
  useEffect(() => {
    toast(ru.app.profile.contacts.emailChanged, { id: "email-changed" });
    window.history.replaceState(window.history.state, "", href);
  }, [href]);
  return null;
}
