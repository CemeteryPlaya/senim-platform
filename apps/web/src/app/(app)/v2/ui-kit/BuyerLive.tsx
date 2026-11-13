"use client";

import { useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import {
  Card,
  Chat,
  ChatComposer,
  Menu,
  SignaturePad,
  Stack,
  toast,
  Uploader,
  type ChatMessage,
  type SignatureValue,
  type UploaderItem,
} from "@/kit";
import type { Device } from "@/platform/device";
import { to } from "../../_shell/paths";

const t = ru.app.kit.showcase.buyer;

const START_ITEMS: UploaderItem[] = [
  { id: "a", name: t.uploaderNames[0], state: "done" },
  { id: "b", name: t.uploaderNames[1], state: "uploading", progress: 40 },
  { id: "c", name: t.uploaderNames[2], state: "error", error: t.uploaderError },
];

const START_MESSAGES: ChatMessage[] = t.chatMessages.map((message, index) => ({
  ...message,
  // В четвёртом сообщении — фото-вложение: так видно превью в ленте.
  ...(index === 3 ? { attachments: [{ id: "f", url: to("/v2/ui-kit"), name: t.chatAttachment }] } : {}),
}));

/** Меню действий: на телефоне шторка, на компьютере выпадающее меню. */
export function MenuSample({ device }: { device: Device }) {
  return (
    <Menu
      label={t.menuLabel}
      device={device}
      items={[
        { label: t.menuHistory, href: to("/v2/ui-kit") },
        { label: t.menuShare, onSelect: () => toast(t.menuToast) },
        { label: t.menuDispute, tone: "danger", onSelect: () => toast(t.menuToast) },
      ]}
    />
  );
}

/** Загрузчик с тремя фото в разных состояниях; добавление, повтор и удаление работают на месте. */
export function UploaderSample() {
  const [items, setItems] = useState<UploaderItem[]>(START_ITEMS);
  /** Адреса превью, созданные образцом: освобождает тот, кто их создал (kit этого не делает). */
  const blobs = useRef(new Set<string>());
  useEffect(() => {
    const created = blobs.current;
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
      created.clear();
    };
  }, []);
  return (
    <Uploader
      items={items}
      max={5}
      accept="image/*"
      label={t.uploaderLabel}
      onAdd={(files) =>
        setItems((current) => [
          ...current,
          ...files.map((file, index) => {
            const previewUrl = URL.createObjectURL(file);
            blobs.current.add(previewUrl);
            return { id: `${Date.now()}-${index}`, name: file.name, state: "done" as const, previewUrl };
          }),
        ])
      }
      onReject={(_files, reason) => toast(reason === "type" ? t.uploaderRejectType : t.uploaderRejectLimit)}
      onRemove={(id) => {
        const gone = items.find((item) => item.id === id)?.previewUrl;
        if (gone && blobs.current.delete(gone)) URL.revokeObjectURL(gone);
        setItems((current) => current.filter((item) => item.id !== id));
      }}
      onRetry={(id) => {
        setItems((current) => current.map((item) => (item.id === id ? { ...item, state: "done", error: undefined } : item)));
        toast(t.uploaderRetried);
      }}
    />
  );
}

/** Переписка из пяти сообщений; отправка добавляет своё сообщение, лента прокручивается к нему. */
export function ChatSample({ device }: { device: Device }) {
  const [messages, setMessages] = useState<ChatMessage[]>(START_MESSAGES);
  return (
    <Chat
      label={t.chatLabel}
      messages={messages}
      composer={
        <ChatComposer
          device={device}
          label={t.chatComposerLabel}
          placeholder={t.chatPlaceholder}
          maxLength={200}
          onSend={(text) => {
            setMessages((current) => [
              ...current,
              { id: `m${current.length + 1}`, mine: true, text, time: new Date().toLocaleTimeString("ru-KZ", { hour: "2-digit", minute: "2-digit" }) },
            ]);
          }}
        />
      }
    />
  );
}

/** Подпись: холст и замена вводом ФИО; ниже — что именно отдал компонент. */
export function SignatureSample() {
  const [value, setValue] = useState<SignatureValue | null>(null);
  const state = value === null ? t.signatureNone : typeof value === "string" ? t.signatureDrawn : t.signatureTyped(value.typedName);
  return (
    <Card>
      <Stack>
        <SignaturePad label={t.signatureLabel} onChange={setValue} />
        <p role="status" className="text-sub text-muted">
          {state}
        </p>
      </Stack>
    </Card>
  );
}
