"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { ru } from "@/i18n/ru";
import { Alert, Button, ButtonLink, Modal } from "@/ui";
import { deleteWork, setWorkPublished } from "./actions";

const t = ru.companies.portfolio;

/** Кнопки под карточкой своей работы: изменить, опубликовать/скрыть, удалить (с подтверждением). */
export function WorkActions({ id, title, published }: { id: string; title: string; published: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      after?.();
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/executor/portfolio/${id}`} variant="secondary" icon={<Pencil />} aria-label={`${t.edit}: ${title}`}>
          {t.edit}
        </ButtonLink>
        <Button
          variant="soft"
          icon={published ? <EyeOff /> : <Eye />}
          loading={pending && !confirming}
          onClick={() => run(() => setWorkPublished({ id, published: !published }))}
          aria-label={`${published ? t.unpublish : t.publish}: ${title}`}
        >
          {published ? t.unpublish : t.publish}
        </Button>
        <Button variant="ghost" icon={<Trash2 />} onClick={() => setConfirming(true)} aria-label={`${t.delete}: ${title}`}>
          {t.delete}
        </Button>
      </div>
      {error && !confirming && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t.deleteConfirm.title}
        description={t.deleteConfirm.text}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {ru.common.actions.cancel}
            </Button>
            <Button variant="danger" loading={pending} onClick={() => run(() => deleteWork({ id }), () => setConfirming(false))}>
              {t.deleteConfirm.confirm}
            </Button>
          </>
        }
      >
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
      </Modal>
    </div>
  );
}
