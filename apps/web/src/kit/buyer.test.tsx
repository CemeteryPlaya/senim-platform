import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { Badge, Chat, ChatComposer, Menu, MoneyPanel, SignaturePad, Steps, Timeline, Uploader } from "./index";
import { badgeText } from "./Badge";
import { canSend, composerKeyAction, counterVisible, shouldFollow } from "./chat-logic";
import { drawStrokes, hasInk, toPoint, type Pen, type Stroke } from "./signature-logic";
import { count, hasClass, html, text } from "./test-utils";
import { matchesAccept, progressPercent, takeFiles } from "./uploader-logic";

const NB = " ";

describe("Steps", () => {
  const items = [
    { label: "Оферта", state: "done" },
    { label: "Оплата", state: "done" },
    { label: "Изготовление", state: "current" },
    { label: "Приёмка", state: "todo" },
    { label: "Выплата", state: "todo" },
  ] as const;

  it("<ol> с пятью шагами, текущий — aria-current=step, один", () => {
    const out = html(<Steps items={items} label="Ход сделки" />);
    expect(out).toMatch(/^<div[^>]*><ol aria-label="Ход сделки"/);
    expect(count(out, "<li")).toBe(5);
    expect(count(out, 'aria-current="step"')).toBe(1);
    expect(out.indexOf('aria-current="step"')).toBeGreaterThan(out.indexOf("Оплата"));
    expect(out.indexOf('aria-current="step"')).toBeLessThan(out.indexOf("Приёмка"));
  });

  it("текущий шаг — вес и ink, пройденные и будущие — muted, галочка accent у пройденных", () => {
    const out = html(<Steps items={items} />);
    const current = out.slice(out.indexOf("Изготовление") - 120, out.indexOf("Изготовление"));
    expect(current).toContain("font-semibold");
    expect(current).toContain("text-ink");
    expect(count(out, "text-accent")).toBe(2); // две галочки
    expect(hasClass(out, "text-muted")).toBe(true);
  });

  it("пройденный шаг объявляется диктору, у будущего пометки нет", () => {
    const out = html(<Steps items={items} />);
    expect(count(out, ru.app.kit.steps.done.toLowerCase())).toBe(2);
  });

  it("телефон — колонка, компьютер — ряд: варианты mobile:/desktop:, брейкпоинтов нет", () => {
    const out = html(<Steps items={items} />);
    expect(hasClass(out, "mobile:flex-col")).toBe(true);
    expect(hasClass(out, "desktop:flex-row")).toBe(true);
    expect(out).not.toMatch(/(?:^|[\s"])(?:sm|md|lg):/);
  });

  it("пояснение: под текущим шагом на телефоне и под шкалой на компьютере (каждое скрыто в другой версии)", () => {
    const out = html(<Steps items={items} note="Мастер собирает мебель" />);
    expect(count(out, "Мастер собирает мебель")).toBe(2);
    expect(hasClass(out, "desktop:hidden")).toBe(true);
    expect(hasClass(out, "mobile:hidden")).toBe(true);
    expect(hasClass(html(<Steps items={items} />), "desktop:hidden")).toBe(false);
  });

  it("остановлено: нейтральная плашка вместо шкалы, без списка", () => {
    const out = html(<Steps items={items} stopped={{ label: "Спор открыт" }} />);
    expect(out).not.toContain("<ol");
    expect(out).toContain("Спор открыт");
    expect(hasClass(out, "bg-canvas")).toBe(true);
    expect(out).not.toContain("data-primary-action");
  });
});

describe("Timeline", () => {
  it("<ol>: заголовок, время вторичным, текст и сумма справа через Money", () => {
    const out = html(
      <Timeline
        label="События"
        items={[
          { title: "Оплата принята", time: "10 ноября, 12:20", amount: 20_400_000n, text: "Деньги под защитой" },
          { title: "Оферта заключена", time: "10 ноября, 12:05" },
        ]}
      />,
    );
    expect(out).toMatch(/^<ol aria-label="События"/);
    expect(count(out, "<li")).toBe(2);
    expect(count(out, "tabular-nums")).toBe(1);
    expect(text(<Timeline items={[{ title: "A", time: "t", amount: 20_400_000n }]} />)).toContain(`204${NB}000${NB}₸`);
    expect(out).toContain("Деньги под защитой");
    expect(out).toContain("text-muted");
  });

  it("без суммы и текста — только заголовок и время", () => {
    const out = html(<Timeline items={[{ title: "Мастер начал работу", time: "11 ноября" }]} />);
    expect(count(out, "<p")).toBe(2);
    expect(out).not.toContain("tabular-nums");
  });
});

describe("Badge", () => {
  it("0, отрицательное и не число — не рисуется; обычное число — как есть; выше 99 — «99+»", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-3)).toBeNull();
    expect(badgeText(Number.NaN)).toBeNull();
    expect(badgeText(5)).toBe("5");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
    expect(badgeText(7.9)).toBe("7");
    expect(badgeText(12, 9)).toBe("9+");
    expect(html(<Badge count={0} />)).toBe("");
  });

  it("скрыт от диктора, цифры табличные, положение задаёт родитель", () => {
    const out = html(<Badge count={120} className="absolute top-0" />);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("99+");
    expect(hasClass(out, "tabular-nums")).toBe(true);
    expect(hasClass(out, "absolute")).toBe(true);
    expect(hasClass(out, "bg-danger-soft")).toBe(true);
  });

  it("подпись для диктора у родителя склоняется", () => {
    expect(ru.app.kit.badge.unread(1)).toBe("1 непрочитанное");
    expect(ru.app.kit.badge.unread(5)).toBe("5 непрочитанных");
  });
});

