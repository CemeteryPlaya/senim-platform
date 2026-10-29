import { ArrowRight, BadgeCheck, Camera, FileSignature, Hammer, Landmark, Lock, ShieldCheck, Wallet } from "lucide-react";
import { switchUser } from "@/app/actions";
import { Avatar, ButtonLink, Card } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { split } from "@/lib/deal/money";
import { tenge } from "@/lib/format";

const STEPS = [
  {
    icon: FileSignature,
    title: "Договор с ЭЦП",
    text: "Условия, этапы и сроки фиксируются в договоре подряда. Обе стороны подписывают его ЭЦП НУЦ РК — через NCALayer или eGov Mobile.",
  },
  {
    icon: Lock,
    title: "Деньги на эскроу",
    text: "Заказчик вносит сумму на эскроу-счёт в банке-партнёре. Деньги заморожены: мастер видит, что оплата гарантирована.",
  },
  {
    icon: Camera,
    title: "Этапы с фотоотчётом",
    text: "Замер, материалы, цех, монтаж. Мастер отчитывается фото, заказчик подтверждает. Аванс на материалы — после подтверждения закупки.",
  },
  {
    icon: Wallet,
    title: "Автоматическая выплата",
    text: "После приёмки деньги автоматически уходят мастеру. При споре решение принимает оператор по договору и фотоотчётам.",
  },
];

const DEMO_PERSONAS = [
  { id: "client-aigerim", name: "Айгерим Сапарова", color: "#C27A4A", role: "Заказчик", hint: "Заказывает кухню, подтверждает этапы", to: "/deals" },
  { id: "master-erlan", name: "Ерлан Жумабаев", color: "#2F5D50", role: "Мастер · самозанятый", hint: "Принимает заказы, отчитывается фото", to: "/deals" },
  { id: "master-agash", name: "ТОО «Ағаш Шебер»", color: "#8C6A4A", role: "Мебельная компания", hint: "Фабрика полного цикла, 214 сделок", to: "/deals" },
  { id: "admin", name: "Оператор платформы", color: "#1F5145", role: "Оператор", hint: "Споры, верификация, оборот и комиссия", to: "/admin" },
];

