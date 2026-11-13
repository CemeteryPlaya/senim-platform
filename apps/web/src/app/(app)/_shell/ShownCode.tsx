import { Notice } from "@/kit";

/**
 * Плашка с кодом, который сервис показывает на экране вместо отправки (заглушка SMS и писем): первая фраза, затем
 * строка «Ваш код: NNNNNN» — всегда с новой строки, цифры одной ширины. Одна на вход и на почту. `lead` и `codeLine` — готовые
 * тексты из `ru`; `codeLine` — отдельным элементом, чтобы код читался и находился на экране одной строкой.
 */
export function ShownCode({ lead, codeLine }: { lead: string; codeLine: string }) {
  return (
    <Notice tone="info" live>
      <span className="block">{lead}</span>
      <span className="block tabular-nums">{codeLine}</span>
    </Notice>
  );
}
