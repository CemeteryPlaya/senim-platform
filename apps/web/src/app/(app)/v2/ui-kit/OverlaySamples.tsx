"use client";

import { ru } from "@/i18n/ru";
import { Button, ConfirmDialog, Dialog, Sheet, toast } from "@/kit";
import type { Device } from "@/platform/device";

const t = ru.app.kit.showcase.overlays;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Живые примеры накладок: нужен клик, поэтому клиентский компонент. */
export function OverlaySamples({ device }: { device: Device }) {
  return (
    <div className="flex flex-wrap gap-3">
      <Sheet trigger={<Button variant="secondary">{t.sheetOpen}</Button>} title={t.sheetTitle} description={t.sheetBody} />
      <Dialog trigger={<Button variant="secondary">{t.dialogOpen}</Button>} title={t.dialogTitle} description={t.dialogBody} />
      <ConfirmDialog
        device={device}
        trigger={<Button variant="secondary">{t.confirmOpen}</Button>}
        title={t.confirmTitle}
        description={t.confirmBody}
        confirmLabel={t.confirmLabel}
        onConfirm={() => wait(1000)}
      />
      <ConfirmDialog
        device={device}
        tone="danger"
        trigger={<Button variant="danger">{t.confirmDangerOpen}</Button>}
        title={t.confirmDangerTitle}
        description={t.confirmDangerBody}
        confirmLabel={t.confirmDangerLabel}
        onConfirm={() => wait(1000)}
      />
      <ConfirmDialog
        device={device}
        trigger={<Button variant="secondary">{t.confirmKeepOpen}</Button>}
        title={t.confirmKeepOpenTitle}
        description={t.confirmKeepOpenBody}
        confirmLabel={t.confirmKeepOpenLabel}
        onConfirm={async () => {
          await wait(1000);
          toast.error(t.confirmKeepOpenToast);
          return false;
        }}
      />
      <ConfirmDialog
        device={device}
        trigger={<Button variant="secondary">{t.confirmThrow}</Button>}
        title={t.confirmThrowTitle}
        description={t.confirmThrowBody}
        confirmLabel={t.confirmThrowLabel}
        onConfirm={async () => {
          await wait(1000);
          throw new Error("sample");
        }}
      />
      <Button variant="secondary" onClick={() => toast(t.toastText)}>
        {t.toastOpen}
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          const id = toast.loading(t.toastLoadingText);
          void wait(1500).then(() => toast.success(t.toastDone, { id }));
        }}
      >
        {t.toastLoadingOpen}
      </Button>
    </div>
  );
}