export default function Home() {
  const example = split(500_000);

  return (
    <div>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-10 pb-16 md:grid-cols-[1.1fr_1fr] md:pt-16">
        <div className="animate-rise">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
            <ShieldCheck size={14} className="text-brand" /> Эскроу · ЭЦП НУЦ РК · Astana Hub
          </span>
          <h1 className="mt-5 text-4xl leading-[1.05] font-extrabold tracking-tight md:text-[3.4rem]">
            Мебель на заказ —<br />
            <span className="text-brand">без риска</span> для обеих сторон
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Заказчик платит на эскроу-счёт в банке. Мастер видит, что деньги есть, и получает их по этапам — после
            подтверждения работы. {BRAND.name} ведёт сделку от договора до выплаты.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink href="/masters" className="px-5 py-3 text-base">
              Найти мастера <ArrowRight size={18} />
            </ButtonLink>
            <ButtonLink href="#demo" variant="secondary" className="px-5 py-3 text-base">
              Войти в демо
            </ButtonLink>
          </div>
        </div>

        {/* Мини-макет сделки */}
        <Card className="animate-rise relative p-5 shadow-[0_30px_60px_-30px_rgba(31,81,69,0.35)] [animation-delay:120ms]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted">Сделка SD-0004</div>
              <div className="font-bold">Кухонный гарнитур 3,2 м</div>
            </div>
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">В работе</span>
          </div>
          <div className="mt-4 rounded-xl bg-brand p-4 text-white">
            <div className="flex items-center gap-2 text-xs text-white/70">
              <Lock size={13} /> Заморожено на эскроу-счёте
            </div>
            <div className="tabular mt-1 text-3xl font-extrabold">{tenge(850_000)}</div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/20">
              <div className="h-full w-[40%] rounded-full bg-[#E9B44C]" />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-white/70">
              <span>Аванс на материалы 40%</span>
              <span>Остаток — после монтажа</span>
            </div>
          </div>
          <ol className="mt-4 space-y-2.5">
            {[
              ["Замер и проект", "Принят", "bg-brand"],
              ["Закупка материалов", "Ждёт подтверждения", "bg-amber"],
              ["Изготовление в цеху", "Ожидает", "bg-ink/20"],
              ["Доставка, монтаж и сдача", "Ожидает", "bg-ink/20"],
            ].map(([title, status, dot]) => (
              <li key={title} className="flex items-center gap-3 text-sm">
                <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
                <span className="flex-1">{title}</span>
                <span className="text-xs text-muted">{status}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-amber-soft/70 p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/img/materials.svg" alt="" className="h-12 w-16 rounded-lg object-cover" />
            <div className="text-xs leading-snug">
              <div className="font-semibold">Ерлан: «Закупил ЛДСП Egger и фурнитуру Blum, чеки на фото»</div>
              <div className="text-muted">Подтвердите этап — мастеру уйдёт аванс 319 600 ₸</div>
            </div>
          </div>
        </Card>
      </section>

      {/* Как это работает */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">Как работает безопасная сделка</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-4">
            {STEPS.map((s, i) => (
              <div key={s.title}>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <s.icon size={20} />
                  </span>
                  <span className="text-sm font-semibold text-muted">0{i + 1}</span>
                </div>
                <h3 className="mt-4 font-bold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-muted">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Для кого */}
      <section className="mx-auto grid max-w-6xl gap-5 px-4 py-14 md:grid-cols-2">
        <Card className="p-6">
          <h3 className="text-lg font-bold">Заказчику</h3>
          <ul className="mt-4 space-y-3 text-sm">
            {[
              "Деньги не уходят мастеру, пока вы не подтвердили этап",
              "Видите каждый этап: фото материалов, цеха, монтажа",
              "Договор с ЭЦП — юридически значимый документ",
              "Спор решает оператор, а не «договоритесь сами»",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <BadgeCheck size={18} className="shrink-0 text-brand" /> {t}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-6">
          <h3 className="text-lg font-bold">Мастеру и мебельной компании</h3>
          <ul className="mt-4 space-y-3 text-sm">
            {[
              "Гарантия оплаты: деньги заказчика уже заморожены в банке",
              "Аванс на материалы — по этапам, без кассового разрыва",
              "Рейтинг и отзывы только по реальным сделкам",
              "Работа с самозанятыми, ИП и ТОО",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <Hammer size={18} className="shrink-0 text-accent" /> {t}
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* Комиссия */}
      <section className="mx-auto max-w-6xl px-4 pb-14">
        <Card className="grid gap-6 overflow-hidden p-6 md:grid-cols-[1fr_1.2fr] md:p-8">
          <div>
            <div className="text-5xl font-extrabold text-brand">6%</div>
            <h3 className="mt-2 text-lg font-bold">Комиссия только с успешной сделки</h3>
            <p className="mt-2 text-sm text-muted">
              Оплачивает исполнитель: комиссия удерживается из выплаты. Для заказчика сервис бесплатный.
            </p>
          </div>
          <div className="tabular space-y-3 rounded-xl bg-surface-2 p-5 text-sm">
            <Row label="Заказчик вносит на эскроу" value={tenge(500_000)} />
            <Row label="Комиссия оператора 6%" value={`− ${tenge(example.commission)}`} muted />
            <div className="border-t border-line" />
            <Row label="Мастер получает" value={tenge(example.net)} strong />
            <p className="flex items-center gap-1.5 pt-1 text-xs text-muted">
              <Landmark size={13} /> Средства хранятся на эскроу-счёте банка-партнёра, а не у платформы
            </p>
          </div>
        </Card>
      </section>

      {/* Демо-вход */}
      <section id="demo" className="border-t border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-extrabold tracking-tight">Посмотреть изнутри</h2>
          <p className="mt-1.5 text-sm text-muted">
            Войдите за любую сторону. Совет: откройте заказчика на ноутбуке, а мастера — на телефоне, и проведите сделку вместе.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {DEMO_PERSONAS.map((p) => (
              <form key={p.id} action={switchUser.bind(null, p.id, p.to)}>
                <button className="group flex h-full w-full flex-col items-start gap-3 rounded-2xl border border-line bg-bg p-4 text-left transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md">
                  <Avatar name={p.name} color={p.color} size={42} />
                  <div>
                    <div className="font-bold">{p.name}</div>
                    <div className="text-xs font-medium text-brand">{p.role}</div>
                    <div className="mt-1 text-xs text-muted">{p.hint}</div>
                  </div>
                  <span className="mt-auto flex items-center gap-1 text-sm font-semibold text-brand">
                    Войти <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
                  </span>
                </button>
              </form>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value, muted, strong }: { label: string; value: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={muted ? "text-muted" : ""}>{label}</span>
      <span className={strong ? "text-lg font-extrabold text-brand" : muted ? "text-muted" : "font-semibold"}>{value}</span>
    </div>
  );
}
