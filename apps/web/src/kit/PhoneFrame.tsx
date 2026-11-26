import Image from "next/image";
import { cn } from "./cn";

export type PhoneFrameProps = {
  /** Снимок экрана из public/ (статика) и его настоящие размеры — без сдвига раскладки. */
  src: string;
  width: number;
  height: number;
  alt: string;
  /** Ширина рамки на экране для выбора размера снимка (next/image `sizes`), например "15rem". */
  sizes: string;
  /** Ширина рамки — класс ширины снаружи (`w-40`, `desktop:w-60`). */
  className?: string;
  /**
   * Только верх экрана (3:4): рамка обрезана снизу и растворяется (`phone-frame-cut`) — читается главное на экране, без
   * панели вкладок и мелких строк внизу. По умолчанию — экран целиком.
   */
  cropped?: boolean;
};

/**
 * Снимок нашего экрана в рамке телефона (лендинг, «Как это работает»): тёмный корпус в обеих темах (`phone-frame`),
 * снимок со скруглением экрана, концентричным рамке, и заливкой `photo-fallback` до загрузки. Ленивая загрузка —
 * снимки ниже первого экрана. Серверный компонент.
 */
export function PhoneFrame({ src, width, height, alt, sizes, className, cropped = false }: PhoneFrameProps) {
  return (
    <div className={cn("phone-frame shrink-0", cropped && "phone-frame-cut", className)}>
      <div className={cn("photo-frame rounded-phone-screen", cropped && "aspect-3/4 rounded-b-none")}>
        <Image
          src={src}
          width={width}
          height={height}
          alt={alt}
          sizes={sizes}
          className={cropped ? "block size-full object-cover object-top" : "block h-auto w-full"}
        />
      </div>
    </div>
  );
}
