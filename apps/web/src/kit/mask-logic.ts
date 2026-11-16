/**
 * Маски полей ввода (телефон, деньги, ИИН/БИН, IBAN): чистые функции без React и браузера.
 *
 * Поле с маской держит «значимые» символы (цифры, у IBAN — ещё заглавные латинские буквы) и показывает их с
 * разделителями. Каждая правка — новое значение поля и положение курсора: `applyEdit` разбирает то, что оказалось в
 * поле после ввода, вставки, автозаполнения или удаления, и возвращает строку для показа и курсор. Курсор стоит после
 * того же по счёту значимого символа, что и до форматирования, — правка в середине не уводит его в конец.
 *
 * В форму уходит не показ, а значимые символы (`value`): тот же формат, что ждёт схема действия на сервере.
 */

/** Как маска разбирает и показывает значение. */
export type Mask = {
  /** Значимые символы из произвольной строки, по одному на каждый принятый символ (цифры, заглавные буквы). */
  keep: (raw: string) => string;
  /** Предел значимых символов. */
  max: number;
  /**
   * Вставка сверх предела отклоняется целиком, а не обрезается: у суммы обрезка меняет величину («2 млрд» → 200 млн).
   * По умолчанию вставка обрезается (номер с добавочным, IBAN с хвостом).
   */
  rejectOverflow?: boolean;
  /**
   * Чистка начала значения: срезать ведущие символы, которые не входят в значение (8 перед номером, ноль перед суммой).
   * `bulk` — значение пришло целиком (вставка, автозаполнение), а не набрано по символу. Возвращает остаток и сколько
   * символов срезано в начале.
   */
  trim?: (sig: string, bulk: boolean) => { sig: string; dropped: number };
  /** Показ: значимые символы с разделителями; разделитель только между символами, не в конце. */
  format: (sig: string) => string;
  /** Разбор вставленного текста в значимые символы («1,2 млн» → «1200000»); `null` — обычный разбор `keep`. */
  paste?: (text: string) => string | null;
};

/** Что было в поле до правки и что оказалось после неё. */
export type Edit = {
  /** Показ до правки (то, что поле показывало). */
  prev: string;
  /** Строка в поле после правки браузера. */
  raw: string;
  /** Курсор после правки браузера. */
  caret: number;
  /** `InputEvent.inputType` (`insertText`, `insertFromPaste`, `deleteContentBackward`…); у автозаполнения его нет. */
  inputType?: string;
  /** `InputEvent.data` — вставленный текст (у `insertText` — набранный символ или подставленное клавиатурой слово). */
  data?: string | null;
};

export type Edited = { shown: string; value: string; caret: number };

/** Позиция в показе сразу после `n`-го значимого символа (0 — начало строки). */
export function caretAfter(mask: Mask, shown: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < shown.length; i += 1) {
    if (mask.keep(shown[i]).length > 0) seen += 1;
    if (seen === n) return i + 1;
  }
  return shown.length;
}

/** Значение и показ из любой строки (начальное значение, значение по умолчанию): то же, что вставка целиком. */
export function fromRaw(mask: Mask, raw: string): { shown: string; value: string } {
  const kept = mask.keep(raw);
  const { sig } = mask.trim ? mask.trim(kept, true) : { sig: kept };
  const value = sig.slice(0, mask.max);
  return { shown: mask.format(value), value };
}

/**
 * Значение пришло целиком, а не набрано по символу: вставка, перетаскивание, автозаполнение (без `inputType`), подстановка
 * клавиатуры (`insertReplacementText`) или `insertText` сразу из нескольких значимых символов (подсказка клавиатуры,
 * программное заполнение).
 */
function isBulk(mask: Mask, edit: Edit): boolean {
  if (edit.inputType === undefined) return true;
  if (/^(?:insertText|insertCompositionText)/.test(edit.inputType)) return mask.keep(edit.data ?? "").length > 1;
  return !edit.inputType.startsWith("delete");
}

/**
 * Правка поля → новый показ, значение и курсор.
 *
 * - Удаление одного разделителя (Backspace сразу после пробела) удаляет значимый символ перед ним, а не «ничего».
 * - Набор сверх предела отклоняется: поле остаётся прежним (вставка и автозаполнение сверх предела обрезаются, у маски с
 *   `rejectOverflow` — тоже отклоняются).
 */