describe("Menu", () => {
  const items = [
    { label: "История денег", href: "/v2/money" },
    { label: "Открыть спор", tone: "danger", onSelect: () => {} },
  ] as const;

  it("закрытое меню на телефоне и компьютере — кнопка-триггер с доступным именем, пунктов в разметке нет", () => {
    for (const device of ["mobile", "desktop"] as const) {
      const out = html(<Menu label="Действия со сделкой" items={items} device={device} />);
      expect(out).toContain('aria-label="Действия со сделкой"');
      expect(out).toContain('aria-expanded="false"');
      expect(out).not.toContain("История денег");
      expect(out).not.toContain("data-primary-action");
      expect(hasClass(out, "min-h-control")).toBe(true);
    }
    expect(html(<Menu label="Действия" items={items} device="mobile" />)).toContain('aria-haspopup="dialog"');
    expect(html(<Menu label="Действия" items={items} device="desktop" />)).toContain('aria-haspopup="menu"');
  });
});

describe("MoneyPanel", () => {
  const rows = [
    { label: "Цена по оферте", amount: 20_000_000n },
    {
      label: "Защита сделки (2%)",
      amount: 400_000n,
      explain: { label: "Что это?", title: "Защита сделки", body: "Деньги в банке" },
    },
    { label: "К оплате", amount: 20_400_000n },
  ];

  it("защищено: зелёный мягкий фон, значок щита, главная сумма и строки через Money", () => {
    const out = html(<MoneyPanel tone="protected" title="Деньги в банке под защитой" amount={20_400_000n} rows={rows} device="mobile" />);
    expect(hasClass(out, "bg-accent-soft")).toBe(true);
    expect(out).toContain("lucide-shield-check");
    expect(hasClass(out, "text-title")).toBe(true);
    expect(count(out, "tabular-nums")).toBe(5); // абзац главной суммы, она сама и три строки (Money)
    expect(text(<MoneyPanel tone="protected" title="t" amount={20_400_000n} device="mobile" />)).toContain(`204${NB}000${NB}₸`);
    expect(count(out, "<dt")).toBe(3);
    expect(count(out, "<dd")).toBe(3);
  });

  it("зелёный только у protected; остальные тона нейтральные", () => {
    for (const tone of ["awaiting", "frozen", "completed", "refunded"] as const) {
      const out = html(<MoneyPanel tone={tone} title="t" amount={100n} device="mobile" />);
      expect(hasClass(out, "bg-surface")).toBe(true);
      expect(out).not.toContain("accent");
      expect(out).not.toContain("lucide-shield-check");
    }
  });

  it("frozen — предупреждение warn со значком, без зелёного", () => {
    const out = html(<MoneyPanel tone="frozen" title="Выплата приостановлена" amount={100n} device="desktop" />);
    expect(out).toContain("lucide-triangle-alert");
    expect(hasClass(out, "text-warn")).toBe(true);
  });

  it("пояснение строки — кнопка Explain рядом с подписью; у строки без него её нет", () => {
    const out = html(<MoneyPanel tone="protected" title="t" amount={1n} rows={rows} device="mobile" />);
    expect(count(out, "<button")).toBe(1);
    expect(out).toContain("Что это?");
  });

  it("примечание и ссылка внизу — необязательны", () => {
    const bare = html(<MoneyPanel tone="awaiting" title="t" amount={1n} device="mobile" />);
    expect(bare).not.toContain("<a");
    expect(bare).not.toContain("<dl");
    const full = html(
      <MoneyPanel tone="awaiting" title="t" amount={1n} note="Выплата после приёмки" action={{ label: "История денег", href: "/v2/money" }} device="mobile" />,
    );
    expect(full).toContain("Выплата после приёмки");
    expect(full).toContain('href="/v2/money"');
  });

  it("панель названа своим заголовком", () => {
    const out = html(<MoneyPanel tone="awaiting" title="Ожидает оплаты" amount={1n} device="mobile" />);
    expect(out).toMatch(/<section aria-labelledby="([^"]+)"[\s\S]*id="\1"/);
  });
});

