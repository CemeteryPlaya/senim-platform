import { describe, expect, it } from "vitest";
import { isPushServiceUrl, pushSubscriptionSchema } from "./push";

describe("адрес подписки — только push-сервисы браузеров (защита от SSRF)", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QGx",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("принимает %s", (url) => expect(isPushServiceUrl(url)).toBe(true));

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evilpush.apple.com.example/x",
    "не адрес",
  ])("отклоняет %s", (url) => expect(isPushServiceUrl(url)).toBe(false));

  it("ключи шифрования — base64url нужной длины", () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    expect(pushSubscriptionSchema.safeParse({ endpoint, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } }).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ endpoint, keys: { p256dh: "<script>", auth: "a".repeat(22) } }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint, keys: { p256dh: "B".repeat(87) } }).success).toBe(false);
  });
});
