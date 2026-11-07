# Соответствие ТЗ MVP v1.0

Каждый пункт ТЗ (`docs/tz/TZ_MVP_v1.0.pdf`, `docs/tz/technical-handover.md`) → где сделано (код, тест, экран) → статус. Решения и отступления — ADR-009 и `docs/OPEN_QUESTIONS.md` (№37–63); что нужно от владельца — `docs/OWNER_TODO.md`. Обновляется в конце каждой фазы.

Статусы:
- **сделано** — есть код и автотест;
- **сделано на моках** — код и тест есть, боевая часть зависит от владельца (договор, ключи, юрпроверка, реальный сервис) — номер в `OWNER_TODO`;
- **частично** — в примечании сказано, чего нет;
- **не сделано** — с причиной;
- **Фаза 2** — по ТЗ вне Фазы 1, за флагом `src/platform/features.ts` (по умолчанию выключен — `features.test.ts`).

В колонке «Где»: **код** — модуль или файл (пути от `src/`), **тест** — файл теста, **экран** — маршрут `src/app/...`. Деньги покупателя лежат на счёте в банке; платформа только фиксирует операции.

_Обновлено: 03.11.2026, фаза E._

## 1. Цель и рамки Фазы 1
| Пункт ТЗ | Где | Статус |
|---|---|---|
| 1.1 PWA-флоу одной сделки: заказ → отклики и торг → оферта → оплата → статусы → сдача с фото → акт → выплата 4% + 2% | **код:** `modules/requests`, `modules/deal-core`, `modules/payments`, `modules/documents`<br>**тест:** `deal-core/deal.int.test.ts` («полный путь на mock»), `e2e/20-full-deal.spec.ts` (manual)<br>**экран:** `/requests/new`, `/executor/requests/[id]`, `/requests/[id]/offers/[offerId]`, `/deals/[id]` | сделано |
| 1.2 Критерий: деньги считаются верно до тиына | **код:** `payments/money.ts`<br>**тест:** `payments/money.test.ts` (fast-check), `e2e/20-full-deal.spec.ts` (история, выписка, акт, журнал оператора), `e2e/22-disputes.spec.ts` (раздел по спору) | сделано |
| 1.3 Критерий: статусы не ломаются ни в одном сценарии, включая отмену и спор | **код:** `deal-core/transitions.ts`<br>**тест:** `deal-core/transitions.int.test.ts`, `e2e/21-cancel-refund.spec.ts`, `e2e/22-disputes.spec.ts` | сделано |
| 1.4 В Фазе 1 не делаем: AR-рулетку, ИИ-визуализатор, SEO, B2B-тендеры, ретро-бонусы, ИИ-арбитраж, сторы, анти-обход | ИИ (визуализатор, помощник, подсказка в споре) — `modules/ai`, выключен `AI_ENABLED` (`ai/deps.ts`); прочего в коде нет (поиск по коду). Спор решает человек — `operator/disputes`<br>**тест:** `platform/features.test.ts`, `operator/settings.int.test.ts` | сделано |

## 2. Роли
| Пункт ТЗ | Где | Статус |
|---|---|---|
| 2.1 Покупатель: заказ, выбор мастера, торг, оплата, приёмка, подпись | **код:** `Role.CLIENT`, `modules/identity`<br>**тест:** `identity/roles.test.ts`, `identity/rbac.test.ts`, `e2e/20-full-deal.spec.ts`<br>**экран:** `/requests`, `/deals/[id]` | сделано |
| 2.2 Мастер (ИП/ТОО): отклики, торг, работа, сдача с фото, выплата | **код:** `Role.EXECUTOR`, `identity` (регистрация), `companies`<br>**тест:** `identity/registration.int.test.ts`, `e2e/03-executor-offer.spec.ts`, `e2e/20-full-deal.spec.ts`<br>**экран:** `/register/executor`, `/executor/requests`, `/executor/finance` | сделано |
| 2.3 Админ: модерация, ручное управление статусами денег, споры, аудит-лог | **код:** `modules/operator`<br>**тест:** `operator/executors.int.test.ts`, `operator/money.int.test.ts`, `operator/disputes.int.test.ts`, `operator/report.int.test.ts` (журнал аудита), `operator/access.int.test.ts`, `e2e/10-operator-approve.spec.ts`, `e2e/20-full-deal.spec.ts`, `e2e/22-disputes.spec.ts`<br>**экран:** `/operator/executors`, `/operator/kyc`, `/operator/money`, `/operator/disputes/[id]`, `/operator/audit`, `/operator/deals/[id]`, `/operator/income`, `/operator/report`, `/operator/settings` | сделано |

