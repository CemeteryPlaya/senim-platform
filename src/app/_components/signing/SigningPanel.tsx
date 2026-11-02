"use client";

import { CheckCircle2, ChevronDown, Clock, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef } from "react";
import { ru } from "@/i18n/ru";
import type { SigningDocumentView } from "@/modules/documents/client";
import { Alert, Button, buttonClasses, Card, formatDateTime, formatTime, RadioCards, StatusBadge } from "@/ui";
import { completeSigningAction, signByHandAction, startSigningAction } from "./actions";
import { HandSignaturePad } from "./HandSignaturePad";
import type { HandPayload } from "./hand-state";
import { documentBadge, focusTargetAfter, initialSigningState, signingReducer, signStep, type SignMethodChoice } from "./state";

const t = ru.documents;
const METHODS: SignMethodChoice[] = ["EGOV_QR", "NCALAYER"];

export type SigningPanelProps = {
  /** Документ из documents.listDealDocuments(user, dealId) — права уже проверены сервером. */
  document: SigningDocumentView;
  titleAs?: "h2" | "h3";
  /** ФИО текущего пользователя — подставляется в «Напечатать имя». */
  signerName?: string;
};

/**
 * Оферта или акт: просмотр PDF, хэш, подписи сторон (собственноручная и ЭЦП — время и хэш) и подпись:
 * шаг 1 — собственноручно (холст или напечатанное имя), шаг 2 — ЭЦП (eGov Mobile по QR или NCALayer).
 * После каждой подписи обновляет экран (router.refresh).
 */
export function SigningPanel({ document: doc, titleAs = "h2", signerName }: SigningPanelProps) {
  const badge = documentBadge(doc);
  return (
    <Card
      as="section"
      titleAs={titleAs}
      title={`${t.kinds[doc.kind]} № ${doc.number}`}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <span>{t.panel.version(doc.version)}</span>
          <StatusBadge tone={badge.tone}>{badge.text}</StatusBadge>
        </span>
      }
    >
      <a href={doc.pdfUrl} target="_blank" rel="noopener" className={buttonClasses({ variant: "secondary", fullWidth: true })}>
        <FileText aria-hidden className="size-5" />
        {t.panel.openPdf}
        <span className="sr-only"> ({t.panel.openPdfHint})</span>
      </a>

      {/* Хэш нужен юристу и банку, а не покупателю: спрятан, но доступен с клавиатуры. */}
      <details className="group rounded-control border border-line">
        <summary className="flex min-h-control-sm min-w-0 list-none items-center justify-between gap-3 rounded-control px-4 py-2 text-base font-semibold text-ink hover:bg-sunken [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">{t.panel.technical}</span>
          <ChevronDown aria-hidden className="size-5 shrink-0 group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-1 px-4 pb-4">
          <p className="text-base font-semibold text-ink">{t.panel.hash}</p>
          <p className="break-all font-mono text-base text-ink-soft">{doc.sha256}</p>
          <p className="text-base text-muted">{t.panel.hashHint}</p>
          <a href={doc.originalPdfUrl} target="_blank" rel="noopener" className="text-base font-semibold text-accent underline underline-offset-4">
            {t.panel.originalPdf}
          </a>
        </div>
      </details>

      {doc.signable && <PartiesStatus doc={doc} />}

      <StepArea doc={doc} signerName={signerName} />
    </Card>
  );
}

/** Что показать под подписями: шаг 1 (от руки), шаг 2 (ЭЦП) или пояснение, почему подписывать нечего. */
function StepArea({ doc, signerName }: { doc: SigningDocumentView; signerName?: string }) {
  const router = useRouter();
  async function signHand(payload: HandPayload) {
    const res = await signByHandAction("imageDataUrl" in payload ? { documentId: doc.id, imageDataUrl: payload.imageDataUrl } : { documentId: doc.id, typedName: payload.typedName });
    if (!res.ok) return res.error;
    router.refresh();
    return null;
  }
  switch (signStep(doc)) {
    case "hand":
      return (
        <section aria-label={t.panel.stepHand} className="flex flex-col gap-2">
          <p className="text-base font-semibold text-muted">{t.panel.stepHand}</p>
          <HandSignaturePad onSubmit={signHand} defaultName={signerName} />
        </section>
      );
    case "ecp":
      return <EcpArea doc={doc} />;
    case "youSigned":
      return <Alert tone="success">{t.panel.youSigned}</Alert>;
    case "notSignable":
      return <p className="text-base text-muted">{t.panel.notSignable}</p>;
    case "operator":
      return doc.signable ? <p className="text-base text-muted">{t.panel.operatorView}</p> : null;
    case "closed":
      return doc.status === "SUPERSEDED" ? <Alert tone="warning">{t.panel.superseded}</Alert> : null;
    case "notRequired":
      return null;
  }
}

