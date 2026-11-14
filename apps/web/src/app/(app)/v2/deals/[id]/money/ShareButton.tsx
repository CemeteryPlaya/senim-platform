"use client";

import { useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, Dialog, Sheet, Stack, TextField, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { outcomeOf } from "../../../../_shell/form";
import { shareDocumentAction } from "./actions";

const t = ru.app.deal.money;
const d = t.shareDialog;

type Link = { url: string; expires: string };

/**
 * «Поделиться» документом: по нажатию выпускает ссылку (действие сервера) и показывает её в окне с кнопкой «Скопировать».
 * Телефон — шторка, компьютер — диалог. Пока ссылка выпускается, второе нажатие не срабатывает.
 */
export function ShareButton({ documentId, name, device }: { documentId: string; name: string; device: Device }) {
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState<Link | null>(null);

  async function share() {
    if (pending) return;
    setPending(true);
    try {
      const outcome = outcomeOf(await shareDocumentAction({ documentId }), window.location);
      if (outcome.kind === "success") setLink(outcome.data);
      else if (outcome.kind === "leave") window.location.assign(outcome.href);
      else toast.error(outcome.error);
    } catch {
      toast.error(d.failed);
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast(d.copied);
    } catch {
      toast.error(d.copyFailed);
    }
  }

  const body = link && (
    <Stack>
      <TextField label={d.field} name="shared-link" value={link.url} readOnly onFocus={(event) => event.currentTarget.select()} />
      <Button onClick={() => void copy()}>{d.copy}</Button>
      <Button variant="quiet" onClick={() => setLink(null)}>
        {d.close}
      </Button>
    </Stack>
  );
  const common = { open: link !== null, onOpenChange: (open: boolean) => !open && setLink(null), title: d.title, ...(link ? { description: d.lead(link.expires) } : {}) };

  return (
    <>
      <Button variant="secondary" pending={pending} aria-label={t.shareNamed(name)} onClick={() => void share()}>
        {t.share}
      </Button>
      {device === "mobile" ? <Sheet {...common}>{body}</Sheet> : <Dialog {...common}>{body}</Dialog>}
    </>
  );
}