## 3. Дизайн-основа
| Пункт ТЗ | Где | Статус |
|---|---|---|
| 3.1 Вёрстка по 18-страничному концепту «Сенім» (кабинет мастера — стр. 12, замер — стр. 15, приёмка/акт/выплата — стр. 18) | Макеты в репозитории — 21 файл `docs/design/mockups/`, разбор — `docs/design/MOCKUPS.md`; акт — `documents/templates/acceptance-act.ts` «по макету стр. 18» | частично: полного 18-страничного концепта в репозитории нет, сверка вёрстки с ним и согласование отклонений — визуально, владельцем; автотеста на соответствие макету нет |
| 3.2 Нижняя навигация под палец | **код:** `app/_shell/nav.ts`, `ShellNav.tsx`<br>**тест:** `app/_shell/nav.test.ts` | сделано |
| 3.3 Минимализм, до любой цели 2–3 нажатия | Одно главное действие на экране сделки — `deal-core/next-step.ts` (блок «Что дальше»); «Подробнее о заказе» свёрнуто<br>**тест:** `deal-core/next-step.test.ts` | частично: число нажатий до цели автотестом не измеряется; сделки покупателя — из «Профиль»/«Ещё» (`nav.test.ts`), т. е. до действия по сделке 3 нажатия |
| 3.4 Первый шаг заказа — только стиль и тип; ЛДСП/МДФ/фурнитура — свёрнутое «Для продвинутых» | **код:** `app/requests/new/ChoiceSteps.tsx` (`StartStep`, `Advanced`)<br>**тест:** `e2e/02-request-wizard.spec.ts`<br>**экран:** `/requests/new` | сделано. Первый шаг — тип мебели (кухня, шкаф…) и стиль картинками; «тип комнаты» ТЗ понят как тип мебели |
| 3.5 Контакты сторон (телефон, Instagram) скрыты до заключения оферты | **код:** `companies` (контакты, `mask.ts`), граница — `Deal.signedAt`; показ телефона по согласию до оферты — флаг `clientPhoneConsent` (выключен, OQ №40)<br>**тест:** `companies/contacts.int.test.ts`, `companies/mask.test.ts`, `companies/contacts-policy.test.ts`, `e2e/08-chat-masking.spec.ts`<br>**экран:** `/deals/[id]` (`_components/chat/DealContacts`), чат отклика | сделано |
| 3.6 Название — в конфиге, не в коде | **код:** `config/brand.ts`<br>**тест:** `config/brand.test.ts` | сделано. Итоговое название после проверки товарного знака — `OWNER_TODO` №24 |

## 4. Экран денег
| Пункт ТЗ | Где | Статус |
|---|---|---|
| 4.1 Блок денег — первый и самый заметный в карточке заказа | **код:** `app/deals/[id]/page.tsx` (первым идёт `MoneyBlock`), `_parts/MoneyBlock.tsx`<br>**тест:** `app/deals/[id]/_parts/money-panel.test.ts`, `e2e/20-full-deal.spec.ts`<br>**экран:** `/deals/[id]` | сделано |
| 4.1 Состояния у покупателя: CREATED — серый «Ожидает оплаты — деньги ещё не внесены»; PAID_HOLD…READY — зелёный «… — под защитой банка. Недоступны мастеру до вашей подписи акта» + дата резервирования + номер операции; спор — жёлтый «Выплата заморожена до решения спора»; ACCEPTED/SPLIT_PAYOUT — «Сделка завершена. Выплачено мастеру … · Защита сделки …» | **код:** `_parts/money-panel.ts`, `payments/projection.ts`; дополнительно — «Оплата в обработке», «Оплата не прошла», возврат<br>**тест:** `money-panel.test.ts`, `payments/projection.test.ts`, `deal-core/dispute.int.test.ts` (жёлтый блок), `e2e/20-full-deal.spec.ts`, `e2e/22-disputes.spec.ts` | сделано |
| 4.2 Зеркальный блок мастера в карточке **заявки**, до принятия заказа: «Деньги покупателя будут зарезервированы в банке до начала работ» | **код:** `app/executor/requests/[id]/page.tsx` (`ru.payments.block.masterBeforePayment`)<br>**экран:** `/executor/requests/[id]` | частично: строка на экране есть, автотеста на неё в карточке заявки нет (тот же текст проверен только в карточке сделки — `money-panel.test.ts`) |
| 4.2 У мастера до и после оплаты в карточке сделки: «Деньги зарезервированы: … — получите после подписания акта покупателем» (сумма к его выплате) | **код:** `_parts/money-panel.ts`<br>**тест:** `money-panel.test.ts`, `e2e/20-full-deal.spec.ts`<br>**экран:** `/deals/[id]` | сделано |
| 4.3 История денег: тап по блоку → таймлайн «Зарезервировано → Удержано на время спора → Выплачено» с датами и ссылками на документы | **код:** `app/deals/[id]/money/page.tsx`, `payments/projection.ts` (история по `seq`, документ-основание)<br>**тест:** `payments/projection.test.ts` («история денег»), `e2e/20-full-deal.spec.ts`, `e2e/22-disputes.spec.ts`, `e2e/09-access.spec.ts` (чужая история — 404)<br>**экран:** `/deals/[id]/money` | сделано |
| 4.3 Уведомление обеим сторонам при каждом изменении денег | **код:** `deal-core/money.ts` (`onMoneyChanged` — одна точка на каждую операцию с итогом), `modules/notifications` (in-app; web push дублирует каждое уведомление)<br>**тест:** `payments/webhook.int.test.ts`, `deal-core/manual.int.test.ts` (уведомления обеим сторонам), `notifications/push.int.test.ts`, `app/_components/install/sw.test.ts`<br>**экран:** `/notifications` | сделано на моках: in-app работает всегда; web push — после ключей VAPID (`OWNER_TODO` №19), без них выключен |
| 4.4 Блок строится из журнала операций, а не из статуса заказа | **код:** `payments/ledger.ts`, `payments/projection.ts`; `MoneyTransaction` только на добавление (триггер `money_transaction_append_only`); финансы мастера — тоже из журнала (`deal-core/finance.ts`)<br>**тест:** `payments/projection.test.ts` («блок денег — только из журнала»), `payments/ledger.int.test.ts`, `deal-core/finance.int.test.ts`<br>**экран:** `/deals/[id]`, `/executor/finance` | сделано |

