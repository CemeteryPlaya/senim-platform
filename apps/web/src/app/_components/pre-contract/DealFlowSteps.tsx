import type { CurrentUser } from "@/modules/identity";
import { getFlowProgress } from "@/modules/requests";
import { FlowSteps } from "./FlowSteps";

/** Шкала этапов заявки на экране сделки: те же шаги сценария, что на экранах заявки (текущий — договор или работа). */
export async function DealFlowSteps({ user, offerId }: { user: CurrentUser; offerId: string }) {
  const progress = await getFlowProgress(user, { offerId });
  return <FlowSteps {...progress} />;
}