describe("Uploader: логика", () => {
  const file = (name: string, type: string) => ({ name, type });

  it("accept: шаблон типа, точный тип, расширение, пусто — любой", () => {
    expect(matchesAccept(file("a.jpg", "image/jpeg"), "image/*")).toBe(true);
    expect(matchesAccept(file("a.pdf", "application/pdf"), "image/*")).toBe(false);
    expect(matchesAccept(file("a.png", "image/png"), "image/jpeg, image/png")).toBe(true);
    expect(matchesAccept(file("A.HEIC", ""), ".heic")).toBe(true);
    expect(matchesAccept(file("a.txt", "text/plain"), undefined)).toBe(true);
  });

  it("не больше свободных мест и только подходящие", () => {
    const files = [file("1.jpg", "image/jpeg"), file("2.pdf", "application/pdf"), file("3.jpg", "image/jpeg"), file("4.jpg", "image/jpeg")];
    expect(takeFiles(files, 3, 5, "image/*").map((f) => f.name)).toEqual(["1.jpg", "3.jpg"]);
    expect(takeFiles(files, 5, 5, "image/*")).toEqual([]);
    expect(takeFiles(files, 9, 5)).toEqual([]);
  });

  it("ход загрузки: целые проценты в пределах 0–100, неизвестный — null", () => {
    expect(progressPercent(40.4)).toBe(40);
    expect(progressPercent(-5)).toBe(0);
    expect(progressPercent(250)).toBe(100);
    expect(progressPercent(undefined)).toBeNull();
    expect(progressPercent(Number.NaN)).toBeNull();
  });
});