export function applyEdit(mask: Mask, edit: Edit): Edited {
  const prevSig = mask.keep(edit.prev);
  let sig = mask.keep(edit.raw);
  let before = mask.keep(edit.raw.slice(0, edit.caret)).length;

  // Удалён только разделитель: удалить соседний значимый символ в сторону удаления.
  if (sig === prevSig && edit.raw.length < edit.prev.length) {
    if (edit.inputType === "deleteContentBackward" && before > 0) {
      sig = sig.slice(0, before - 1) + sig.slice(before);
      before -= 1;
    } else if (edit.inputType === "deleteContentForward" && before < sig.length) {
      sig = sig.slice(0, before) + sig.slice(before + 1);
    }
  }

  const bulk = isBulk(mask, edit);
  if (mask.trim) {
    const trimmed = mask.trim(sig, bulk || prevSig.length === 0);
    sig = trimmed.sig;
    before = Math.max(0, before - trimmed.dropped);
  }

  if (sig.length > mask.max) {
    if (!bulk || mask.rejectOverflow) {
      // Лишний символ набран — поле не меняется, курсор там, где был до ввода.
      const typed = sig.length - prevSig.length;
      return { shown: edit.prev, value: prevSig, caret: caretAfter(mask, edit.prev, Math.max(0, before - typed)) };
    }
    sig = sig.slice(0, mask.max);
  }

  const shown = mask.format(sig);
  return { shown, value: sig, caret: caretAfter(mask, shown, Math.min(before, sig.length)) };
}

/**
 * Вставка текста: строка поля после вставки на месте выделения `[start, end)` — с разбором `paste` маски
 * («1,2 млн»). `null` — маска не разбирает такой текст, вставку делает браузер (и потом `applyEdit`).
 */
export function pasteInto(mask: Mask, shown: string, start: number, end: number, text: string): Edited | null {
  const parsed = mask.paste?.(text) ?? null;
  if (parsed === null) return null;
  const raw = shown.slice(0, start) + parsed + shown.slice(end);
  return applyEdit(mask, { prev: shown, raw, caret: start + parsed.length, inputType: "insertFromPaste" });
}

// ---------------------------------------------------------------------------------------------------------------------
// Маски
// ---------------------------------------------------------------------------------------------------------------------

const digits = (raw: string) => raw.replace(/[^0-9]/g, "");

/** Значимые символы через пробел группами заданных длин; хвост — последней группой. «7001234567», [3,3,2,2] → «700 123 45 67». */
function groups(sig: string, sizes: readonly number[], separator = " "): string {
  const parts: string[] = [];
  let at = 0;
  for (const size of sizes) {
    if (at >= sig.length) break;
    parts.push(sig.slice(at, at + size));
    at += size;
  }
  if (at < sig.length) parts.push(sig.slice(at));
  return parts.join(separator);
}

/**
 * Казахстанский мобильный номер без кода страны: 10 цифр, показ «700 123 45 67» (приставка «+7» стоит в поле отдельно).
 * Ведущая 8 («8 700 …») — междугородний префикс, срезается всегда (номер РК не начинается с 8). Ведущая 7 при 11 цифрах
 * срезается только у вставки и автозаполнения («+7 700 …»): набранная по цифре одиннадцатая цифра отклоняется — номер
 * на «77…» существует (777, 775), и угадывать, какую 7 человек имел в виду, нельзя. Вставка, начатая с «+7», теряет
 * эту 7 при любой длине («+7 701» → «701»); неполная вставка без «+» («7701») — как набрана.
 */
export const PHONE_MASK: Mask = {
  keep: digits,
  max: 10,
  trim: (sig, bulk) => {
    if (sig.startsWith("8")) return { sig: sig.slice(1), dropped: 1 };
    if (bulk && sig.length > 10 && sig.startsWith("7")) return { sig: sig.slice(1), dropped: 1 };
    return { sig, dropped: 0 };
  },
  format: (sig) => groups(sig, [3, 3, 2, 2]),
  // Вставка с кодом страны («+7 701», «+7 (701) 555…») — 7 после «+» не часть номера при любой длине вставки.
  paste: (text) => (/^\s*\+\s*7/.test(text) ? digits(text).slice(1) : null),
};

/** Значение для формы: «+7» и 10 цифр; неполный номер — как набран (+7 и цифры), пустой — пустая строка. */
export function phoneValue(sig: string): string {
  return sig ? `+7${sig}` : "";
}

/** ИИН и БИН: 12 цифр, показ «870304 300 612» (дата рождения или регистрации — отдельной группой). */
export const IIN_MASK: Mask = {
  keep: digits,
  max: 12,
  format: (sig) => groups(sig, [6, 3, 3]),
};

/** Казахстанский IBAN: 20 знаков (KZ, 2 цифры, 16 цифр и букв), заглавными, группами по 4: «KZ86 125K ZT50 0410 0100». */
export const IBAN_MASK: Mask = {
  keep: (raw) => raw.toUpperCase().replace(/[^A-Z0-9]/g, ""),
  max: 20,
  format: (sig) => groups(sig, [4, 4, 4, 4, 4]),
};
