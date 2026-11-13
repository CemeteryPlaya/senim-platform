export type PhotoItem = {
  id: string;
  /** Адрес превью: blob:/data: до загрузки или URL файла после. */
  src: string;
  alt?: string;
  status: "uploading" | "done" | "error";
  /** 0–100, пока status = "uploading". */
  progress?: number;
  /** Текст ошибки, если status = "error". */
  error?: string;
};