describe("Uploader: разметка", () => {
  const noop = () => {};
  const items = [
    { id: "1", name: "Кухня.jpg", state: "done" },
    { id: "2", name: "Стена.jpg", state: "uploading", progress: 40 },
    { id: "3", name: "Окно.jpg", state: "error", error: "Файл больше 10 МБ" },
  ] as const;

  it("кнопка добавления, скрытый input file, счётчик «N из max»", () => {
    const out = html(<Uploader items={items} onAdd={noop} onRemove={noop} max={5} accept="image/*" />);
    expect(out).toContain(ru.app.kit.uploader.add);
    expect(out).toMatch(/<input[^>]*type="file"[^>]*hidden=""/);
    expect(out).toContain('accept="image/*"');
    expect(out).toContain("3 из 5");
    expect(out).not.toContain("data-primary-action");
  });

  it("свой label кнопки; при заполнении кнопка отключена", () => {
    const out = html(<Uploader items={items} onAdd={noop} onRemove={noop} max={3} label="Добавить фото места" />);
    expect(out).toContain("Добавить фото места");
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Добавить фото места/);
    expect(html(<Uploader items={items} onAdd={noop} onRemove={noop} max={5} />)).not.toMatch(/disabled=""[^>]*>[\s\S]{0,200}Добавить фото<\/span>/);
  });

  it("загрузка: полоса с ходом в процентах для диктора; готово — пометка; у каждого фото кнопка «Убрать»", () => {
    const out = html(<Uploader items={items} onAdd={noop} onRemove={noop} max={5} />);
    expect(out).toContain('aria-valuenow="40"');
    expect(out).toContain(ru.app.kit.uploader.uploadingPercent(40));
    expect(out).toContain(ru.app.kit.uploader.done);
    expect(count(out, 'aria-label="Убрать: ')).toBe(3);
  });

  it("загрузка без хода — пульсация, без aria-valuenow", () => {
    const out = html(<Uploader items={[{ id: "1", name: "a.jpg", state: "uploading" }]} onAdd={noop} onRemove={noop} max={5} />);
    expect(out).not.toContain("aria-valuenow");
    expect(hasClass(out, "animate-pulse")).toBe(true);
    expect(out).toContain(ru.app.kit.uploader.uploading);
  });

  it("ошибка: текст у файла и «Убрать»; «Повторить» только с onRetry", () => {
    const without = html(<Uploader items={items} onAdd={noop} onRemove={noop} max={5} />);
    expect(without).toContain("Файл больше 10 МБ");
    expect(without).toContain('role="alert"');
    expect(without).not.toContain(ru.app.kit.uploader.retry);
    const withRetry = html(<Uploader items={items} onAdd={noop} onRemove={noop} onRetry={noop} max={5} />);
    expect(withRetry).toContain(ru.app.kit.uploader.retry);
    expect(hasClass(withRetry, "col-span-full")).toBe(true);
  });

  it("превью: фото с alt по имени; без адреса — заглушка line", () => {
    const out = html(<Uploader items={[{ id: "1", name: "Кухня.jpg", state: "done", previewUrl: "/landing/kitchen.jpg" }]} onAdd={noop} onRemove={noop} max={5} />);
    expect(out).toContain('alt="Кухня.jpg"');
    expect(hasClass(out, "bg-line")).toBe(true);
    expect(html(<Uploader items={[{ id: "1", name: "a.jpg", state: "done" }]} onAdd={noop} onRemove={noop} max={5} />)).not.toContain("<img");
  });

  it("подсказка о перетаскивании — только на компьютере", () => {
    const out = html(<Uploader items={[]} onAdd={noop} onRemove={noop} max={5} />);
    expect(out).toContain(ru.app.kit.uploader.drop);
    expect(hasClass(out, "mobile:hidden")).toBe(true);
  });
});

describe("Chat: логика", () => {
  it("Enter на компьютере отправляет, Shift+Enter — перенос; на телефоне Enter — перенос", () => {
    const enter = { key: "Enter", shiftKey: false, isComposing: false };
    expect(composerKeyAction(enter, "desktop")).toBe("send");
    expect(composerKeyAction({ ...enter, shiftKey: true }, "desktop")).toBe("default");
    expect(composerKeyAction(enter, "mobile")).toBe("default");
    expect(composerKeyAction({ ...enter, isComposing: true }, "desktop")).toBe("default");
    expect(composerKeyAction({ ...enter, key: "a" }, "desktop")).toBe("default");
  });

  it("счётчик показывается с 80% предела; без предела — нет", () => {
    expect(counterVisible(159, 200)).toBe(false);
    expect(counterVisible(160, 200)).toBe(true);
    expect(counterVisible(500, undefined)).toBe(false);
  });

  it("отправка: нужен текст кроме пробелов, не сверх предела, не во время отправки", () => {
    expect(canSend("   ", 200, false)).toBe(false);
    expect(canSend("Привет", 200, false)).toBe(true);
    expect(canSend("Привет", 3, false)).toBe(false);
    expect(canSend("Привет", 200, true)).toBe(false);
    expect(canSend("Привет", undefined, false)).toBe(true);
  });

  it("прокрутка: при показе всегда; при новом — если был внизу или написал сам; без нового — нет", () => {
    const base = { previousLastId: "a", lastId: "b", lastIsMine: false, wasAtBottom: true, firstRender: false };
    expect(shouldFollow({ ...base, firstRender: true, wasAtBottom: false })).toBe(true);
    expect(shouldFollow(base)).toBe(true);
    expect(shouldFollow({ ...base, wasAtBottom: false })).toBe(false);
    expect(shouldFollow({ ...base, wasAtBottom: false, lastIsMine: true })).toBe(true);
    expect(shouldFollow({ ...base, lastId: "a" })).toBe(false);
    expect(shouldFollow({ ...base, lastId: undefined, firstRender: true })).toBe(false);
  });
});

