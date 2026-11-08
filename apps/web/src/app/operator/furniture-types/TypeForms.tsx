"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ru } from "@/i18n/ru";
import { Button, Input, StatusBadge } from "@/ui";
import { FormStatus } from "../_components/FormStatus";
import { useActionForm } from "../_components/useActionForm";
import { addFurnitureTypeAction, moveFurnitureTypeAction, renameFurnitureTypeAction, setFurnitureTypeActiveAction } from "./actions";

const t = ru.operator.types;

export function AddTypeForm() {
  const form = useActionForm(addFurnitureTypeAction, { reset: true });
  return (
    <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex-1">
        <Input label={t.addLabel} hint={t.addHint} name="name" required maxLength={60} error={form.fieldError("name")} />
      </div>
      <Button type="submit" loading={form.pending} className="sm:mt-8">
        {t.add}
      </Button>
      <FormStatus error={form.error} />
    </form>
  );
}

type TypeRow = { id: string; name: string; active: boolean; requests: number; first: boolean; last: boolean };

/** Строка справочника: порядок, переименование, скрыть/показать. Кнопки подписаны для диктора по названию типа. */
export function TypeItem({ type }: { type: TypeRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [renaming, setRenaming] = useState(false);
  const rename = useActionForm(renameFurnitureTypeAction, { onSuccess: () => setRenaming(false) });

  const run = (call: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      const result = await call();
      setError(result.ok ? undefined : result.error);
      if (result.ok) router.refresh();
    });

  return (
    <li className="flex flex-col gap-3 border-b border-line py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 text-lg font-semibold break-words text-ink">{type.name}</span>
        {!type.active && <StatusBadge tone="neutral">{t.hidden}</StatusBadge>}
        <span className="text-sm text-muted">{t.usage(type.requests)}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          aria-label={t.up(type.name)}
          disabled={type.first || pending}
          onClick={() => run(() => moveFurnitureTypeAction({ id: type.id, direction: "up" }))}
          icon={<ArrowUp />}
        />
        <Button
          variant="ghost"
          aria-label={t.down(type.name)}
          disabled={type.last || pending}
          onClick={() => run(() => moveFurnitureTypeAction({ id: type.id, direction: "down" }))}
          icon={<ArrowDown />}
        />
        <Button variant="secondary" aria-expanded={renaming} onClick={() => setRenaming((v) => !v)}>
          {t.rename}
        </Button>
        <Button variant="soft" loading={pending} onClick={() => run(() => setFurnitureTypeActiveAction({ id: type.id, active: !type.active }))}>
          {type.active ? t.hide : t.show}
        </Button>
      </div>
      {renaming && (
        <form onSubmit={rename.onSubmit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <input type="hidden" name="id" value={type.id} />
          <div className="flex-1">
            <Input label={t.renameLabel(type.name)} name="name" defaultValue={type.name} required maxLength={60} error={rename.fieldError("name")} />
          </div>
          {/* Обводка: заливная кнопка экрана — «Добавить» вверху, она одна. */}
          <Button type="submit" variant="secondary" loading={rename.pending} className="sm:mt-8">
            {t.save}
          </Button>
        </form>
      )}
      <FormStatus error={error ?? rename.error} />
    </li>
  );
}
