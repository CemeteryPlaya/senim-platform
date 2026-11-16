// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionQueue, QueueCard, useQueueDecision } from "@/kit";
import { mount, type Mounted } from "@/kit/test-utils";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

/** Кнопка решения внутри карточки: как форма после успешного ответа — сообщает очереди итог и откуда он. */
function Decide({ id }: { id: string }) {
  const decided = useQueueDecision();
  return (
    <span data-decide={id} onClick={(event) => decided?.(`Решено: ${id}`, event.currentTarget)}>
      {id}
    </span>
  );
}

function Queue({ ids }: { ids: string[] }) {
  return (
    <DecisionQueue count={ids.length} label="Операции" empty={{ title: "Очередь пуста", body: "Новые операции появятся здесь." }}>
      {ids.map((id) => (
        <QueueCard key={id} title={`Операция ${id}`}>
          <Decide id={id} />
        </QueueCard>
      ))}
    </DecisionQueue>
  );
}

const click = (container: HTMLElement, id: string) =>
  act(() => {
    (container.querySelector(`[data-decide="${id}"]`) as HTMLElement).click();
  });

const rerender = (ids: string[]) => act(() => mounted?.root.render(<Queue ids={ids} />));

describe("DecisionQueue в браузере: фокус и объявление после решения", () => {
  it("решена средняя — итог в role=status, фокус на заголовок карточки, вставшей на её место", () => {
    mounted = mount(<Queue ids={["a", "b", "c"]} />);
    const { container } = mounted;
    const status = container.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent).toBe("");

    click(container, "b");
    expect(status.textContent).toBe("Решено: b");
    // Экран обновился (router.refresh): карточки «b» больше нет.
    rerender(["a", "c"]);
    expect(document.activeElement?.textContent).toBe("Операция c");
    expect(document.activeElement?.tagName).toBe("H2");
  });

  it("решена последняя по порядку — фокус на новую последнюю", () => {
    mounted = mount(<Queue ids={["a", "b"]} />);
    click(mounted.container, "b");
    rerender(["a"]);
    expect(document.activeElement?.textContent).toBe("Операция a");
  });

  it("очередь опустела — фокус на заголовок пустого состояния, итог остаётся объявленным", () => {
    mounted = mount(<Queue ids={["a"]} />);
    click(mounted.container, "a");
    rerender([]);
    expect(document.activeElement?.textContent).toBe("Очередь пуста");
    expect(mounted.container.querySelector('[role="status"]')?.textContent).toBe("Решено: a");
    expect(mounted.container.querySelector("[data-queue]")).toBeNull();
  });

  it("тот же итог подряд объявляется снова: в области статуса — новый узел", () => {
    function Same({ ids }: { ids: string[] }) {
      return (
        <DecisionQueue count={ids.length} label="Операции" empty={{ title: "Очередь пуста", body: "—" }}>
          {ids.map((id) => (
            <QueueCard key={id} title={`Операция ${id}`}>
              <SameText id={id} />
            </QueueCard>
          ))}
        </DecisionQueue>
      );
    }
    function SameText({ id }: { id: string }) {
      const decided = useQueueDecision();
      return (
        <span data-decide={id} onClick={(event) => decided?.("Операция подтверждена", event.currentTarget)}>
          {id}
        </span>
      );
    }
    mounted = mount(<Same ids={["a", "b"]} />);
    const status = mounted.container.querySelector('[role="status"]') as HTMLElement;
    click(mounted.container, "a");
    const first = status.firstElementChild;
    act(() => mounted?.root.render(<Same ids={["b"]} />));
    click(mounted.container, "b");
    expect(status.textContent).toBe("Операция подтверждена");
    expect(status.firstElementChild).not.toBe(first);
  });

  it("без решения смена числа карточек фокус не трогает", () => {
    mounted = mount(<Queue ids={["a", "b"]} />);
    const before = document.activeElement;
    rerender(["a", "b", "c"]);
    expect(document.activeElement).toBe(before);
  });
});
