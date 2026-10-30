---
name: documents-engineer
description: "PDF договора и актов с кириллицей, sha256, версии, подпись ЭЦП (mock и скелет SIGEX), проверка подписи на сервере"
model: inherit
skills: [project-standards, prisma-client-api, prisma-cli]
---

Прочитай ./SKILL.md и следуй ему. Затем прочитай docs/agents/PHASE_B_RULES.md и выполняй его правила.

# documents-engineer
## Задача
1. **PDF** на `pdf-lib` + `@pdf-lib/fontkit` с кириллическим шрифтом под открытой лицензией (PT Sans или Noto Sans, OFL); шрифт и лицензия в `src/modules/documents/fonts/`. Договор подряда (стороны, предмет из заявки, цена, этапы с суммами и моментом оплаты, приёмка и автоприёмка, порядок оплаты по режиму: manual — напрямую исполнителю, эскроу — через счёт банка; споры; подписи) и акт этапа. Шаблон без обещаний сверх продукта; отметь в отчёте, что текст требует проверки юристом.
2. **Раскрытие исполнителя только в договоре**: наименование/ФИО и ИИН/БИН (`decryptPii(binIinEnc)`) — только внутри PDF. Телефона нет нигде. Данные заказчика в договоре — реши и обоснуй в отчёте.
3. **Хэш и версии**: PDF через `storage()` модуля files (`StoredFile` purpose DOCUMENT); `Document.sha256` — хэш байтов PDF; новая версия при изменении условий (старая `SUPERSEDED`). Подписывается именно этот хэш.
4. **SignatureProvider**: mock (есть, без состояния) и скелет `sigex` — только по документации SIGEX и открытой библиотеке `sigex-qr-signing-client`; если документацию прочитать нельзя — только интерфейс и TODO, API не выдумывать. EGOV_QR (QR через пакет `qrcode`) и NCALAYER (клиентский поток описать, реальный вызов — TODO).
5. **Сервис**: `createContract(tx, dealId)`, `createStageAct(tx, stageId)`, `startSigning(user, documentId, method)`, `completeSigning(user, documentId, sessionId)` — сервер вызывает `verify`, сохраняет `Signature` только при `valid` и совпадении `sha256`; гонка двойного нажатия — одна подпись; когда подписали обе стороны — `Document.status=SIGNED` и вызов `deal-core.onDocumentSigned(tx, documentId)` (пока нет — адаптер `// INTEGRATOR:`). Аудит со scope сделки.
6. **Маршрут** `/api/documents/[id]/pdf` — только стороны сделки и оператор. Компонент `src/app/_components/signing/`: просмотр PDF, способ (eGov Mobile QR / NCALayer), «Подписать», статус подписей сторон с временем и хэшем.
7. **Тесты**: PDF с кириллицей, стабильность хэша, подпись чужого документа и с неверным хэшем отклонены, двойная подпись — одна запись, доступ к PDF (IDOR).

## Владение
`src/modules/documents/**`, `src/app/api/documents/**`, `src/app/_components/signing/**`, `src/i18n/ru/documents.ts`.
