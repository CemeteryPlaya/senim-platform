"use client";

import { CheckCircle2, ChevronDown, Clock, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef } from "react";
import type { SignParty } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { SigningDocumentView } from "@/modules/documents/client";
import { Alert, Button, buttonClasses, Card, formatDateTime, formatTime, RadioCards, StatusBadge } from "@/ui";
import { completeSigningAction, startSigningAction } from "./actions";
import { focusTargetAfter, initialSigningState, signNotice, signingReducer, type SignMethodChoice } from "./state";

const t = ru.documents;
const PARTIES: SignParty[] = ["CLIENT", "EXECUTOR"];
const METHODS: SignMethodChoice[] = ["EGOV_QR", "NCALAYER"];

export type SigningPanelProps = {
  /** Документ из documents.listDealDocuments(user, dealId) — права уже проверены сервером. */
  document: SigningDocumentView;
  titleAs?: "h2" | "h3";
};

/**
 * Договор или акт: просмотр PDF, хэш, статус подписей сторон и подпись ЭЦП
 * (eGov Mobile по QR или NCALayer). После подписи обновляет экран (router.refresh).
 */
export function SigningPanel({ document: doc, titleAs = "h2" }: SigningPanelProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(signingReducer, initialSigningState);

  async function start() {
    if (state.step !== "choose") return;
    dispatch({ type: "start" });
    const res = await startSigningAction({ documentId: doc.id, method: state.method });
    dispatch(res.ok ? { type: "started", session: res.data } : { type: "failed", error: res.error });
  }

  async function complete() {
    if (state.step !== "awaiting") return;
    dispatch({ type: "complete" });
    const res = await completeSigningAction({ documentId: doc.id, sessionId: state.session.sessionId });
    if (!res.ok) return dispatch({ type: "failed", error: res.error });
    dispatch({ type: "completed", fullySigned: res.data.fullySigned });
    router.refresh();
  }

  const signed = new Map(doc.signatures.map((s) => [s.party, s]));

  return (
    <Card
      as="section"
      titleAs={titleAs}
      title={`${t.kinds[doc.kind]} № ${doc.number}`}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <span>{t.panel.version(doc.version)}</span>
          <StatusBadge tone={doc.status === "SIGNED" ? "success" : "warning"}>{t.status[doc.status]}</StatusBadge>
        </span>
      }
    >
      <a href={doc.pdfUrl} target="_blank" rel="noopener" className={buttonClasses({ variant: "secondary", fullWidth: true })}>
        <FileText aria-hidden className="size-5" />
        {t.panel.openPdf}
        <span className="sr-only"> ({t.panel.openPdfHint})</span>
      </a>

      {/* Хэш нужен юристу и банку, а не заказчику: спрятан, но доступен с клавиатуры. */}
      <details className="group rounded-control border border-line">
        <summary className="flex min-h-control-sm min-w-0 list-none items-center justify-between gap-3 rounded-control px-4 py-2 text-base font-semibold text-ink hover:bg-sunken [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">{t.panel.technical}</span>
          <ChevronDown aria-hidden className="size-5 shrink-0 group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-1 px-4 pb-4">
          <p className="text-base font-semibold text-ink">{t.panel.hash}</p>
          <p className="break-all font-mono text-base text-ink-soft">{doc.sha256}</p>
          <p className="text-base text-muted">{t.panel.hashHint}</p>
        </div>
      </details>

      <div className="flex flex-col gap-2">
        <p className="text-base font-semibold text-ink">{t.panel.signaturesTitle}</p>
        <ul className="flex flex-col gap-2">
          {PARTIES.map((party) => {
            const s = signed.get(party);
            return (
              <li key={party} className="flex items-start gap-2 text-base text-ink">
                {s ? (
                  <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
                ) : (
                  <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
                )}
                <span>
                  {s ? t.panel.signedAt(t.parties[party], formatDateTime(s.signedAt)) : t.panel.notSigned(t.parties[party])}
                  {s && s.signedSha256 === doc.sha256 && <span className="block text-muted">{t.panel.hashMatches}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <SignArea doc={doc} state={state} onMethod={(method) => dispatch({ type: "method", method })} onStart={start} onComplete={complete} onReset={() => dispatch({ type: "reset" })} />
    </Card>
  );
}

const FOCUS_SELECTOR = { result: "[data-sign-result]", method: "input[type=radio]:checked" } as const;

type SignAreaProps = {
  doc: SigningDocumentView;
  state: ReturnType<typeof signingReducer>;
  onMethod: (m: SignMethodChoice) => void;
  onStart: () => void;
  onComplete: () => void;
  onReset: () => void;
};

function SignArea(props: SignAreaProps) {
  const { state } = props;
  const area = useRef<HTMLDivElement>(null);
  const prevStep = useRef(state.step);
  // Кнопка, на которой стоял фокус, исчезает при смене шага: переводим фокус на итог подписи
  // или (после «Выбрать другой способ») на выбранный способ — иначе он падает в начало страницы.
  useEffect(() => {
    const target = focusTargetAfter(prevStep.current, state.step);
    prevStep.current = state.step;
    if (target) area.current?.querySelector<HTMLElement>(FOCUS_SELECTOR[target])?.focus();
  }, [state.step]);
  return (
    <div ref={area}>
      <SignStep {...props} />
    </div>
  );
}

function SignStep({ doc, state, onMethod, onStart, onComplete, onReset }: SignAreaProps) {
  if (state.step === "done") {
    return (
      <div data-sign-result tabIndex={-1} className="rounded-control">
        <Alert tone="success" live="polite">
          {state.fullySigned ? t.panel.fullySigned : t.panel.signedOk}
        </Alert>
      </div>
    );
  }
  if (doc.myParty === null) return <p className="text-base text-muted">{t.panel.operatorView}</p>;
  if (!doc.canSign) {
    const notice = signNotice(doc);
    if (notice === "youSigned") return <Alert tone="success">{t.panel.youSigned}</Alert>;
    return notice === "notSignable" ? <p className="text-base text-muted">{t.panel.notSignable}</p> : null;
  }

  if (state.step === "choose" || state.step === "starting") {
    return (
      <div className="flex flex-col gap-4">
        <RadioCards
          label={t.panel.methodLabel}
          name={`sign-method-${doc.id}`}
          value={state.method}
          onChange={(v) => onMethod(v as SignMethodChoice)}
          disabled={state.step === "starting"}
          options={METHODS.map((m) => ({ value: m, label: t.methods[m].label, description: t.methods[m].description }))}
        />
        {state.step === "choose" && state.error && (
          <Alert tone="danger" live="assertive">
            {state.error}
          </Alert>
        )}
        <Button fullWidth loading={state.step === "starting"} onClick={onStart}>
          {t.panel.sign}
        </Button>
      </div>
    );
  }

  return <AwaitingArea state={state} onComplete={onComplete} onReset={onReset} />;
}

/**
 * Ожидание подписи: QR или NCALayer. Кнопка «Подписать» исчезла — фокус переводим на подсказку,
 * что делать дальше, иначе он падает в начало страницы и диктор молчит.
 */
function AwaitingArea({
  state,
  onComplete,
  onReset,
}: {
  state: Extract<ReturnType<typeof signingReducer>, { step: "awaiting" | "completing" }>;
  onComplete: () => void;
  onReset: () => void;
}) {
  const hint = useRef<HTMLParagraphElement>(null);
  useEffect(() => hint.current?.focus(), []);
  const { session } = state;
  return (
    <div className="flex flex-col gap-4">
      {session.provider === "mock" && <Alert tone="info">{t.panel.mockNotice}</Alert>}
      {session.method === "EGOV_QR" && session.qrImage && (
        // QR — картинка data:image/png от сервера; next/image для data-URL не нужен.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={session.qrImage} alt={t.panel.qrAlt} width={288} height={288} className="mx-auto rounded-control border border-line bg-surface" />
      )}
      <p ref={hint} tabIndex={-1} className="rounded-control text-base text-ink">
        {session.method === "EGOV_QR" ? t.panel.qrHint : t.panel.ncalayerHint}
      </p>
      <p className="text-base text-muted">{t.panel.sessionExpires(formatTime(session.expiresAt))}</p>
      {state.step === "awaiting" && state.error && (
        <Alert tone="danger" live="assertive">
          {state.error}
        </Alert>
      )}
      <Button fullWidth loading={state.step === "completing"} onClick={onComplete}>
        {t.panel.confirmSigned}
      </Button>
      <Button variant="ghost" fullWidth disabled={state.step === "completing"} onClick={onReset}>
        {t.panel.cancel}
      </Button>
    </div>
  );
}
