import { ru } from "@/i18n/ru";
import { PageTitle } from "@/kit";

/**
 * Главная нового интерфейса — пока только название продукта; экраны появятся на следующих этапах.
 * <main> и навигацию даёт оболочка (layout v2).
 */
export default function V2Home() {
  return <PageTitle title={ru.common.brand} />;
}