describe("Chat: разметка", () => {
  const messages = [
    { id: "s", kind: "system", text: "Контакты скрыты до заключения оферты", time: "10:02" },
    { id: "1", mine: true, text: "Здравствуйте", time: "10:05" },
    { id: "2", mine: false, text: "Добрый день", time: "10:12", attachments: [{ id: "f", url: "/landing/kitchen.jpg", name: "Стена.jpg" }] },
  ] as const;

  it("лента — role=log, aria-live=polite, с именем", () => {
    const out = html(<Chat messages={messages} label="Переписка с мастером" />);
    expect(out).toContain('role="log"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('aria-label="Переписка с мастером"');
    expect(html(<Chat messages={[]} />)).toContain(`aria-label="${ru.app.kit.chat.log}"`);
  });

  it("свои сообщения справа на accent-soft, чужие слева на surface; тёмной подложки нет", () => {
    const out = html(<Chat messages={messages} />);
    const mine = out.slice(out.indexOf("Здравствуйте") - 400, out.indexOf("Здравствуйте"));
    const theirs = out.slice(out.indexOf("Добрый день") - 400, out.indexOf("Добрый день"));
    expect(mine).toContain("bg-accent-soft");
    expect(mine).toContain("ml-auto");
    expect(theirs).toContain("bg-surface");
    expect(theirs).toContain("mr-auto");
    expect(out).not.toContain("bg-action");
  });

  it("системная строка — по центру вторичным текстом, не сообщение", () => {
    const out = html(<Chat messages={messages} />);
    const system = out.slice(out.indexOf("Контакты") - 150, out.indexOf("Контакты"));
    expect(system).toContain("text-center");
    expect(system).toContain("text-muted");
    expect(count(out, "<article")).toBe(2);
  });

  it("время мелким вторичным, вложения-фото — превью-ссылки, автор для диктора", () => {
    const out = html(<Chat messages={messages} />);
    expect(out).toContain("10:12");
    expect(hasClass(out, "text-small")).toBe(true);
    expect(out).toContain('alt="Стена.jpg"');
    expect(out).toContain('href="/landing/kitchen.jpg"');
    expect(out).toContain(`${ru.app.kit.chat.mine}: `);
    expect(out).toContain(`${ru.app.kit.chat.theirs}: `);
  });

  it("поле ввода — отдельным узлом после ленты", () => {
    const out = html(<Chat messages={messages} composer={<ChatComposer device="mobile" onSend={() => {}} />} />);
    expect(out.indexOf("<form")).toBeGreaterThan(out.indexOf('role="log"'));
    expect(out.indexOf("<form")).toBeGreaterThan(out.indexOf("</div><div ")); // не внутри ленты
  });
});

describe("ChatComposer: разметка", () => {
  it("многострочное поле с именем, кнопка отправки со значком и именем из ru, не главное действие", () => {
    const out = html(<ChatComposer device="desktop" onSend={() => {}} maxLength={200} />);
    expect(out).toContain("<textarea");
    expect(out).toContain(`aria-label="${ru.app.kit.chat.message}"`);
    expect(out).toContain(`aria-label="${ru.app.kit.chat.send}"`);
    expect(out).toContain('type="submit"');
    expect(out).toContain("lucide-send-horizontal");
    expect(out).not.toContain("data-primary-action");
    expect(hasClass(out, "max-h-composer")).toBe(true);
    expect(hasClass(out, "min-h-control")).toBe(true);
  });

  it("на телефоне прилипает к низу над панелью вкладок; на компьютере — в потоке", () => {
    const out = html(<ChatComposer device="mobile" onSend={() => {}} />);
    expect(hasClass(out, "mobile:sticky")).toBe(true);
    expect(hasClass(out, "mobile:dock-above-bar")).toBe(true);
    expect(hasClass(out, "desktop:sticky")).toBe(false);
  });

  it("пустое поле — отправка отключена; кнопка вложения — только с onAttach", () => {
    const out = html(<ChatComposer device="mobile" onSend={() => {}} />);
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Отправить"|<button[^>]*aria-label="Отправить"[^>]*disabled=""/);
    expect(out).not.toContain(ru.app.kit.chat.attach);
    expect(html(<ChatComposer device="mobile" onSend={() => {}} onAttach={() => {}} />)).toContain(ru.app.kit.chat.attach);
  });

  it("пока счётчик не нужен — его нет", () => {
    expect(html(<ChatComposer device="mobile" onSend={() => {}} maxLength={200} />)).not.toContain("tabular-nums");
  });
});

describe("SignaturePad", () => {
  const box = { left: 10, top: 20, width: 200 };

  it("точка касания — доли ширины холста", () => {
    expect(toPoint(110, 70, box)).toEqual({ x: 0.5, y: 0.25 });
  });

  it("есть ли что-то нарисованное", () => {
    expect(hasInk([])).toBe(false);
    expect(hasInk([[]])).toBe(false);
    expect(hasInk([[{ x: 0, y: 0 }]])).toBe(true);
  });

  /** Подмена контекста: записывает вызовы. */
  function fakePen() {
    const calls: string[] = [];
    const pen = {
      clearRect: () => calls.push("clear"),
      beginPath: () => calls.push("begin"),
      moveTo: (x: number, y: number) => calls.push(`move ${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`line ${x},${y}`),
      arc: (x: number, y: number) => calls.push(`arc ${x},${y}`),
      fill: () => calls.push("fill"),
      stroke: () => calls.push("stroke"),
      lineWidth: 0,
      lineCap: "butt",
      lineJoin: "miter",
      strokeStyle: "",
      fillStyle: "",
    } satisfies Pen;
    return { pen, calls };
  }

  it("перерисовка: очистка, линии штриха цветом темы, точка у касания без движения", () => {
    const strokes: Stroke[] = [
      [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.25 },
      ],
      [{ x: 0.9, y: 0.4 }],
    ];
    const { pen, calls } = fakePen();
    drawStrokes(pen, strokes, 200, 160, "rgb-ink");
    expect(calls).toEqual(["clear", "begin", "move 20,20", "line 100,50", "stroke", "begin", "arc 180,80", "fill"]);
    expect(pen.strokeStyle).toBe("rgb-ink");
    expect(pen.fillStyle).toBe("rgb-ink");
    expect(pen.lineCap).toBe("round");
  });

  it("при смене ширины штрихи масштабируются вместе с холстом (подпись не пропадает и не сплющивается)", () => {
    const strokes: Stroke[] = [
      [
        { x: 0.2, y: 0.1 },
        { x: 0.4, y: 0.2 },
      ],
    ];
    const a = fakePen();
    drawStrokes(a.pen, strokes, 200, 160, "c");
    const b = fakePen();
    drawStrokes(b.pen, strokes, 400, 160, "c");
    expect(a.calls).toContain("move 40,20");
    expect(b.calls).toContain("move 80,40");
  });

  it("разметка: холст с touch-action: none, высотой не меньше 160 px, подсказкой внутри; «Очистить» отключена на пустом", () => {
    const out = html(<SignaturePad label="Подпись покупателя" onChange={() => {}} />);
    expect(out).toContain("<canvas");
    expect(hasClass(out, "touch-none")).toBe(true);
    expect(hasClass(out, "h-signature")).toBe(true);
    expect(hasClass(out, "text-ink")).toBe(true);
    expect(out).toContain(ru.app.kit.signature.hint);
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-label="Подпись покупателя"');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Очистить|disabled=""[\s\S]*Очистить/);
    expect(out).toContain(ru.app.kit.signature.typeName);
    expect(out).not.toContain("data-primary-action");
  });

  it("описание холста для диктора называет замену вводом ФИО", () => {
    const out = html(<SignaturePad label="Подпись" onChange={() => {}} />);
    expect(out).toMatch(/aria-describedby="([^"]+)"[\s\S]*id="\1"[^>]*class="sr-only"/);
    expect(out).toContain(ru.app.kit.signature.alternative);
  });
});
