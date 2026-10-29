"use client";

import { CheckCircle2, KeyRound, Monitor, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { signContractAction } from "@/app/actions";
import { Modal, Spinner } from "@/components/modal";
import { Button, inputClass } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { date, tenge } from "@/lib/format";

type Step = "method" | "connecting" | "cert" | "qr" | "signing" | "done";

export function SignModal({
  onClose,
  dealId,
  contractNo,
  amount,
  signer,
}: {
  onClose: () => void;
  dealId: string;
  contractNo: string;
  amount: number;
  signer: { name: string; iin: string };
}) {
  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<"NCALAYER" | "EGOV_QR">("NCALAYER");
  const { run, error } = useAction();

  function sign(m: "NCALAYER" | "EGOV_QR") {
    setStep("signing");
    setTimeout(() => run(() => signContractAction(dealId, m), () => setStep("done")), 900);
  }

  useEffect(() => {
    if (step === "connecting") {
      const t = setTimeout(() => setStep("cert"), 1100);
      return () => clearTimeout(t);
    }
    if (step === "qr") {
      const t = setTimeout(() => sign("EGOV_QR"), 4500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const [validTo] = useState(() => new Date(Date.now() + 300 * 86_400_000));

  return (
    <Modal onClose={onClose}>
      <div className="p-6">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-blue uppercase">
          <ShieldCheck size={15} /> Подписание ЭЦП · НУЦ РК
        </div>
        <h2 className="mt-1.5 pr-8 text-xl font-bold">Договор подряда № {contractNo}</h2>
        <p className="mt-1 text-sm text-muted">
          Сумма {tenge(amount)} · подписант {signer.name}
        </p>

        {step === "method" && (
          <div className="mt-5 space-y-3">
            <MethodButton
              icon={<Smartphone />}
              title="eGov Mobile"
              text="Подпись по QR-коду в приложении — без ключа на компьютере"
              onClick={() => {
                setMethod("EGOV_QR");
                setStep("qr");
              }}
            />
            <MethodButton
              icon={<Monitor />}
              title="NCALayer"
              text="Ключ ЭЦП (.p12) на компьютере или токене"
              onClick={() => {
                setMethod("NCALAYER");
                setStep("connecting");
              }}
            />
          </div>
        )}

        {step === "connecting" && (
          <div className="mt-8 flex flex-col items-center gap-3 py-6 text-sm text-muted">
            <Spinner className="text-blue" />
            Подключение к NCALayer (wss://127.0.0.1:13579)…
          </div>
        )}

        {step === "cert" && (
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              sign("NCALAYER");
            }}
          >
            <div className="rounded-2xl border border-line bg-surface-2 p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold">
                <KeyRound size={16} className="text-blue" /> GOST512_{signer.iin}.p12
              </div>
              <dl className="mt-3 grid grid-cols-[110px_1fr] gap-y-1.5 text-xs">
                <dt className="text-muted">Владелец</dt>
                <dd className="font-medium">{signer.name}</dd>
                <dt className="text-muted">ИИН</dt>
                <dd className="tabular font-medium">{signer.iin}</dd>
                <dt className="text-muted">Издатель</dt>
                <dd>ҰЛТТЫҚ КУӘЛАНДЫРУШЫ ОРТАЛЫҚ (ГОСТ)</dd>
                <dt className="text-muted">Действует до</dt>
                <dd>{date(validTo)}</dd>
              </dl>
            </div>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">Пароль от ключа</span>
              <input type="password" autoComplete="off" placeholder="Демо: введите любые символы" className={inputClass} />
            </label>
            <Button type="submit" className="w-full py-3">
              Подписать
            </Button>
          </form>
        )}

        {step === "qr" && (
          <div className="mt-5 flex flex-col items-center text-center">
            <FakeQr seed={dealId + signer.iin} />
            <ol className="mt-4 space-y-1 text-left text-sm text-muted">
              <li>1. Откройте eGov Mobile → «Сканировать QR»</li>
              <li>2. Проверьте документ и подтвердите подпись</li>
            </ol>
            <div className="mt-4 flex items-center gap-2 text-sm font-medium text-blue">
              <Spinner className="h-4 w-4" /> Ожидаем подтверждение в приложении…
            </div>
          </div>
        )}

        {step === "signing" && (
          <div className="mt-8 flex flex-col items-center gap-3 py-6 text-sm text-muted">
            {error ? (
              <p className="rounded-xl bg-red-soft p-3 text-red">{error}</p>
            ) : (
              <>
                <Spinner className="text-blue" />
                Формируем CMS-подпись и проверяем сертификат (OCSP)…
              </>
            )}
          </div>
        )}

        {step === "done" && (
          <div className="mt-6 flex flex-col items-center text-center">
            <CheckCircle2 size={56} className="text-brand" />
            <div className="mt-3 text-lg font-bold">Договор подписан</div>
            <p className="mt-1 text-sm text-muted">
              {method === "EGOV_QR" ? "Подпись подтверждена в eGov Mobile." : "Подпись сформирована через NCALayer."} Сертификат
              действителен, статус OCSP: good.
            </p>
            <Button className="mt-5 w-full" onClick={onClose}>
              Готово
            </Button>
          </div>
        )}
        <p className="mt-6 text-center text-[11px] text-muted">Демо: подпись имитируется. В продакшене — NCALayer / SIGEX + проверка на сервере.</p>
      </div>
    </Modal>
  );
}

function MethodButton({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 rounded-2xl border border-line p-4 text-left transition hover:border-blue hover:bg-blue-soft/40">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-soft text-blue">{icon}</span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted">{text}</span>
      </span>
    </button>
  );
}

const FINDERS = [
  [0, 0],
  [18, 0],
  [0, 18],
];

const QR_SIZE = 25;

/** Детерминированный «QR» из seed — только визуальная имитация. */
function qrCells(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const cells: [number, number][] = [];
  for (let y = 0; y < QR_SIZE; y++) {
    for (let x = 0; x < QR_SIZE; x++) {
      const f = FINDERS.find(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
      if (f) {
        const dx = x - f[0];
        const dy = y - f[1];
        if (dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)) cells.push([x, y]);
      } else {
        h = (h * 1103515245 + 12345) >>> 0;
        if (h / 2 ** 32 > 0.52) cells.push([x, y]);
      }
    }
  }
  return cells;
}

function FakeQr({ seed }: { seed: string }) {
  const n = QR_SIZE;
  const cells = qrCells(seed);

  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} className="h-48 w-48 rounded-xl border border-line bg-white" shapeRendering="crispEdges">
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#1b1f1d" />
      ))}
    </svg>
  );
}
