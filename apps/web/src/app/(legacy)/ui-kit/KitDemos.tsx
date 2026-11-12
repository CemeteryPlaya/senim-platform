"use client";

import { useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, Chat, Modal, PhotoUpload, Stepper, type ChatMessage, type PhotoItem } from "@/ui";

// Живые примеры для витрины: состояние хранится здесь, компоненты — презентационные.

const s = ru.common.uiKit.sample;

/** Кнопка в загрузке гасит нажатие своим обработчиком — поэтому она живёт в клиентском компоненте. */
export function LoadingButtonDemo() {
  return <Button loading>{s.loading}</Button>;
}

export function StepperDemo() {
  const [current, setCurrent] = useState(1);
  return (
    <div className="flex flex-col gap-4">
      <Stepper steps={s.steps} current={current} back={{ onClick: () => setCurrent((c) => Math.max(c - 1, 0)) }} />
      <Button variant="secondary" className="self-start" onClick={() => setCurrent((c) => Math.min(c + 1, s.steps.length - 1))}>
        {ru.common.actions.next}
      </Button>
    </div>
  );
}

export function ModalDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        {s.openModal}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={s.modalTitle}
        description={s.modalText}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {ru.common.actions.cancel}
            </Button>
            <Button variant="danger" onClick={() => setOpen(false)}>
              {s.modalConfirm}
            </Button>
          </>
        }
      />
    </>
  );
}

/** Имитация загрузки: прогресс по таймеру, каждое третье фото «падает». */
export function PhotoDemo() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setInterval>>());
  const added = useRef(0);

  useEffect(() => {
    const active = timers.current;
    return () => active.forEach(clearInterval);
  }, []);

  const simulate = (id: string, fails: boolean) => {
    const timer = setInterval(() => {
      setPhotos((list) =>
        list.map((p) => {
          if (p.id !== id || p.status !== "uploading") return p;
          const progress = (p.progress ?? 0) + 20;
          if (fails && progress >= 60) return { ...p, status: "error" };
          return progress >= 100 ? { ...p, status: "done", progress: 100 } : { ...p, progress };
        }),
      );
    }, 300);
    timers.current.add(timer);
    setTimeout(() => {
      clearInterval(timer);
      timers.current.delete(timer);
    }, 2000);
  };

  const add = (files: File[]) => {
    const items = files.map((file) => {
      added.current += 1;
      const item: PhotoItem = { id: `${added.current}-${file.name}`, src: URL.createObjectURL(file), status: "uploading", progress: 0 };
      return { item, fails: added.current % 3 === 0 };
    });
    setPhotos((list) => [...list, ...items.map(({ item }) => item)]);
    items.forEach(({ item, fails }) => simulate(item.id, fails));
  };

  const retry = (id: string) => {
    setPhotos((list) => list.map((p) => (p.id === id ? { ...p, status: "uploading", progress: 0 } : p)));
    simulate(id, false);
  };

  const remove = (id: string) => {
    setPhotos((list) => {
      const photo = list.find((p) => p.id === id);
      if (photo) URL.revokeObjectURL(photo.src);
      return list.filter((p) => p.id !== id);
    });
  };

  return <PhotoUpload label={s.photosLabel} hint={s.photosHint} photos={photos} onAdd={add} onRemove={remove} onRetry={retry} max={6} />;
}

export function ChatDemo({ initial }: { initial: ChatMessage[] }) {
  const [messages, setMessages] = useState(initial);
  const send = async (text: string) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    setMessages((list) => [...list, { id: String(list.length + 1), kind: "own", text, sentAt: new Date() }]);
  };
  return <Chat messages={messages} onSend={send} />;
}
