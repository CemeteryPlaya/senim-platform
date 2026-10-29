"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Coins,
  FileText,
  Hourglass,
  Lock,
  PartyPopper,
  PenLine,
  Scale,
  ShieldCheck,
  Undo2,
  XCircle,
} from "lucide-react";
import {
  acceptTermsAction,
  approveStageAction,
  cancelDealAction,
  counterOfferAction,
  openDisputeAction,
  requestReworkAction,
  resolveDisputeAction,
  submitStageAction,
} from "@/app/actions";
import { Badge, Button, Card, Field, inputClass } from "@/components/ui";
import { PhotoInput } from "@/components/photo-input";
import { PhotoGrid } from "@/components/photo-grid";
import { useAction } from "@/components/use-action";
import { moneyOf, type DealFull, type Viewer } from "@/lib/deal/query";
import { split, trancheFor } from "@/lib/deal/money";
import { date, dateTime, partyName, tenge } from "@/lib/format";
import { SignModal } from "./sign-modal";
import { BankModal } from "./bank-modal";

const STAGE_PHOTOS = ["/img/measure.svg", "/img/materials.svg", "/img/workshop.svg", "/img/install.svg"];
const AUTO_ACCEPT_DAYS = 5;

type ModalKind = "sign" | "fund" | null;

/**
 * Модалки живут здесь, а не в панелях статусов: после подписи или оплаты статус сделки меняется,
 * панель статуса размонтируется, а экран «Готово» должен остаться на месте.
 */
export function ActionPanel({ deal, viewer }: { deal: DealFull; viewer: Viewer }) {
  const [modal, setModal] = useState<ModalKind>(null);
  const me = viewer === "CLIENT" ? deal.client : deal.master;
  return (
    <>
      <StatusPanel deal={deal} viewer={viewer} openModal={setModal} />
      {modal === "sign" && (
        <SignModal
          onClose={() => setModal(null)}
          dealId={deal.id}
          contractNo={deal.contractNo ?? ""}
          amount={deal.amount}
          signer={{ name: me.name, iin: me.iin }}
        />
      )}
      {modal === "fund" && deal.escrow && (
        <BankModal
          onClose={() => setModal(null)}
          dealId={deal.id}
          amount={deal.amount}
          iban={deal.escrow.iban}
          contractNo={deal.contractNo ?? ""}
        />
      )}
    </>
  );
}

function StatusPanel({ deal, viewer, openModal }: { deal: DealFull; viewer: Viewer; openModal: (m: ModalKind) => void }) {
  switch (deal.status) {
    case "PROPOSED":
      return <Proposed deal={deal} viewer={viewer} />;
    case "AWAITING_SIGNATURES":
      return <Signing deal={deal} viewer={viewer} onSign={() => openModal("sign")} />;
    case "AWAITING_FUNDING":
      return <Funding deal={deal} viewer={viewer} onFund={() => openModal("fund")} />;
    case "IN_PROGRESS":
      return <Work deal={deal} viewer={viewer} />;
    case "DISPUTE":
      return <Dispute deal={deal} viewer={viewer} />;
    case "COMPLETED":
      return <Completed deal={deal} />;
    case "REFUNDED":
      return (
        <Panel tone="neutral" icon={<Undo2 />} title="Средства возвращены заказчику">
          <p className="text-sm text-muted">Оператор разрешил спор в пользу заказчика. Эскроу-счёт закрыт.</p>
        </Panel>
      );
    case "CANCELLED":
      return (
        <Panel tone="neutral" icon={<XCircle />} title="Сделка отменена">
          <p className="text-sm text-muted">Отмена до оплаты — без последствий для сторон.</p>
        </Panel>
      );
  }
}

// ─── Общие элементы ─────────────────────────────────────────────────────────

