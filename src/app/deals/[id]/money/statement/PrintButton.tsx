"use client";

import { Printer } from "lucide-react";
import { Button } from "@/ui";

/** Печать выписки: в диалоге печати браузера есть «Сохранить как PDF». На бумаге кнопки нет. */
export function PrintButton({ label }: { label: string }) {
  return (
    <div className="print:hidden">
      <Button variant="secondary" fullWidth icon={<Printer />} onClick={() => window.print()}>
        {label}
      </Button>
    </div>
  );
}
