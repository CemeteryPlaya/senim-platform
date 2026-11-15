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
};

/**
 * Снимок нашего экрана в рамке телефона (лендинг, «Как это работает»): тёмный корпус в обеих темах (`phone-frame`),
 * снимок со скруглением экрана, концентричным рамке, и заливкой `photo-fallback` до загрузки. Ленивая загрузка —
 * снимки ниже первого экрана. Серверный компонент.
 */
export function PhoneFrame({ src, width, height, alt, sizes, className }: PhoneFrameProps) {
  return (
    <div className={cn("phone-frame shrink-0", className)}>
      <div className="photo-frame rounded-phone-screen">
        <Image src={src} width={width} height={height} alt={alt} sizes={sizes} className="block h-auto w-full" />
      </div>
    </div>
  );
}