## 5. Терминология денег
| Пункт ТЗ | Где | Статус |
|---|---|---|
| 5.1 Покупатель: «Защита сделки (2%)»; смета «Стоимость заказа · Защита сделки (2%) · Итого к оплате» | **код:** `i18n/ru/payments.ts` (`estimate.CLIENT`), `payments/estimate.ts`<br>**тест:** `payments/estimate.test.ts`, `app/deals/[id]/_parts/deal-view.test.ts`, `requests/negotiation.int.test.ts`, `e2e/20-full-deal.spec.ts`<br>**экран:** `/requests/[id]/offers/[offerId]` (смета в торге), `/deals/[id]` (смета до оплаты) | сделано |
| 5.2 Мастер: «Гарантия оплаты и клиента — 4%»; смета «Сумма заказа · Гарантия оплаты (4%) · К выплате» | **код:** `i18n/ru/payments.ts` (`estimate.EXECUTOR`); полное название — в оферте `documents/templates/contract.ts`<br>**тест:** `estimate.test.ts`, `deal-view.test.ts`, `documents/templates/templates.test.ts`, `e2e/20-full-deal.spec.ts`<br>**экран:** `/executor/requests/[id]`, `/deals/[id]` | сделано. В экранах мастера — формулировка сметы ТЗ «Гарантия оплаты (4%)», полное «…и клиента (4%)» — в оферте |
| 5.3 Нет «комиссия»; нет «эскроу» у покупателя (и мастера) — «деньги в банке под защитой»; «эскроу» — в документах и оферте | **код:** `i18n/ru/*`; исключены зоны `operator`, `bankDemo` и `documents.pdf`<br>**тест:** `i18n/forbidden-words.test.ts`, `payments/texts.test.ts`, `templates.test.ts` (выписка), `e2e/20-full-deal.spec.ts` (страницы сторон без этих слов) | сделано |
| 5.4 Суммы и проценты видны до подтверждения оплаты | Смета в торге и в карточке до оплаты, сумма на кнопке «Оплатить»<br>**тест:** `requests/negotiation.int.test.ts` («смета до оплаты»), `e2e/20-full-deal.spec.ts`<br>**экран:** `/requests/[id]/offers/[offerId]`, `/deals/[id]` | сделано |

