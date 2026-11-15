import { Check } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";
import { PhotoImage } from "./PhotoImage";

export type PhotoChoiceProps = Omit<ComponentProps<"input">, "name" | "type"> & {
  /** Подпись плитки: под фото, не на нём (имя радио; диктор читает её, фото — украшение). */
  label: string;
  name: string;
  /** Вторая строка под подписью: вторичный текст 15 px `muted`; связана с радио через `aria-describedby`. */
  description?: string;
  /** Фото плитки (статика интерфейса); без него — нейтральная заливка со значком `icon`, без подделки под фото. */
  photo?: { src: string };
  /** Значок на нейтральной заливке, когда фото нет. */
  icon?: ReactNode;
  /** Ширина плитки на экране (`sizes` у фото); по умолчанию — половина экрана на телефоне, колонка 560 px пополам на компьютере. */
  sizes?: string;
};

const DEFAULT_SIZES = "(min-width: 64rem) 272px, 50vw";

/**
 * Плитка выбора с фото (категория мебели, роль при входе): радио-кнопка, фото 4 : 3 с радиусом карточки и подпись под
 * ним. Выбранная плитка видна не только цветом: контур 2 px `action` вокруг фото и галочка в круге в углу; фокус с
 * клавиатуры — контур 4 px цвета фокуса. Нет фото — заливка `photo-fallback` со значком. Ввод — настоящий
 * `input type=radio` (`sr-only`): стрелки внутри группы, Tab, Пробел работают как у любого радио. Высота плитки с
 * подписью заведомо больше 48 px. Ошибка — у `PhotoChoiceGroup`. Серверный компонент (фото — клиентский `PhotoImage`).
 */
export function PhotoChoice({ label, description, photo, icon, sizes = DEFAULT_SIZES, id: explicitId, className, ...rest }: PhotoChoiceProps) {
  const auto = useId();
  const id = explicitId ?? auto;
  const descriptionId = description ? `${id}-description` : undefined;
  const labelId = `${id}-label`;
  return (
    <label htmlFor={id} className="group flex cursor-pointer flex-col gap-2 pressable has-disabled:cursor-not-allowed has-disabled:opacity-50">
      <input
        id={id}
        type="radio"
        className={cn("sr-only", className)}
        {...rest}
        aria-labelledby={rest["aria-labelledby"] ?? labelId}
        aria-describedby={[rest["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined}
      />
      <span
        aria-hidden
        className={cn(
          "photo-frame flex aspect-4/3 w-full items-center justify-center rounded-card",
          "group-has-checked:outline-2 group-has-checked:outline-offset-2 group-has-checked:outline-action",
          "group-has-focus-visible:outline-4 group-has-focus-visible:outline-offset-2 group-has-focus-visible:outline-focus",
        )}
      >
        {photo ? <PhotoImage src={photo.src} alt="" sizes={sizes} /> : icon}
        <span className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-action text-on-action shadow-float ring-1 ring-scrim/40 opacity-0 group-has-checked:opacity-100">
          <Check className="size-5" />
        </span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span id={labelId} className="text-headline text-ink">
          {label}
        </span>
        {description && (
          <span id={descriptionId} className="text-sub text-muted">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

export type PhotoChoiceGroupProps = {
  /** Имя группы для диктора (вопрос уже задан заголовком экрана, поэтому подпись скрыта визуально). */
  legend: string;
  error?: string;
  children: ReactNode;
};

/** Сетка плиток выбора в две колонки: `fieldset` с `legend` и одной общей ошибкой. */
export function PhotoChoiceGroup({ legend, error, children }: PhotoChoiceGroupProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <fieldset aria-describedby={errorId} className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="sr-only">{legend}</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-5">{children}</div>
      {error && (
        <p id={errorId} role="alert" className="text-sub text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
