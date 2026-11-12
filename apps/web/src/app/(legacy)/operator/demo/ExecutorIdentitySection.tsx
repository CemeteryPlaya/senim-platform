import { getExecutorIdentityMode } from "@/modules/companies";
import { Card } from "@/ui";
import { ExecutorIdentityForm } from "./ExecutorIdentityForm";

/**
 * Секция «Как заказчик видит исполнителя» (ответ №6, ADR-006): «Имя скрыто» — «Исполнитель №N»,
 * город и район; «Имя показано» — наименование и полный адрес. Страница /operator/demo существует
 * только при DEMO_MODE; смена режима пишется в журнал.
 */
export async function ExecutorIdentitySection() {
  const mode = await getExecutorIdentityMode();
  return (
    <Card>
      <ExecutorIdentityForm current={mode} />
    </Card>
  );
}
