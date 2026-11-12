import { pushPublicKey } from "@/modules/notifications";
import { PushButton } from "./PushButton";

/**
 * Серверный компонент: кнопка «Включить уведомления» с публичным VAPID-ключом.
 * Без ключей (push выключен) ничего не рисует — in-app уведомления работают как раньше.
 */
export function EnablePush() {
  const publicKey = pushPublicKey();
  return publicKey ? <PushButton publicKey={publicKey} /> : null;
}
