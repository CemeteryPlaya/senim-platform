"use client";

import { useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, DecisionQueue, QueueCard, useQueueDecision } from "@/kit";

const t = ru.app.kit.showcase.operator;

/** Кнопка решения в карточке образца: объявляет итог очереди и убирает карточку (как обновление экрана после действия). */
function Decide({ n, onDone }: { n: number; onDone: (n: number) => void }) {
  const decided = useQueueDecision();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={(event) => {
        decided?.(t.queueDone(n), event.currentTarget);
        onDone(n);
      }}
    >
      {t.queueDecide}
    </Button>
  );
}

/** Очередь решений: после «Решить» итог в области статуса, фокус — на заголовок следующей карточки, в конце — на пустое состояние. */
export function QueueSample() {
  const [items, setItems] = useState([41, 38, 35]);
  const done = (n: number) => setItems((current) => current.filter((item) => item !== n));
  return (
    <DecisionQueue count={items.length} label={t.queueLabel} empty={{ title: t.queueEmptyTitle, body: t.queueEmptyBody }}>
      {items.map((n) => (
        <QueueCard key={n} title={t.queueItem(n)} meta={t.queueBody}>
          <div>
            <Decide n={n} onDone={done} />
          </div>
        </QueueCard>
      ))}
    </DecisionQueue>
  );
}
