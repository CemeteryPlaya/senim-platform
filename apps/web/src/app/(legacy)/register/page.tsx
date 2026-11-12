import { redirect } from "next/navigation";
import { EXECUTOR_REGISTRATION_PATH } from "@/modules/identity";

/** «Я мастер» на лендинге ведёт сюда. Заказчику регистрация не нужна: новый номер при входе — заказчик. */
export default function RegisterPage() {
  redirect(EXECUTOR_REGISTRATION_PATH);
}
