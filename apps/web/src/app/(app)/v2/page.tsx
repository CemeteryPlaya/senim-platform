import { ru } from "@/i18n/ru";
import { brand } from "@/config/brand";
import { EmptyState, FirstSteps, HelpBlock, NowNext, PageTitle, Split, Stack } from "@/kit";
import { getDevice } from "@/platform/device";
import { to } from "../_shell/paths";

const t = ru.app.shell.preview;

/**
 * Временная главная нового интерфейса: компоненты kit с заглушками из `ru.app.shell.preview`; экраны появятся на
 * этапе 3. <main> и навигацию даёт оболочка (layout v2).
 *
 * Компоновка своя у каждой версии (спека редизайна, раздел 5). Телефон — одна колонка: первые шаги, «Что сейчас»,
 * пустой экран (карточки одной группы), ниже «Помощь». Компьютер — сетка 1,5 : 1: слева первые шаги и «Что сейчас»,
 * справа «Помощь»; под ними пустой экран во всю ширину сетки. Единственное главное действие — в пустом экране.
 */
export default async function V2Home() {
  const device = await getDevice();

  const steps = (
    <FirstSteps
      steps={[
        { label: t.stepOne, done: true },
        { label: t.stepTwo, done: false, href: to("/requests/new") },
      ]}
    />
  );
  const now = <NowNext now={{ title: t.nowTitle, body: t.nowBody }} next={t.next} />;
  const empty = <EmptyState title={t.emptyTitle} body={t.emptyBody} action={{ href: to("/requests/new"), label: t.emptyAction }} />;
  const help = (
    <HelpBlock
      items={[
        { question: t.helpOne, href: to("/about") },
        { question: t.helpTwo, href: to("/about") },
      ]}
      supportEmail={brand.support.email}
    />
  );
  const title = <PageTitle title={ru.common.brand} lead={t.lead} />;

  if (device === "desktop") {
    return (
      <Stack gap="section">
        {title}
        <Split
          main={
            <Stack>
              {steps}
              {now}
            </Stack>
          }
          aside={help}
        />
        {empty}
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {title}
      <Stack>
        {steps}
        {now}
        {empty}
      </Stack>
      {help}
    </Stack>
  );
}