## 6. Расчёт денег
| Пункт ТЗ | Где | Статус |
|---|---|---|
| 6.1 Покупатель X × 1,02; мастер X × 0,96; доход платформы 6%; пример 1 500 000 → 1 530 000 / 1 440 000 / 90 000. Сплит 94/6 заменён | **код:** `payments/money.ts` (`computeDealMoney`, `computeSplit` для раздела по спору)<br>**тест:** `payments/money.test.ts` (пример ТЗ п. 6 и п. 4.1), `e2e/20-full-deal.spec.ts` | сделано |
| 6.2 Суммы — целые тиыны, без float | **код:** `*Tiyn BigInt` в `prisma/schema.prisma`, `formatTiyn` (`ui/format.ts`), суммы Freedom Pay — строкой без float<br>**тест:** `ui/format.test.ts`, `payments/money.test.ts` («тенге в тиыны»), `payments/providers/freedompay/client.test.ts` | сделано |
| 6.3 Округление: защита — вверх, выплата — вниз; сверка «приход = выплата + доход» до тиына автотестом | **код:** `ROUNDING` в `payments/money.ts`, CHECK `Deal_money_formula` в БД<br>**тест:** `money.test.ts` (свойства fast-check), `payments/ledger.int.test.ts` (CHECK), `demo/seed.int.test.ts` (журнал демо сходится) | сделано. Формулировка ТЗ «вверх в пользу покупателя» противоречива — OQ №37 |

## 7. Документы
| Пункт ТЗ | Где | Статус |
|---|---|---|
| 7.1 Оферта/договор сделки (PDF): стороны, сумма, сроки, условия | **код:** `documents/templates/contract.ts`, `documents/issue.ts`, `documents/pdf/render.ts`<br>**тест:** `documents/documents.int.test.ts` («оферта: PDF, хэш, версии»), `templates.test.ts`, `pdf/render.test.ts`<br>**экран:** `/deals/[id]` (раздел документов), `/api/documents/[id]/pdf` | сделано на моках: шаблон помечен «требует юридической проверки» — `OWNER_TODO` №17; ЭЦП — mock, SIGEX — `OWNER_TODO` №8 |
| 7.2 Акт приёмки (PDF, по макету стр. 18), подписывается покупателем в приложении | **код:** `documents/templates/acceptance-act.ts` (фото с хэшем, GPS-отметка), `app/_components/signing/` (`SigningPanel`, `HandSignaturePad`); покупатель — от руки и ЭЦП, мастер — ЭЦП; подпись мастера от руки — флаг `executorHandSignsAct` (OQ №39)<br>**тест:** `documents.int.test.ts` («акт приёмки»), `templates.test.ts`, `_components/signing/state.test.ts`, `hand-state.test.ts`, `e2e/20-full-deal.spec.ts` (суммы и «в радиусе» в PDF акта)<br>**экран:** `/deals/[id]` | сделано на моках: ЭЦП — mock (`OWNER_TODO` №8); юрпроверка акта и подписи на экране телефона — `OWNER_TODO` №17 |
| 7.2 После подписания акт отправляется обеим сторонам: e-mail + «Поделиться в WhatsApp» | **код:** `documents/email.ts` (задача `documents.emailSignedAct`), `notifications/email.ts`; `documents/links.ts` (`whatsappShareUrl`, подписанная ссылка без ПДн); `_components/signing/DealDocuments.tsx`<br>**тест:** `documents.int.test.ts` (письмо, повтор без дубля, ссылка «Поделиться»), `documents/links.test.ts`, `notifications/email.test.ts`, `app/d/[token]/pdf/route.int.test.ts`<br>**экран:** `/deals/[id]`, `/d/[token]`, `/profile/contacts` (e-mail) | сделано на моках: почтовый сервис — mock (`OWNER_TODO` №20); письмо уходит стороне, указавшей e-mail в профиле, без e-mail — только «Поделиться» и «Скачать» |
| 7.3 Фотофиксация сдачи — обязательна | **код:** `deal-core/schemas.ts` (минимум 1 фото), `deal-core/service.ts` (`submitReady`), `modules/files`<br>**тест:** `deal-core/deal.int.test.ts` («без фото … — отказ»), `e2e/20-full-deal.spec.ts`<br>**экран:** `/deals/[id]` (сдача работы) | сделано |
| 7.4 GPS-отметка сдачи: радиус 500 м, несовпадение — предупреждение, не блокировка | **код:** `platform/geo.ts`, `READY_GPS_RADIUS_M` = 500 (`platform/env.ts`), `deal-core/service.ts`<br>**тест:** `platform/geo.test.ts`, `deal.int.test.ts` («далеко от адреса — предупреждение, но сдано»), `deal-view.test.ts`, `e2e/23-ready-gps-far.spec.ts`<br>**экран:** `/deals/[id]` | сделано. Координаты адреса: «Указать моё местоположение» в заявке; геокодер — mock (`OWNER_TODO` №21) |
| 7.5 Таймлайн операций с деньгами — печатаемая выписка | **код:** `documents/templates/money-statement.ts` (`MONEY_STATEMENT`, новая версия при изменении журнала)<br>**тест:** `templates.test.ts` («выписка по деньгам»), `documents.int.test.ts`, `e2e/20-full-deal.spec.ts` (суммы и остаток 0 в PDF)<br>**экран:** `/deals/[id]/money` («Выписка по сделке (PDF)») | сделано |
| 7.6 Документы открываются с телефона, скачиваются и пересылаются | **код:** `app/api/documents/[id]/pdf`, `app/d/[token]` (+`pdf`), `DealDocuments.tsx`; оферта с полными ИИН/БИН по ссылке не выдаётся<br>**тест:** `app/api/documents/[id]/pdf/route.int.test.ts`, `app/d/[token]/pdf/route.int.test.ts`, `documents/links.test.ts`, `e2e/09-access.spec.ts` | сделано |

