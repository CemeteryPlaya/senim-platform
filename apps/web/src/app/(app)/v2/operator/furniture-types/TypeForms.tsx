"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, HiddenField, StatusChip, Stack, TextField, toast } from "@/kit";
import { useActionForm } from "../../../_shell/form";
import { FormError } from "../../../_shell/FormError";
import { addFurnitureTypeAction, moveFurnitureTypeAction, renameFurnitureTypeAction, setFurnitureTypeActiveAction } from "./actions";

const t = ru.app.operatorSettings.types;
const ADD_FORM = "add-furniture-type-form";

/**
 * Новый тип в конец справочника: одно поле и главная кнопка экрана. После добавления поле очищается, список обновляется,
 * тост сообщает итог.
 */
export function AddTypeForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const form = useActionForm(addFurnitureTypeAction, {
    formRef,
    onSuccess: () => {
      formRef.current?.reset();
      toast(t.added);
      router.refresh();
    },
  });
  return (
    <>
      <Card>
        <form id={ADD_FORM} ref={formRef} onSubmit={form.onSubmit} noValidate>
          <Stack>
            <TextField label={t.addLabel} name="name" required maxLength={60} autoComplete="off" placeholder={t.addExample} error={form.fieldErrors.name} />
            <FormError error={form.error} atField={Boolean(form.fieldErrors.name)} />
          </Stack>
        </form>
      </Card>
      <ActionDock>
        <Button type="submit" form={ADD_FORM} pending={form.pending}>
          {t.add}
        </Button>
      </ActionDock>
    </>
  );
}

export type TypeRowData = { id: string; name: string; active: boolean; requests: number; position: number; count: number };

type Direction = "up" | "down";

/**
 * Строка справочника: название, «Скрыт», число заявок; порядок (выше, ниже — кнопки с именем типа для диктора),
 * переименование в строке и «Скрыть» или «Показать». Пока идёт одно действие, другие кнопки строки гасятся. После сдвига
 * фокус остаётся на кнопке направления (на краю списка — на противоположной), а тост сообщает новое место.
 */
export function TypeRow({ type }: { type: TypeRowData }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const renameFormRef = useRef<HTMLFormElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const upButton = useRef<HTMLButtonElement>(null);
  const downButton = useRef<HTMLButtonElement>(null);
  const moved = useRef<Direction | null>(null);
  const [direction, setDirection] = useState<Direction | null>(null);
  const first = type.position === 1;
  const last = type.position === type.count;

  const move = useActionForm(moveFurnitureTypeAction, {
    onSuccess: () => router.refresh(),
  });
  const toggle = useActionForm(setFurnitureTypeActiveAction, {
    toInput: (data) => ({ id: String(data.get("id")), active: data.get("active") === "true" }),
    onSuccess: () => {
      toast(type.active ? t.hiddenDone(type.name) : t.shown(type.name));
      router.refresh();
    },
  });
  const rename = useActionForm(renameFurnitureTypeAction, {
    formRef: renameFormRef,
    onSuccess: () => {
      setRenaming(false);
      toast(t.renamed);
      router.refresh();
    },
  });
  const busy = move.pending || toggle.pending || rename.pending;

  // Строка переименования открылась — фокус в поле названия.
  useEffect(() => {
    if (renaming) renameFormRef.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
  }, [renaming]);

  // После сдвига строка стоит на новом месте: фокус — на кнопку того же направления, а у края — на противоположную.
  useEffect(() => {
    const to = moved.current;
    if (to === null) return;
    moved.current = null;
    const same = to === "up" ? upButton.current : downButton.current;
    const other = to === "up" ? downButton.current : upButton.current;
    (same?.disabled ? other : same)?.focus();
    toast(t.moved(type.name, type.position));
  }, [type.position, type.name]);

  const send = (form: { submit: (data: FormData) => Promise<void> }, fields: Record<string, string>) => {
    if (busy) return;
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    void form.submit(data);
  };
  const shift = (to: Direction) => {
    if (busy) return;
    moved.current = to;
    setDirection(to);
    send(move, { id: type.id, direction: to });
  };

  const error = move.error ?? toggle.error ?? (rename.fieldErrors.name ? null : rename.error);

  return (
    <div className="flex flex-col gap-3 px-card py-4">
      {/* Название, «Скрыт» и число заявок — одной строкой; при крупном шрифте число переносится. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 text-headline wrap-break-word text-ink">{type.name}</span>
        {!type.active && <StatusChip tone="neutral">{t.hidden}</StatusChip>}
        <span className="text-sub text-muted">{t.usage(type.requests)}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button ref={upButton} variant="secondary" size="sm" aria-label={t.up(type.name)} disabled={first} pending={move.pending && direction === "up"} onClick={() => shift("up")}>
          <ArrowUp aria-hidden className="size-5" />
        </Button>
        <Button ref={downButton} variant="secondary" size="sm" aria-label={t.down(type.name)} disabled={last} pending={move.pending && direction === "down"} onClick={() => shift("down")}>
          <ArrowDown aria-hidden className="size-5" />
        </Button>
        <Button
          ref={renameButton}
          variant="secondary"
          size="sm"
          aria-expanded={renaming}
          aria-label={t.actionFor(t.rename, type.name)}
          onClick={() => {
            if (busy) return;
            setRenaming((open) => !open);
          }}
        >
          {t.rename}
        </Button>
        <Button
          variant="quiet"
          size="sm"
          pending={toggle.pending}
          aria-label={t.actionFor(type.active ? t.hide : t.show, type.name)}
          onClick={() => send(toggle, { id: type.id, active: String(!type.active) })}
        >
          {type.active ? t.hide : t.show}
        </Button>
      </div>
      {renaming && (
        <form
          ref={renameFormRef}
          onSubmit={rename.onSubmit}
          noValidate
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            setRenaming(false);
            renameButton.current?.focus();
          }}
        >
          <Stack>
            <HiddenField name="id" value={type.id} />
            <TextField
              label={t.renameLabel(type.name)}
              name="name"
              defaultValue={type.name}
              required
              maxLength={60}
              autoComplete="off"
              error={rename.fieldErrors.name}
            />
            <FormError error={rename.error} atField={Boolean(rename.fieldErrors.name)} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="secondary" size="sm" pending={rename.pending}>
                {t.save}
              </Button>
              <Button
                variant="quiet"
                size="sm"
                onClick={() => {
                  setRenaming(false);
                  renameButton.current?.focus();
                }}
              >
                {t.cancel}
              </Button>
            </div>
          </Stack>
        </form>
      )}
      {error && !renaming && <FormError error={error} />}
    </div>
  );
}
