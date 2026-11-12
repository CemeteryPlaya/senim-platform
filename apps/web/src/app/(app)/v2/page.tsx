import { ru } from "@/i18n/ru";
import { brand } from "@/config/brand";
import { EmptyState, FirstSteps, HelpBlock, NowNext, PageTitle, Split, Stack } from "@/kit";
import { to } from "../_shell/paths";

const t = ru.app.shell.preview;

/**
 * Временная главная нового интерфейса: компоненты kit с заглушками из `ru.app.shell.preview`; экраны появятся на
 * этапе 3. <main> и навигацию даёт оболочка (layout v2).
 *
 * Компьютер — сетка 1,5 : 1: слева первые шаги, «Сейчас» и пустой экран, справа только «Помощь»; верх колонок
 * совпадает (заголовок «Помощи» внутри её карточки). Телефон — тот же порядок одной колонкой, «Помощь» в конце.
 * Единственное главное действие — в пустом экране.
 */
export default function V2Home() {
  return (
    <Stack gap="section">
      <PageTitle title={t.title} lead={t.lead} />
      <Split
        main={
          <Stack>
            <FirstSteps
              steps={[
                { label: t.stepOne, done: true },
                { label: t.stepTwo, done: false, href: to("/requests/new") },
              ]}
            />
            <NowNext now={{ title: t.nowTitle, body: t.nowBody }} next={t.next} />
            <EmptyState
              title={t.emptyTitle}
              body={t.emptyBody}
              action={{ href: to("/requests/new"), label: t.emptyAction }}
            />
          </Stack>
        }
        aside={
          <HelpBlock
            items={[
              { question: t.helpOne, href: to("/about") },
              { question: t.helpTwo, href: to("/about") },
            ]}
            supportEmail={brand.support.email}
          />
        }
      />
    </Stack>
  );
}