const PANEL_TONES = {
  action: "border-accent/60 bg-gradient-to-br from-accent-soft/70 to-surface",
  wait: "border-line bg-surface",
  good: "border-brand/30 bg-gradient-to-br from-brand-soft to-surface",
  bad: "border-red/30 bg-gradient-to-br from-red-soft to-surface",
  neutral: "border-line bg-surface",
};

const ICON_TONES = {
  action: "bg-accent text-white",
  wait: "bg-ink/5 text-muted",
  good: "bg-brand text-white",
  bad: "bg-red text-white",
  neutral: "bg-ink/5 text-muted",
};

function Panel({
  tone,
  icon,
  title,
  subtitle,
  children,
}: {
  tone: keyof typeof PANEL_TONES;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <Card className={clsx("animate-rise p-5", PANEL_TONES[tone])}>
      <div className="flex items-start gap-3.5">
        <span className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl [&>svg]:h-5 [&>svg]:w-5", ICON_TONES[tone])}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          {tone === "action" && <div className="text-xs font-bold tracking-wide text-accent uppercase">Нужно ваше действие</div>}
          <h2 className="text-lg leading-snug font-bold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="mt-4">{children}</div>}
    </Card>
  );
}

function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="mt-3 rounded-xl bg-red-soft p-3 text-sm text-red">{error}</p> : null;
}

const otherName = (deal: DealFull, viewer: Viewer) =>
  viewer === "CLIENT" ? (deal.master.master?.displayName ?? deal.master.name) : deal.client.name;

// ─── Согласование ───────────────────────────────────────────────────────────

function Proposed({ deal, viewer }: { deal: DealFull; viewer: Viewer }) {
  const [mode, setMode] = useState<"view" | "counter" | "cancel">("view");
  const { pending, error, run } = useAction();
  const myTurn = deal.awaitingParty === viewer;
  const advance = deal.stages.find((s) => s.order === 2)?.payoutPercent ?? 0;
  const { net } = split(deal.amount, deal.commissionRate);

  const terms = (
    <div className="tabular grid grid-cols-2 gap-3 rounded-xl bg-surface/80 p-4 text-sm sm:grid-cols-4">
      <Term label="Сумма" value={tenge(deal.amount)} strong />
      <Term label="Срок" value={`до ${date(deal.deadline)}`} />
      <Term label="Аванс на материалы" value={advance ? `${advance}%` : "нет"} />
      <Term label="Мастер получит" value={tenge(net)} />
    </div>
  );

  if (!myTurn) {
    return (
      <Panel
        tone="wait"
        icon={<Hourglass />}
        title={`Ждём ответа: ${otherName(deal, viewer)}`}
        subtitle={viewer === "CLIENT" ? "Мастер может принять условия или предложить изменения." : "Заказчик рассматривает ваше предложение."}
      >
        {terms}
        {viewer !== "ADMIN" && (
          <button
            onClick={() => run(() => cancelDealAction(deal.id, ""))}
            disabled={pending}
            className="mt-3 text-sm text-muted underline-offset-2 hover:text-red hover:underline"
          >
            Отозвать предложение
          </button>
        )}
        <ErrorText error={error} />
      </Panel>
    );
  }

  return (
    <Panel
      tone="action"
      icon={<FileText />}
      title={viewer === "MASTER" ? `Новый заказ от ${deal.client.name}` : "Мастер предложил изменения"}
      subtitle={
        viewer === "MASTER"
          ? "Проверьте условия. Деньги заказчика будут заморожены на эскроу до начала работ."
          : "Посмотрите новые условия и комментарий мастера в ленте."
      }
    >
      {terms}
      {mode === "view" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => run(() => acceptTermsAction(deal.id))}>
            <CheckCircle2 size={16} /> Принять условия
          </Button>
          <Button variant="secondary" onClick={() => setMode("counter")}>
            Предложить изменения
          </Button>
          <Button variant="ghost" className="text-muted" onClick={() => setMode("cancel")}>
            Отказаться
          </Button>
        </div>
      )}
      {mode === "counter" && <CounterForm deal={deal} advance={advance} onDone={() => setMode("view")} />}
      {mode === "cancel" && <CancelForm dealId={deal.id} onBack={() => setMode("view")} />}
      <ErrorText error={error} />
    </Panel>
  );
}

