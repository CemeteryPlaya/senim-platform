import { ru } from "@/i18n/ru";
import { brand } from "@/config/brand";
import { EmptyState, FirstSteps, HelpBlock, NowNext, PageTitle } from "@/kit";
import { to } from "../_shell/paths";

const t = ru.app.shell.preview;

/**
 * Временная главная нового интерфейса: компоненты kit с заглушками из `ru.app.shell.preview`; экраны появятся на
 * этапе 3. <main> и навигацию даёт оболочка (layout v2).
 */
export default function V2Home() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={ru.common.brand} lead={t.lead} />
      <FirstSteps
        steps={[
          { label: t.stepOne, done: true },
          { label: t.stepTwo, done: false, href: to("/requests/new") },
        ]}
      />
      <NowNext now={{ title: t.nowTitle, body: t.nowBody }} next={t.next} />
      <EmptyState title={t.emptyTitle} body={t.emptyBody} />
      <HelpBlock
        items={[
          { question: t.helpOne, href: to("/about") },
          { question: t.helpTwo, href: to("/about") },
        ]}
        supportEmail={brand.support.email}
      />
    </div>
  );
}