/** Подписи обеих сторон: что требуется, что поставлено, когда и тот ли хэш. */
function PartiesStatus({ doc }: { doc: SigningDocumentView }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base font-semibold text-ink">{t.panel.signaturesTitle}</p>
      <ul className="flex flex-col gap-3">
        {doc.parties.map((p) => (
          <li key={p.party} className="flex flex-col gap-1">
            <p className="text-base font-semibold text-ink">{t.parties[p.party]}</p>
            <SignatureLine label={t.panel.handSignature} required={p.required.hand} signed={p.hand && { at: p.hand.signedAt, sha: p.hand.documentSha256 }} sha256={doc.sha256} />
            <SignatureLine label={t.panel.ecpSignature} required={p.required.ecp} signed={p.ecp && { at: p.ecp.signedAt, sha: p.ecp.signedSha256 }} sha256={doc.sha256} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SignatureLine({ label, required, signed, sha256 }: { label: string; required: boolean; signed: { at: Date; sha: string } | null; sha256: string }) {
  if (!required && !signed) return <p className="text-base text-muted">{t.panel.notRequired(label)}</p>;
  return (
    <p className="flex items-start gap-2 text-base text-ink">
      {signed ? <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" /> : <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />}
      <span>
        {signed ? t.panel.signedAt(label, formatDateTime(signed.at)) : t.panel.notSigned(label)}
        {signed && signed.sha === sha256 && <span className="block text-muted">{t.panel.hashMatches}</span>}
      </span>
    </p>
  );
}

const FOCUS_SELECTOR = { result: "[data-sign-result]", method: "input[type=radio]:checked" } as const;

/** Шаг 2: ЭЦП через провайдера подписи (mock / SIGEX) — выбор способа, QR или NCALayer, проверка на сервере. */
function EcpArea({ doc }: { doc: SigningDocumentView }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(signingReducer, initialSigningState);
  const area = useRef<HTMLDivElement>(null);
  const prevStep = useRef(state.step);
  // Кнопка, на которой стоял фокус, исчезает при смене шага: переводим фокус на итог или на выбранный способ.
  useEffect(() => {
    const target = focusTargetAfter(prevStep.current, state.step);
    prevStep.current = state.step;
    if (target) area.current?.querySelector<HTMLElement>(FOCUS_SELECTOR[target])?.focus();
  }, [state.step]);

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

  return (
    <section ref={area} aria-label={t.panel.stepEcp} className="flex flex-col gap-4">
      <p className="text-base font-semibold text-muted">{t.panel.stepEcp}</p>
      {state.step === "done" ? (
        <div data-sign-result tabIndex={-1} className="rounded-control">
          <Alert tone="success" live="polite">
            {state.fullySigned ? t.panel.fullySigned : t.panel.signedOk}
          </Alert>
        </div>
      ) : state.step === "choose" || state.step === "starting" ? (
        <>
          <RadioCards
            label={t.panel.methodLabel}
            name={`sign-method-${doc.id}`}
            value={state.method}
            onChange={(v) => dispatch({ type: "method", method: v as SignMethodChoice })}
            disabled={state.step === "starting"}
            options={METHODS.map((m) => ({ value: m, label: t.methods[m].label, description: t.methods[m].description }))}
          />
          {state.step === "choose" && state.error && (
            <Alert tone="danger" live="assertive">
              {state.error}
            </Alert>
          )}
          <Button fullWidth loading={state.step === "starting"} onClick={start}>
            {t.panel.sign}
          </Button>
        </>
      ) : (
        <AwaitingArea state={state} onComplete={complete} onReset={() => dispatch({ type: "reset" })} />
      )}
    </section>
  );
}

/**
 * Ожидание подписи: QR или NCALayer. Кнопка «Подписать» исчезла — фокус на подсказку, что делать дальше,
 * иначе он падает в начало страницы и диктор молчит.
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
