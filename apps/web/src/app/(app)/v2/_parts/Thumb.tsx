import { PhotoSlot } from "@/kit";

/**
 * Миниатюра 56 px в строке списка (разбор 3.6, «Списки»): обложка заявки — первое фото помещения, которое отдаёт модуль.
 * Фото нет — миниатюры нет совсем (Ruling 7: без одинаковых заглушек): `thumbOf` отдаёт `undefined`, строка — без `leading`.
 * Подпись строки рядом, поэтому фото — украшение (`alt=""`).
 */
export function thumbOf(src: string | null | undefined) {
  if (!src) return undefined;
  return (
    <div className="size-thumb shrink-0">
      <PhotoSlot src={src} alt="" ratio="1/1" sizes="56px" />
    </div>
  );
}