## 8. Публичная витрина сделки
| Пункт ТЗ | Где | Статус |
|---|---|---|
| 8.1 Публичный read-only доступ заложен в архитектуру: публичный id, согласия сторон, обезличенная проекция | **код:** `Deal.publicId`, `DealPublicConsent`, `deal-core/public-view.ts`, `app/api/public/deals/[publicId]/route.ts` (404 без флага, без согласия обеих сторон или до завершения)<br>**тест:** `deal-core/public-view.int.test.ts`, `e2e/13-flags-off.spec.ts` | сделано (фундамент) |
| 8.2 Страница витрины с CTA «Начать свою сделку» | флаг `publicShowcase` (`FEATURE_PUBLIC_SHOWCASE`, по умолчанию выключен)<br>**тест:** `platform/features.test.ts`, `e2e/13-flags-off.spec.ts` | Фаза 2. Доступ без пароля демо-стенда — OQ №51 |

## 9. Статусная машина и логика сделки
| Пункт ТЗ | Где | Статус |
|---|---|---|
| 9.1 CREATED → PAID_HOLD → IN_PROGRESS → READY → ACCEPTED → SPLIT_PAYOUT; конечные CANCELLED, REFUNDED; перескоки запрещены кодом | **код:** `deal-core/transitions.ts` (таблица из 12 пар: from, to, кто, условие), переход — `updateMany` по ожидаемому статусу (`deal-core/state.ts`)<br>**тест:** `deal-core/transitions.test.ts`, `deal-core/transitions.int.test.ts` (каждый разрешённый и каждый запрещённый переход, гонка) | сделано |
| 9.2 Торг: встречные цены до оферты; акцепт фиксирует X и порождает оферту | **код:** `requests/negotiation.ts`, `PriceProposal`, `_components/negotiation/Negotiation.tsx` (блок «Цена» рядом с чатом отклика)<br>**тест:** `requests/negotiation.int.test.ts`, `requests/negotiation-state.test.ts`, `e2e/20-full-deal.spec.ts` (встречный раунд, двойной клик «Принять»)<br>**экран:** `/requests/[id]/offers/[offerId]`, `/executor/requests/[id]` | сделано |
| 9.3 READY: фото обязательно, GPS — мягкая проверка | см. 7.3 и 7.4 | сделано |
| 9.4 Спор открывает любая сторона с PAID_HOLD по READY; открытый спор блокирует выплату; решает админ (ИИ только подсказывает) | **код:** `deal-core/dispute.ts` (FREEZE/UNFREEZE, исходы CONTINUE / FULL_REFUND / PARTIAL_SPLIT), один открытый спор — частичный уникальный индекс; подсказка ИИ — под флагом `ai`<br>**тест:** `deal-core/dispute.int.test.ts`, `transitions.test.ts` («при открытом споре — запрещён»), `operator/disputes.int.test.ts`, `e2e/22-disputes.spec.ts` (каждый исход на PAID_HOLD и READY)<br>**экран:** `/deals/[id]` (спор), `/operator/disputes/[id]` | сделано. Возврат защиты 2% при полном возврате, формула раздела — OQ №38 |
| 9.5 Отмена покупателем до IN_PROGRESS — полный возврат («Деньги вернутся на вашу карту»); после — только через спор | **код:** `deal-core/service.ts` (отмена), `transitions.ts`; в CREATED может отменить и мастер (ADR-009)<br>**тест:** `deal-core/cancel.int.test.ts`, `deal-core/retry.int.test.ts` (отказ банка в возврате → повтор), `e2e/21-cancel-refund.spec.ts`<br>**экран:** `/deals/[id]` | сделано |
| 9.6 User: роль, KYC-статус, payout-реквизиты | **код:** `identity` (KYC, счёт выплаты; IBAN зашифрован, на экране — последние 4), `payments/payout-lock.ts` (счёт не меняется при ждущей выплате)<br>**тест:** `identity/kyc.int.test.ts`, `identity/kyc-policy.test.ts`, `identity/payout.int.test.ts`, `identity/iban.test.ts`, `payments/payout-lock.int.test.ts`<br>**экран:** `/executor/profile/kyc`, `/executor/profile/payout`, `/operator/kyc` | сделано. KYC пока ничего не блокирует — OQ №58 |
| 9.7 Grade: уровень мастера, % аванса — на будущее | **код:** `Grade` (`advancePercent` = 0), рост после выплаты — `deal-core/money.ts`; раздел по спору заказ не засчитывает (OQ №46)<br>**тест:** `deal-core/deal.int.test.ts` («грейд растёт», «двойная выплата — грейд +1») | сделано. Авансы — Фаза 3 |
| 9.8 Order: GPS-поля, фото сдачи | **код:** `Deal.ready*` (координаты, точность, расстояние, в радиусе), `Deal.deliveryPhotos`<br>**тест:** `deal.int.test.ts` | сделано |
| 9.9 Transaction: HOLD / RELEASE / SPLIT_MASTER / SPLIT_PLATFORM | **код:** `MoneyTransaction` (+ REFUND, FREEZE, UNFREEZE; `parentId` у частей выплаты)<br>**тест:** `payments/ledger.int.test.ts`, `payments/projection.test.ts` | сделано |
| 9.10 Dispute + DisputeMessage, уровни AI_CHAT / EXPERT | **код:** `Dispute` (`openedInStatus`, `DisputeOutcome`, позиции сторон) | частично: отдельной ленты `DisputeMessage` и уровней AI_CHAT/EXPERT нет — позиции сторон и чат сделки; решает оператор (OQ №43, ждёт решения) |

