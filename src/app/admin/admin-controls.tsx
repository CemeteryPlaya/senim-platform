"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { resetDemoAction, setMasterVerifiedAction } from "@/app/actions";
import { Button } from "@/components/ui";
import { useAction } from "@/components/use-action";

export function VerifyToggle({ masterId, verified }: { masterId: string; verified: boolean }) {
  const { pending, run } = useAction();
  return (
    <button
      disabled={pending}
      onClick={() => run(() => setMasterVerifiedAction(masterId, !verified))}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
        verified ? "bg-brand-soft text-brand hover:bg-red-soft hover:text-red" : "bg-amber-soft text-amber hover:bg-brand-soft hover:text-brand"
      }`}
    >
      {pending ? "…" : verified ? "Проверен" : "Проверить по ИИН"}
    </button>
  );
}

export function ResetDemo() {
  const [confirm, setConfirm] = useState(false);
  const { pending, run, error } = useAction();
  if (!confirm)
    return (
      <Button variant="secondary" onClick={() => setConfirm(true)}>
        <RotateCcw size={16} /> Сбросить демо
      </Button>
    );
  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-sm text-red">{error}</span>}
      <span className="text-sm text-muted">Вернуть исходные данные?</span>
      <Button variant="danger" disabled={pending} onClick={() => run(() => resetDemoAction(), () => setConfirm(false))}>
        {pending ? "Сбрасываем…" : "Да, сбросить"}
      </Button>
      <Button variant="ghost" onClick={() => setConfirm(false)}>
        Нет
      </Button>
    </div>
  );
}
