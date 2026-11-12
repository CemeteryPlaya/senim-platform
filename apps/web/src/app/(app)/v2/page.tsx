import { ru } from "@/i18n/ru";

/** Главная нового интерфейса — пока только название продукта; экраны появятся на следующих этапах. */
export default function V2Home() {
  return (
    <main>
      <h1>{ru.common.brand}</h1>
    </main>
  );
}