## 10. Платёжный контур
| Пункт ТЗ | Где | Статус |
|---|---|---|
| 10.1 Абстракция провайдера: hold / release / split, провайдер меняется конфигом, банк не вшит в бизнес-логику | **код:** `payments/provider.ts` (`PaymentProvider`: hold, release, split, refund, getStatus, handleWebhook), `payments/providers/index.ts`; выбор — `PAYMENT_PROVIDER` или по `APP_ENV` (`platform/env.ts`), фиксируется в `Deal.paymentProvider`<br>**тест:** `platform/env.test.ts` («контуры APP_ENV»), `operator/settings.int.test.ts` | сделано |
| 10.2 Провайдер mock — для разработки и демо | **код:** `payments/providers/mock.ts` (подписанный вебхук), пометка «Тестовый платёж»<br>**тест:** `deal-core/deal.int.test.ts`, `payments/webhook.int.test.ts`, `e2e/21-cancel-refund.spec.ts`, `e2e/22-disputes.spec.ts` | сделано |
| 10.3 Провайдер freedompay (песочница): `/init_payment`, выплата `/api/reg2nonreg`; карточные данные — на страницах провайдера | **код:** `payments/providers/freedompay/` (клиент, подпись `pg_sig`, XML, статусы, вебхук) — по публичной документации; разрешён только при `APP_ENV=staging` (`env.ts`)<br>**тест:** `freedompay/client.test.ts`, `index.test.ts`, `signature.test.ts`, `xml.test.ts` (на фикстурах), `env.test.ts` («freedompay запрещён вне staging») | сделано на моках: с настоящей песочницей не прогонялся — ключи и письменное подтверждение схемы без зачисления на баланс ТОО — `OWNER_TODO` №18, OQ №41, №52. Подключение песочницы по ТЗ п. 12 — Фаза 2 |
| 10.4 Провайдер manual: статусы денег проставляет админ кнопками | **код:** `payments/providers/manual.ts`, `payments/retry.ts` (повтор отклонённой операции); подтверждение — номер, дата и скан банковского документа<br>**тест:** `operator/money.int.test.ts`, `deal-core/manual.int.test.ts`, `deal-core/retry.int.test.ts`, `e2e/20-full-deal.spec.ts`, `e2e/11-bank-demo.spec.ts`<br>**экран:** `/operator/money` (очередь, «Отклонены банком», «Повторить операцию») | сделано. Для пилота: реквизиты счёта для оплаты покупателем — пока «по реквизитам из оферты», а в оферте их нет (OQ №47); договор с банком — `OWNER_TODO` №16 |
| 10.4 Раскрытие по расписке (Freedom Bank) | **код:** `documents/templates/release-receipt.ts` (`RELEASE_RECEIPT`, только оператору, после запроса раскрытия)<br>**тест:** `templates.test.ts` («расписка на раскрытие»), `documents.int.test.ts` | сделано на моках: шаблон «требует юридической проверки»; образец банка — `OWNER_TODO` №16, юрист — №17 |
| 10.5 Деньги клиентов никогда не проходят через счета ТОО | Деньги на эскроу-счёте банка, журнал только фиксирует операции (ADR-009); `freedompay` запрещён вне `staging` (`env.ts`); оферта п. 3.2: платформа не принимает и не хранит деньги<br>**тест:** `env.test.ts`, `templates.test.ts` («платформа деньги не принимает») | сделано |

