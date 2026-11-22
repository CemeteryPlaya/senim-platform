import { getDevice } from "@/platform/device";
import { GuestHome } from "../_home/GuestHome";

/**
 * Лендинг для всех: сюда ведёт название продукта в шапке у вошедшего (покупатель, мастер) — тот же первый экран, что гость
 * видит на главной. «Главная» в меню вошедшего — его дом (`/v2`). Данных человека на странице нет; кнопки входа вошедшего
 * экран входа сразу отправляет дальше (его дом или незавершённый шаг).
 */
export default async function LandingPage() {
  return <GuestHome device={await getDevice()} />;
}
