import { redirect } from "next/navigation";
import { getShellUser } from "@/modules/identity";
import { getDevice } from "@/platform/device";
import { homeFor, masterStatusOf, requireV2User } from "../../_shell/auth";
import { to } from "../../_shell/paths";
import { GuestHome } from "../_home/GuestHome";
import { BuyerHome } from "../_home/BuyerHome";
import { MasterHome } from "../_home/MasterHome";
import { SignedInHome } from "../_home/SignedInHome";

/**
 * Главная нового интерфейса. Гость видит лендинг (`GuestHome`); покупатель (активная роль заказчика) — свою главную
 * (`BuyerHome`); одобренный мастер — свою (`MasterHome`: «что сейчас», сделки, новые заявки); неодобренный (нет профиля, проверка, отказ) уходит
 * на регистрацию мастера — его дом (`homeFor`);
 * оператор и замерщик пока видят прежний образец (`SignedInHome`). Вошедший с непройденными первыми шагами (согласие,
 * знакомство, почта — в том числе пришедший из v1: сессия общая) уходит на первый из них с возвратом сюда (requireV2User
 * без ролей: главная — дом заказчика, правило 3 в _shell/auth.ts). <main> и навигацию даёт оболочка (layout v2).
 */
export default async function V2Home() {
  const { user } = await getShellUser();
  if (user) {
    const current = await requireV2User(to("/"));
    if (current.role === "CLIENT") return <BuyerHome user={current} device={await getDevice()} />;
    if (current.role === "EXECUTOR") {
      // Дом неодобренного мастера (нет профиля, на проверке, отказ) — регистрация и статус проверки, не главная: одно место.
      if (masterStatusOf(current) !== "approved") redirect(homeFor(current));
      return <MasterHome user={current} status="approved" device={await getDevice()} />;
    }
    return <SignedInHome />;
  }
  return <GuestHome device={await getDevice()} />;
}
