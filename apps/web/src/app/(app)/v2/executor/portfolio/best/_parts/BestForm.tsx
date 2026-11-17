"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Checkbox, List, ListItem, Narrow, PhotoSlot, Section, Stack, StatusChip, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../../_shell/FormError";
import { useClientKey } from "../../../../../_shell/client-key";
import { useActionForm } from "../../../../../_shell/form";
import { LeaveGuard } from "../../../../../_shell/LeaveGuard";
import { saveBestAction } from "../actions";
import { initialSelected, isFull, moveRef, refKey, toggleRef, type BestRef } from "./best-view";

const t = ru.app.masterPortfolio.best;
const FORM = "best-form";

export type BestCandidate = {
  kind: "work" | "deal";
  id: string;
  title: string;
  photo: { src: string; alt: string } | null;
  selected: boolean;
  position: number | null;
};

type Props = { candidates: BestCandidate[]; hiddenDeals: number; max: number; backHref: string; device: Device };

function Thumb({ photo }: { photo: BestCandidate["photo"] }) {
  if (!photo) return null;
  return (
    <div className="w-16 shrink-0">
      <PhotoSlot src={photo.src} alt={photo.alt} ratio="1/1" sizes="64px" />
    </div>
  );
}

/**
 * Выбор лучших работ: сверху выбранные по порядку (стрелки «Выше» и «Ниже» с названием, отметка снимает), ниже — остальные
 * кандидаты. Седьмая отметка недоступна, пока не снята одна из выбранных. «Сохранить» — главное действие; после успеха
 * тост и возврат в портфолио.
 */
export function BestForm({ candidates, hiddenDeals, max, backHref, device }: Props) {
  const router = useRouter();
  const byKey = new Map(candidates.map((c) => [refKey(c), c]));
  const [selected, setSelected] = useState<BestRef[]>(() => initialSelected(candidates));
  const [initial] = useState(() => selected.map(refKey).join(","));
  const [done, setDone] = useState(false);
  const retry = useClientKey();
  const form = useActionForm(saveBestAction, {
    toInput: () => ({ items: selected, clientKey: retry.keyFor(selected) }),
    onSuccess: () => {
      retry.done();
      setDone(true);
      toast(t.saved);
      router.replace(backHref);
    },
  });
  const dirty = selected.map(refKey).join(",") !== initial;
  const full = isFull(selected, max);
  const chosen = new Set(selected.map(refKey));
  const others = candidates.filter((c) => !chosen.has(refKey(c)));

  function submit(event: FormEvent<HTMLFormElement>) {
    if (done) return event.preventDefault();
    form.onSubmit(event);
  }

  const mark = (c: BestCandidate, extra?: ReactNode) => (
    <div className="flex items-center gap-3 px-card py-3">
      <Thumb photo={c.photo} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Checkbox
          name="best"
          label={c.title}
          aria-label={t.pick(c.title)}
          checked={chosen.has(refKey(c))}
          disabled={!chosen.has(refKey(c)) && full}
          onChange={() => setSelected((s) => toggleRef(s, { kind: c.kind, id: c.id }, max))}
        />
        <StatusChip tone="neutral">{t.kind[c.kind]}</StatusChip>
      </div>
      {extra}
    </div>
  );

  return (
    <Narrow>
      <Stack gap="section">
        <form id={FORM} method="post" onSubmit={submit} noValidate>
          <Stack gap="section">
            <p className="text-sub text-muted">{t.counter(selected.length, max)}</p>
            {selected.length > 0 && (
              <Section title={t.chosenTitle}>
                <Card padded={false}>
                  <List>
                    {selected.map((ref, index) => {
                      const c = byKey.get(refKey(ref));
                      if (!c) return null;
                      return (
                        <ListItem key={refKey(ref)}>
                          {mark(
                            c,
                            <div className="flex shrink-0 gap-2">
                              <Button type="button" variant="secondary" size="sm" aria-label={t.up(c.title)} disabled={index === 0} onClick={() => setSelected((s) => moveRef(s, index, "up"))}>
                                <ArrowUp aria-hidden className="size-5" />
                              </Button>
                              <Button type="button" variant="secondary" size="sm" aria-label={t.down(c.title)} disabled={index === selected.length - 1} onClick={() => setSelected((s) => moveRef(s, index, "down"))}>
                                <ArrowDown aria-hidden className="size-5" />
                              </Button>
                            </div>,
                          )}
                        </ListItem>
                      );
                    })}
                  </List>
                </Card>
              </Section>
            )}
            {others.length > 0 && (
              <Section title={t.othersTitle}>
                <Card padded={false}>
                  <List>
                    {others.map((c) => (
                      <ListItem key={refKey(c)}>{mark(c)}</ListItem>
                    ))}
                  </List>
                </Card>
                {full && <p className="text-sub text-muted">{t.limit(max)}</p>}
              </Section>
            )}
            {hiddenDeals > 0 && <p className="text-sub text-muted">{t.hiddenDeals(hiddenDeals)}</p>}
            <FormError error={form.error} />
          </Stack>
        </form>
        <LeaveGuard dirty={!done && dirty} device={device} />
        <ActionDock>
          <Button type="submit" form={FORM} disabled={done} pending={form.pending}>
            {t.submit}
          </Button>
        </ActionDock>
      </Stack>
    </Narrow>
  );
}
