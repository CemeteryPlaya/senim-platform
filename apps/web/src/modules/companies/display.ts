import { ru } from "@/i18n/ru";

/**
 * Как заказчик видит исполнителя (ответ владельца №6, ADR-006). Единственное место, где решается,
 * раскрывать ли наименование: экраны получают готовые строки и условий на режим не пишут. Из места мастера в любом
 * режиме — только город (ADR-016): район и адрес мастерской не показываются.
 * Телефон и ИИН/БИН сюда не попадают ни в одном режиме.
 */
export const EXECUTOR_IDENTITY_MODES = ["HIDDEN", "SHOWN"] as const;
export type ExecutorIdentityMode = (typeof EXECUTOR_IDENTITY_MODES)[number];

/** HIDDEN — по умолчанию и при любом непонятном значении настройки. */
export function parseExecutorIdentityMode(raw: unknown): ExecutorIdentityMode {
  return raw === "SHOWN" ? "SHOWN" : "HIDDEN";
}

export type ExecutorIdentitySource = {
  publicNumber: number;
  legalName: string;
  city: string;
};

export type ExecutorDisplay = {
  /** Именительный: «Исполнитель №17» или наименование. */
  label: string;
  /** Родительный и винительный: «Предложение Исполнителя №17», «Вы выбрали Исполнителя №17». */
  labelGen: string;
  /** Дательный: «Написать Исполнителю №17». */
  labelDat: string;
  /** Город мастера в любом режиме. Пустая строка — города нет. */
  address: string;
  nameShown: boolean;
};

export function executorDisplay(src: ExecutorIdentitySource, mode: ExecutorIdentityMode): ExecutorDisplay {
  if (mode === "SHOWN") {
    return {
      label: src.legalName,
      labelGen: src.legalName,
      labelDat: src.legalName,
      address: src.city.trim(),
      nameShown: true,
    };
  }
  const n = src.publicNumber;
  return {
    label: ru.common.executorLabel(n),
    labelGen: ru.companies.identity.labelGen(n),
    labelDat: ru.companies.identity.labelDat(n),
    address: src.city.trim(),
    nameShown: false,
  };
}
