import { Notice } from "@/kit";

/**
 * Плашка с кодом, который сервис показывает на экране вместо отправки (заглушка SMS и писем): одна строка «Ваш код: NNNNNN»,
 * цифры одной ширины. Одна на вход и на почту. `codeLine` — готовый текст из `ru`: код читается и находится на экране одной
 * строкой. Пояснения «сообщения не отправляются» нет: человеку на стенде оно не нужно.
 */
export function ShownCode({ codeLine }: { codeLine: string }) {
  return (
    <Notice tone="info" live>
      <span className="block tabular-nums">{codeLine}</span>
    </Notice>
  );
}
