import { getShellUser } from "@/modules/identity";
import { getDevice } from "@/platform/device";
import { GuestHome } from "./_home/GuestHome";
import { SignedInHome } from "./_home/SignedInHome";

/**
 * Главная нового интерфейса. Гость видит лендинг (`GuestHome`); вошедшему пока показывается прежний образец
 * (`SignedInHome`, заменится на этапе 3). <main> и навигацию даёт оболочка (layout v2).
 */
export default async function V2Home() {
  const { user } = await getShellUser();
  if (user) return <SignedInHome />;
  return <GuestHome device={await getDevice()} />;
}
