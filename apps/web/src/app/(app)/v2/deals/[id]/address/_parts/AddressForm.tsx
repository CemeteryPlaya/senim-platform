"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Narrow, PageTitle, Stack, TextField, toast } from "@/kit";
import { LIMITS, type GeoPoint } from "@/modules/requests/client";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../../_shell/FormError";
import { useActionForm } from "../../../../../_shell/form";
import { LeaveGuard } from "../../../../../_shell/LeaveGuard";
import { saveDealAddressAction } from "../actions";
import { PointField } from "./PointField";

const t = ru.app.deal.address;
const FORM = "deal-address-form";

type Props = {
  dealId: string;
  dealTitle: string;
  backHref: string;
  /** Город сделки (из заявки): по нему «Найти по адресу» ищет точку. */
  city: string;
  initial: { address: string; location: GeoPoint | null };
  device: Device;
};

/**
 * Адрес сделки: строка адреса и необязательная точка на карте. «Сохранить адрес» — главное действие; после успеха — тост и
 * карточка сделки. Повтор с тем же адресом модуль не записывает второй раз.
 */
export function AddressForm({ dealId, dealTitle, backHref, city, initial, device }: Props) {
  const router = useRouter();
  const [address, setAddress] = useState(initial.address);
  const [location, setLocation] = useState<GeoPoint | null>(initial.location);
  const [done, setDone] = useState(false);
  const form = useActionForm(saveDealAddressAction, {
    toInput: () => ({ dealId, address, location }),
    onSuccess: () => {
      setDone(true);
      toast(t.saved);
      router.replace(backHref);
    },
  });
  const dirty = address !== initial.address || JSON.stringify(location) !== JSON.stringify(initial.location);
  const e = form.fieldErrors;

  function submit(event: FormEvent<HTMLFormElement>) {
    if (done) return event.preventDefault();
    form.onSubmit(event);
  }

  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} back={{ href: backHref, label: dealTitle }} lead={t.lead} />
        <Card>
          <form id={FORM} method="post" onSubmit={submit} noValidate>
            <Stack gap="section">
              <TextField
                label={t.field}
                name="address"
                aria-required
                autoComplete="street-address"
                maxLength={LIMITS.address}
                value={address}
                onChange={(ev) => setAddress(ev.target.value)}
                {...(e.address ? { error: e.address } : {})}
              />
              <PointField value={location} onChange={setLocation} city={city} address={address} device={device} />
              {e.location && (
                <p role="alert" className="text-sub text-danger">
                  {e.location}
                </p>
              )}
              <FormError error={form.error} />
            </Stack>
          </form>
        </Card>
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
