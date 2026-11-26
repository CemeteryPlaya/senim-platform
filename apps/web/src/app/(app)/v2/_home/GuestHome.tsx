import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink } from "@/kit";
import type { Device } from "@/platform/device";
import { DesktopHero, Footer, Help, MobileHero, MoneySection, Steps, Works } from "./GuestLanding";
import { heroPhoto, stepScreens, workTiles } from "./landing-media";
import { loginHref } from "./links";

const t = ru.app.guest.home;

/**
 * Главная гостя — лендинг (разбор 3.8, спека раздел 18). Порядок: первый экран, «Как это работает» со снимками наших
 * экранов, тёмный раздел «Где ваши деньги», «Работы мастеров», «Помощь», подвал (только на компьютере).
 *
 * Компьютер: первый экран — фото на всю ширину окна под стеклянной шапкой, белый заголовок 64 px, единственная главная
 * кнопка — белая (`inverse`) на затемнении фото, рядом ссылка мастера. Дока нет: кнопка — в первом экране.
 * Телефон: название продукта, заголовок 36 px, фото 4:5, подзаголовок, ссылка мастера; подвала нет; главная
 * кнопка — одна в `ActionDock`, последним ребёнком колонки (прилипает над панелью вкладок с первого экрана).
 * На странице один `h1` и одно главное действие (`data-primary-action`).
 */
export function GuestHome({ device }: { device: Device }) {
  const photo = heroPhoto();
  const screens = stepScreens(t.stepShots);
  const tiles = workTiles();

  if (device === "desktop") {
    return (
      // data-landing: область содержимого оболочки на этой странице — во всю ширину (landing.css); первый экран и тёмный
      // раздел идут от края до края, остальное — в колонке содержимого (те же max-w-content и px-6, что у main).
      <div data-landing className="flex flex-col gap-24">
        <DesktopHero photo={photo} />
        <div className="mx-auto flex w-full max-w-content flex-col gap-24 px-6">
          <Steps device={device} screens={screens} />
        </div>
        <MoneySection device={device} />
        <div className="mx-auto flex w-full max-w-content flex-col gap-24 px-6">
          <Works device={device} tiles={tiles} />
          <Help />
          <Footer />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-14">
      <MobileHero photo={photo} />
      <Steps device={device} screens={screens} />
      <MoneySection device={device} />
      <Works device={device} tiles={tiles} />
      <Help />
      <ActionDock>
        <ButtonLink href={loginHref("client")}>{t.clientAction}</ButtonLink>
      </ActionDock>
    </div>
  );
}