## 11. Технические требования
| Пункт ТЗ | Где | Статус |
|---|---|---|
| 11.1 Идемпотентность всех платёжных операций: ключ на операцию, повтор не создаёт дубль | **код:** `payments/keys.ts` (`hold:<dealId>`, попытки `:<N>`), уникальный `MoneyTransaction.idempotencyKey`, итог записывается один раз (`trySettle`)<br>**тест:** `payments/ledger.int.test.ts` («ключ идемпотентности», параллельно), `deal-core/deal.int.test.ts` («гонки»), `operator/money.int.test.ts` (двойное подтверждение), `e2e/20-full-deal.spec.ts` (двойные клики и повтор запроса) | сделано |
| 11.2 Аудит-лог: каждое действие с деньгами и каждый переход статуса — кто, что, когда, откуда | **код:** `modules/audit` (`origin.ts` — IP и устройство), `recordAudit` в переходе (`deal-core/state.ts`) и в денежных операциях (`payments/execute.ts`, `providers/manual.ts`, `retry.ts`)<br>**тест:** `audit/audit.int.test.ts`, `audit/origin.test.ts`, `transitions.int.test.ts` (запись перехода), `manual.int.test.ts` (реквизиты документа в аудите), `operator/report.int.test.ts` («запись показывает IP и устройство»)<br>**экран:** `/operator/audit` | сделано. IP пишется при `TRUST_PROXY=true` (`OWNER_TODO` №4) |
| 11.3 Вебхуки провайдера: проверка подписи, ретраи, защита от повторов | **код:** `payments/webhook.ts`, `app/api/webhooks/payments/[provider]/route.ts`, уникальный `PaymentWebhookEvent.externalEventId`; ждущие операции дорабатывает опрос (`payments/poll.ts`); противоречие журналу — событие с ошибкой и уведомление операторам (OQ №61)<br>**тест:** `payments/webhook.int.test.ts` (неверная или старая подпись, повторная и параллельная доставка), `freedompay/signature.test.ts`, `freedompay/index.test.ts` (`handleWebhook`), `ledger.int.test.ts` («опрос ждущих операций») | сделано |
| 11.4 PWA mobile-first, установка иконкой | **код:** `app/manifest.ts`, `public/sw.js`, `app/_components/install/`<br>**тест:** `_components/install/sw.test.ts`, `install-offer.test.ts`; e2e — проект `mobile` (Pixel 7) | сделано. Проверка с настоящего iPhone — `OWNER_TODO` №15 |
| 11.5 Русский язык | **код:** все тексты — `i18n/ru/*`<br>**тест:** `i18n/inline-texts.test.ts` | сделано. Казахский — Фаза 2 (кода нет, флаг не нужен) |
| 11.6 Окружения dev (mock) / staging (песочница) / prod; секреты — в переменных окружения | **код:** `APP_ENV` в `platform/env.ts` (zod): в prod запрещены `DEMO_MODE`, моки SMS, подписи и платежей, `freedompay`; секреты обязательны<br>**тест:** `platform/env.test.ts` | сделано. Рабочий контур prod (хостинг, реальные SMS и ЭЦП) — `OWNER_TODO` №23 |
| 11.7 Демо-данные всегда помечены как тестовые | **код:** `Deal.isDemo`, `MoneyTransaction.isTest`, «Тестовый платёж», баннер «Демо-режим: тестовые данные», сид `demo/`, показ банку `/bank-demo` — только при `DEMO_MODE`<br>**тест:** `demo/seed.int.test.ts`, `money-panel.test.ts` («тестовые деньги честно помечены»), `manual.int.test.ts` (демо-сделка на manual), `templates.test.ts` (тестовая сделка в оферте), `platform/demo-gate.test.ts`, `e2e/11-bank-demo.spec.ts`<br>**экран:** `/bank-demo`, `/operator/demo` | сделано |
| 11.8 Код — в общем репозитории GitHub, работа через ветки и PR | Работа в ветке `feat/tz-v1` | частично: пуш в общий репозиторий и PR не выполнялись — агенту `git push` запрещён (`CLAUDE.md`), это шаг владельца |