function Term({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={strong ? "text-base font-extrabold" : "font-semibold"}>{value}</div>
    </div>
  );
}

function CounterForm({ deal, advance, onDone }: { deal: DealFull; advance: number; onDone: () => void }) {
  const [amount, setAmount] = useState(deal.amount);
  const [deadline, setDeadline] = useState(new Date(deal.deadline).toISOString().slice(0, 10));
  const [adv, setAdv] = useState(advance);
  const [comment, setComment] = useState("");
  const { pending, error, run } = useAction();

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Сумма, ₸">
          <input
            value={new Intl.NumberFormat("ru-RU").format(amount)}
            onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "")) || 0)}
            className={`${inputClass} tabular`}
          />
        </Field>
        <Field label="Срок">
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Аванс">
          <select value={adv} onChange={(e) => setAdv(Number(e.target.value))} className={inputClass}>
            {[0, 30, 40, 50].map((p) => (
              <option key={p} value={p}>
                {p ? `${p}%` : "без аванса"}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Комментарий">
        <textarea
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Например: фасады в эмали дороже плёночных, зато не выгорают"
          className={inputClass}
        />
      </Field>
      <div className="flex gap-2">
        <Button
          disabled={pending}
          onClick={() => run(() => counterOfferAction(deal.id, { amount, deadline, advancePercent: adv, comment }), onDone)}
        >
          Отправить предложение
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Отмена
        </Button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

function CancelForm({ dealId, onBack }: { dealId: string; onBack: () => void }) {
  const [reason, setReason] = useState("");
  const { pending, error, run } = useAction();
  return (
    <div className="mt-4 space-y-3 rounded-xl border border-line bg-surface p-4">
      <Field label="Причина отказа (увидит вторая сторона)">
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} placeholder="Не подходят сроки" />
      </Field>
      <div className="flex gap-2">
        <Button variant="danger" disabled={pending} onClick={() => run(() => cancelDealAction(dealId, reason))}>
          Отказаться от сделки
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Назад
        </Button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

// ─── Подписание ─────────────────────────────────────────────────────────────

function Signing({ deal, viewer, onSign }: { deal: DealFull; viewer: Viewer; onSign: () => void }) {
  const sigs = deal.signatures.filter((s) => s.revision === deal.revision);
  const signedBy = (party: "CLIENT" | "MASTER") => sigs.find((s) => s.party === party);
  const mustSign = viewer !== "ADMIN" && !signedBy(viewer);

  return (
    <Panel
      tone={mustSign ? "action" : "wait"}
      icon={<PenLine />}
      title={mustSign ? "Подпишите договор ЭЦП" : "Ждём подпись второй стороны"}
      subtitle={`Договор подряда № ${deal.contractNo}. После двух подписей откроется эскроу-счёт в банке-партнёре.`}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {(["CLIENT", "MASTER"] as const).map((party) => {
          const s = signedBy(party);
          const person = party === "CLIENT" ? deal.client : deal.master;
          return (
            <div key={party} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
              {s ? <ShieldCheck className="text-brand" size={22} /> : <Clock className="text-muted" size={22} />}
              <div className="min-w-0 text-sm leading-tight">
                <div className="truncate font-semibold">{partyName(person)}</div>
                <div className="text-xs text-muted">
                  {s ? `Подписано ${s.method === "EGOV_QR" ? "в eGov Mobile" : "через NCALayer"} · ${dateTime(s.signedAt)}` : "Ожидает подписи"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {mustSign && (
          <Button onClick={onSign}>
            <PenLine size={16} /> Подписать ЭЦП
          </Button>
        )}
        <Link
          href={`/deals/${deal.id}/contract`}
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold hover:border-ink/30"
        >
          <FileText size={16} /> Открыть договор
        </Link>
      </div>
    </Panel>
  );
}

// ─── Оплата ─────────────────────────────────────────────────────────────────

function Funding({ deal, viewer, onFund }: { deal: DealFull; viewer: Viewer; onFund: () => void }) {
  if (viewer !== "CLIENT") {
    return (
      <Panel
        tone="wait"
        icon={<Lock />}
        title="Ждём оплату заказчика на эскроу"
        subtitle="Как только деньги поступят на эскроу-счёт, вы получите уведомление и можно начинать замер. До этого работы не начинайте."
      />
    );
  }
  return (
    <Panel
      tone="action"
      icon={<Lock />}
      title={`Внесите ${tenge(deal.amount)} на эскроу-счёт`}
      subtitle="Деньги будут заморожены в банке. Мастер получит их по этапам — только после вашего подтверждения."
    >
      <Button className="px-5 py-3 text-base" onClick={onFund}>
        <Lock size={16} /> Пополнить эскроу
      </Button>
    </Panel>
  );
}

// ─── Работа по этапам ───────────────────────────────────────────────────────

function payoutOnApprove(deal: DealFull, stageId: string) {
  const stage = deal.stages.find((s) => s.id === stageId)!;
  const isLast = stage.order === deal.stages.length;
  const gross = isLast ? moneyOf(deal).frozen : trancheFor(deal.amount, stage.payoutPercent);
  return { ...split(gross, deal.commissionRate), isLast };
}

function Work({ deal, viewer }: { deal: DealFull; viewer: Viewer }) {
  const stage = deal.stages.find((s) => s.status !== "APPROVED");
  if (!stage) return null;
  const pay = payoutOnApprove(deal, stage.id);
  const done = deal.stages.filter((s) => s.status === "APPROVED").length;

  if (viewer === "MASTER" && (stage.status === "IN_PROGRESS" || stage.status === "REWORK")) {
    return <SubmitStage deal={deal} stageId={stage.id} pay={pay} />;
  }

  if (viewer === "CLIENT" && stage.status === "SUBMITTED") {
    return <ReviewStage deal={deal} stageId={stage.id} pay={pay} />;
  }

  const autoAccept = stage.submittedAt ? new Date(new Date(stage.submittedAt).getTime() + AUTO_ACCEPT_DAYS * 86_400_000) : null;
  return (
    <Panel
      tone="wait"
      icon={<Hourglass />}
      title={
        stage.status === "SUBMITTED"
          ? `Этап «${stage.title}» ждёт подтверждения заказчика`
          : `Мастер работает: этап ${stage.order} из ${deal.stages.length} — «${stage.title}»`
      }
      subtitle={
        stage.status === "SUBMITTED" && autoAccept
          ? `Если заказчик не ответит, этап будет принят автоматически ${date(autoAccept)}.`
          : `Принято этапов: ${done} из ${deal.stages.length}. Деньги остаются замороженными на эскроу.`
      }
    >
      {viewer === "CLIENT" && <DisputeLink dealId={deal.id} />}
    </Panel>
  );
}

function SubmitStage({ deal, stageId, pay }: { deal: DealFull; stageId: string; pay: ReturnType<typeof payoutOnApprove> }) {
  const stage = deal.stages.find((s) => s.id === stageId)!;
  const [report, setReport] = useState(stage.status === "REWORK" ? (stage.report ?? "") : "");
  const [photos, setPhotos] = useState<string[]>(stage.status === "REWORK" ? stage.photos : []);
  const { pending, error, run } = useAction();

  return (
    <Panel
      tone="action"
      icon={<CheckCircle2 />}
      title={`${stage.status === "REWORK" ? "Доработайте" : "Сдайте"} этап ${stage.order}: «${stage.title}»`}
      subtitle={
        pay.gross > 0
          ? `После подтверждения заказчиком вы получите ${tenge(pay.net)} (комиссия ${tenge(pay.commission)}).`
          : "Отчитайтесь фото — заказчик видит прогресс и спокойно ждёт результат."
      }
    >
      {stage.status === "REWORK" && stage.clientNote && (
        <div className="mb-3 flex gap-2 rounded-xl bg-red-soft p-3 text-sm text-red">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> Замечания заказчика: {stage.clientNote}
        </div>
      )}
      <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <Field label="Что сделано">
          <textarea
            rows={3}
            value={report}
            onChange={(e) => setReport(e.target.value)}
            placeholder={PLACEHOLDERS[stage.order - 1]}
            className={inputClass}
          />
        </Field>
        <div>
          <div className="mb-1.5 text-sm font-medium">Фотоотчёт</div>
          <PhotoInput photos={photos} onChange={setPhotos} suggestions={[STAGE_PHOTOS[stage.order - 1]]} />
        </div>
        <Button disabled={pending || !report.trim()} onClick={() => run(() => submitStageAction(stage.id, report, photos))}>
          {pending ? "Отправляем…" : "Сдать этап заказчику"}
        </Button>
      </div>
      <ErrorText error={error} />
    </Panel>
  );
}

const PLACEHOLDERS = [
  "Сделал замер, отправил 3D-проект, согласовали цвет фасадов",
  "Закупил ЛДСП и фурнитуру, фасады заказаны в покраску. Чеки на фото",
  "Корпуса собраны, фасады готовы, всё упаковано к доставке",
  "Кухня установлена, фасады отрегулированы, мусор вывезли",
];

function ReviewStage({ deal, stageId, pay }: { deal: DealFull; stageId: string; pay: ReturnType<typeof payoutOnApprove> }) {
  const stage = deal.stages.find((s) => s.id === stageId)!;
  const [mode, setMode] = useState<"view" | "rework" | "dispute">("view");
  const [note, setNote] = useState("");
  const { pending, error, run } = useAction();

  return (
    <Panel
      tone="action"
      icon={<CheckCircle2 />}
      title={`Мастер сдал этап ${stage.order}: «${stage.title}»`}
      subtitle="Проверьте отчёт и фото. Если всё в порядке — подтвердите этап."
    >
      <div className="rounded-xl border border-line bg-surface p-4 text-sm">
        <div className="mb-1 text-xs text-muted">Отчёт мастера · {stage.submittedAt && dateTime(stage.submittedAt)}</div>
        {stage.report}
        {stage.photos.length > 0 && <PhotoGrid photos={stage.photos} size="lg" className="mt-3" />}
      </div>

      {pay.gross > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface/80 p-3 text-sm">
          <Coins size={16} className="shrink-0 text-accent" />
          <span>
            {pay.isLast ? "Это финальная приёмка: " : "При подтверждении "}
            мастеру будет перечислено <b>{tenge(pay.net)}</b> с эскроу-счёта
            {pay.isLast ? ", сделка закроется." : "."}
          </span>
        </div>
      )}

      {mode === "view" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => run(() => approveStageAction(stage.id))}>
            <CheckCircle2 size={16} /> {pay.isLast ? "Принять работу" : "Подтвердить этап"}
          </Button>
          <Button variant="secondary" onClick={() => setMode("rework")}>
            <Undo2 size={16} /> Вернуть на доработку
          </Button>
          <Button variant="ghost" className="text-red" onClick={() => setMode("dispute")}>
            <AlertTriangle size={16} /> Открыть спор
          </Button>
        </div>
      )}

      {mode !== "view" && (
        <div className="mt-4 space-y-3 rounded-xl border border-line bg-surface p-4">
          <Field
            label={mode === "rework" ? "Что нужно исправить" : "Причина спора"}
            hint={mode === "dispute" ? "Деньги останутся замороженными. Решение примет оператор по договору и фотоотчётам." : undefined}
          >
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputClass}
              placeholder={mode === "rework" ? "Не хватает чека на фурнитуру" : "Материалы не соответствуют договору"}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              variant={mode === "dispute" ? "danger" : "primary"}
              disabled={pending || !note.trim()}
              onClick={() =>
                run(() => (mode === "rework" ? requestReworkAction(stage.id, note) : openDisputeAction(deal.id, note)), () => setMode("view"))
              }
            >
              {mode === "rework" ? "Вернуть на доработку" : "Открыть спор"}
            </Button>
            <Button variant="ghost" onClick={() => setMode("view")}>
              Назад
            </Button>
          </div>
        </div>
      )}
      <ErrorText error={error} />
    </Panel>
  );
}

function DisputeLink({ dealId }: { dealId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, error, run } = useAction();
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-muted underline-offset-2 hover:text-red hover:underline">
        Что-то пошло не так? Открыть спор
      </button>
    );
  return (
    <div className="space-y-2">
      <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Опишите проблему" className={inputClass} />
      <div className="flex gap-2">
        <Button variant="danger" disabled={pending || !reason.trim()} onClick={() => run(() => openDisputeAction(dealId, reason))}>
          Открыть спор
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

// ─── Спор и завершение ──────────────────────────────────────────────────────

function Dispute({ deal, viewer }: { deal: DealFull; viewer: Viewer }) {
  const dispute = deal.disputes.find((d) => d.status === "OPEN");
  const frozen = moneyOf(deal).frozen;
  return (
    <Panel
      tone="bad"
      icon={<Scale />}
      title={viewer === "ADMIN" ? "Спор ждёт вашего решения" : "Спор на рассмотрении оператора"}
      subtitle={`${tenge(frozen)} остаются замороженными на эскроу до решения. Срок рассмотрения — до 5 рабочих дней.`}
    >
      {dispute && (
        <div className="rounded-xl border border-line bg-surface p-4 text-sm">
          <div className="text-xs text-muted">
            {dispute.openedBy.name} · {dateTime(dispute.createdAt)}
          </div>
          <p className="mt-1">{dispute.reason}</p>
        </div>
      )}
      {viewer === "ADMIN" && dispute && <ResolveDispute disputeId={dispute.id} frozen={frozen} />}
    </Panel>
  );
}

export function ResolveDispute({ disputeId, frozen }: { disputeId: string; frozen: number }) {
  const [note, setNote] = useState("");
  const { pending, error, run } = useAction();
  const half = Math.round(frozen / 2);
  return (
    <div className="mt-3 space-y-3">
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий к решению (увидят стороны)" className={inputClass} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => run(() => resolveDisputeAction(disputeId, "RELEASE", note))}>
          Выплатить мастеру {tenge(frozen)}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => run(() => resolveDisputeAction(disputeId, "SPLIT", note))}>
          Разделить 50/50 ({tenge(half)})
        </Button>
        <Button variant="danger" disabled={pending} onClick={() => run(() => resolveDisputeAction(disputeId, "REFUND", note))}>
          Вернуть заказчику
        </Button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

function Completed({ deal }: { deal: DealFull }) {
  const m = moneyOf(deal);
  return (
    <Panel tone="good" icon={<PartyPopper />} title="Сделка успешно завершена" subtitle="Работа принята, деньги автоматически выплачены исполнителю.">
      <div className="tabular grid grid-cols-3 gap-3 rounded-xl bg-surface/80 p-4 text-sm">
        <Term label="Внесено на эскроу" value={tenge(m.funded)} />
        <Term label="Получил мастер" value={tenge(m.toMaster)} strong />
        <Term label="Комиссия 6%" value={tenge(m.commission)} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Badge tone="green">Эскроу-счёт закрыт</Badge>
        {m.refunded > 0 && <Badge>Возвращено {tenge(m.refunded)}</Badge>}
      </div>
    </Panel>
  );
}
