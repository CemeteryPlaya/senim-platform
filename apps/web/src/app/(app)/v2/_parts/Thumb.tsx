import { Armchair } from "lucide-react";
import { PhotoSlot } from "@/kit";

/**
 * Миниатюра 56 px в строке списка (разбор 3.6, «Списки»): обложка заявки — первое фото помещения, которое отдаёт модуль.
 * Фото нет — ровная заливка `photo-fallback` со значком мебели, а не чужая картинка. Подпись строки рядом, поэтому фото —
 * украшение (`alt=""`).
 */
export function Thumb({ src }: { src: string | null | undefined }) {
  if (src) {
    return (
      <div className="size-thumb shrink-0">
        <PhotoSlot src={src} alt="" ratio="1/1" sizes="56px" />
      </div>
    );
  }
  return (
    <span aria-hidden className="photo-frame flex size-thumb shrink-0 items-center justify-center rounded-thumb text-muted">
      <Armchair className="size-6" strokeWidth={1.75} />
    </span>
  );
}
