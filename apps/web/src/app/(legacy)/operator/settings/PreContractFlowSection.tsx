import { activePreContractFlow } from "@/modules/requests";
import { Card } from "@/ui";
import { PreContractFlowForm } from "./PreContractFlowForm";

/** Секция «Сценарий до договора» в настройках площадки (ADR-005). Страница уже проверила оператора и флаг. */
export async function PreContractFlowSection() {
  const current = await activePreContractFlow();
  return (
    <Card>
      <PreContractFlowForm current={current} />
    </Card>
  );
}
