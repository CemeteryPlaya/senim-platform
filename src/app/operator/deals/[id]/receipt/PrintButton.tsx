"use client";

import { Printer } from "lucide-react";
import { Button } from "@/ui";

/** Печать шаблона расписки (или сохранение в PDF из диалога печати браузера). */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" icon={<Printer />} onClick={() => window.print()} className="self-start print:hidden">
      {label}
    </Button>
  );
}
