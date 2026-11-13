import { getShellUser } from "@/modules/identity";
import { getDevice } from "@/platform/device";
import { requireV2User } from "../_shell/auth";
import { to } from "../_shell/paths";
import { GuestHome } from "./_home/GuestHome";
import { BuyerHome } from "./_home/BuyerHome";
import { SignedInHome } from "./_home/SignedInHome";

/**
 * Главная нового интерфейса. Гость видит лендинг (`GuestHome`); покупатель (активная роль заказчика) — свою главную
 * (`BuyerHome`); остальные роли пока видят прежний образец (`SignedInHome`, заменится на этапе 4). Вошедший с непройденными первыми шагами (согласие, знакомство, почта — в том
 * числе пришедший из v1: сессия общая) уходит на первый из них с возвратом сюда (requireV2User без ролей: главная — дом
 * заказчика, правило 3 в _shell/auth.ts). <main> и навигацию даёт оболочка (layout v2).
 */
export default async function V2Home() {
  const { user } = await getShellUser();
  if (user) {
    const current = await requireV2User(to("/"));
    if (current.role === "CLIENT") return <BuyerHome user={current} device={await getDevice()} />;
    return <SignedInHome />;
  }
  return <GuestHome device={await getDevice()} />;
}