## 12. Фазы и критерии готовности
### Фаза 1
| Пункт ТЗ | Где | Статус |
|---|---|---|
| 12.1 Сделка end-to-end на mock + экран денег + терминология + акт PDF + ручной спор + админка со сменой статусов (manual) | **тест:** `deal-core/deal.int.test.ts` (полный путь на mock), `e2e/20-full-deal.spec.ts` (manual, оператор подтверждает операции), `e2e/21-cancel-refund.spec.ts`, `e2e/22-disputes.spec.ts`, `e2e/23-ready-gps-far.spec.ts` | сделано |
| 12.2 Готово = прогон полной сделки тремя людьми (покупатель, мастер, админ) с трёх телефонов без консоли разработчика; незнакомый человек проходит без подсказок | `e2e/20-full-deal.spec.ts`: три отдельных мобильных браузера (Pixel 7), только интерфейс, без консоли и запросов в базу; сценарий показа — `docs/bank/05-demo-script.md` | частично: автотест проходит путь за трёх участников, но живой прогон тремя людьми с телефонов и проверка «без подсказок» не проводились и не зафиксированы — это ручная приёмка владельца |

### Вне Фазы 1 (Фаза 2 и 3) — проверено, что выключено
| Пункт ТЗ | Где | Статус |
|---|---|---|
| Подключение песочницы и боевого Freedom Pay | код адаптера есть (10.3), только `APP_ENV=staging`; ключи — `OWNER_TODO` №18 | Фаза 2 |
| Отзывы с модерацией | флаг `reviews` (`FEATURE_REVIEWS`, выключен; `deal-core/service.ts` отказывает) | Фаза 2 |
| Портфолио мастера | портфолио из сделки — флаг `dealPortfolio` (выключен, `e2e/13-flags-off.spec.ts`); раздел портфолио в профиле мастера (`/executor/portfolio`) работает без флага — сделан до ТЗ | Фаза 2 (портфолио из сделки); раздел профиля включён |
| Контрольный замер (стр. 15) и сценарии до договора | флаг `preContractFlows` (выключен; `requests/negotiation.int.test.ts` — оба положения) | Фаза 2 |
| Публичная витрина сделки | флаг `publicShowcase` (выключен), см. 8.2 | Фаза 2 |
| «Вдохновение», калькулятор материалов | флаги `inspiration`, `materialsCalculator` (выключены; `e2e/13-flags-off.spec.ts`, `app/_shell/nav.test.ts`) | Фаза 2 |
| Казахский язык | кода нет | Фаза 2 |
| AR-рулетка, SEO, B2B-тендеры, ретро-бонусы, авансы 30–40% грейду 2, анти-обход, сторы | кода нет; `Grade.advancePercent` = 0 | Фаза 3 |
| ИИ-визуализатор интерьера | `modules/ai` под `AI_ENABLED` (выключен; `features.test.ts`, `operator/settings.int.test.ts`) | Фаза 3 |

Все флаги `src/platform/features.ts` выключены по умолчанию: `platform/env.ts` (`bool` с `default("false")`), тест `platform/features.test.ts` («по умолчанию всё вне Фазы 1 выключено»); оператор видит их только для чтения — `/operator/settings`.

## Итог
Пунктов Фазы 1 в матрице — 61 (разделы 1–12, без таблицы «Вне Фазы 1»):
- **сделано** — 49;
- **сделано на моках** — 6: уведомления web push (VAPID, №19), оферта (юрпроверка №17, SIGEX №8), акт и подпись (№8, №17), отправка акта e-mail (№20), freedompay (№18), расписка на раскрытие (№16, №17);
- **частично** — 6;
- **не сделано** — 0;
- **Фаза 2** — 1 пункт матрицы (8.2) и 9 строк таблицы «Вне Фазы 1».

Частично:
1. **3.1 Вёрстка по 18-страничному концепту** — концепта целиком в репозитории нет (21 макет в `docs/design/mockups/`), соответствие проверяется глазами владельца.
2. **3.3 «До любой цели 2–3 нажатия»** — автотестом не измеряется; до действия по сделке у покупателя 3 нажатия.
3. **4.2 Зеркальный блок мастера в карточке заявки** — строка на `/executor/requests/[id]` есть, автотеста на неё нет.
4. **9.10 DisputeMessage и уровни AI_CHAT/EXPERT** — не сделаны, вместо них позиции сторон и чат сделки (OQ №43).
5. **11.8 GitHub, ветки и PR** — работа в ветке `feat/tz-v1`; пуш и PR — шаг владельца.
6. **12.2 Прогон тремя людьми с трёх телефонов** — есть e2e на трёх мобильных контекстах, живого прогона нет.

Для пилота (не входит в критерии Фазы 1, но блокирует реальные деньги): реквизиты счёта для оплаты покупателем на manual (OQ №47, `OWNER_TODO` №16), решения по OQ №58–61 (`OWNER_TODO` №25).
