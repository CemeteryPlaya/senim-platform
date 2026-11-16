import { describe, expect, it } from "vitest";
import { standGate } from "./stand-gate";

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
const closed = { password: "пароль-стенда" };

describe("standGate", () => {
  it("без пароля стенда ничего не закрывает (разработка)", () => {
    expect(standGate("/deals", null, { password: undefined })).toBe("pass");
  });

  it.each(["/", "/v2", "/operator", "/login", "/api/files/x", "/api/ai/visualizations"])("закрывает %s без пароля", (path) => {
    expect(standGate(path, null, closed)).toBe("challenge");
  });

  it("пускает с верным паролем, имя пользователя любое", () => {
    expect(standGate("/operator", basic("tester", "пароль-стенда"), closed)).toBe("pass");
    expect(standGate("/operator", basic("", "пароль-стенда"), closed)).toBe("pass");
  });

  it.each([
    ["неверный пароль", basic("tester", "пароль")],
    ["пароль длиннее", basic("tester", "пароль-стенда!")],
    ["другая схема", "Bearer пароль-стенда"],
    ["битый base64", "Basic ###"],
    ["без двоеточия", `Basic ${Buffer.from("пароль-стенда").toString("base64")}`],
  ])("не пускает: %s", (_, authorization) => {
    expect(standGate("/", authorization, closed)).toBe("challenge");
  });

  it.each(["/api/webhooks/payments/mock", "/api/webhooks/payments/freedompay", "/api/cron/run"])("вебхуки и cron проходят без пароля: %s", (path) => {
    expect(standGate(path, null, closed)).toBe("pass");
  });

  it.each(["/api/webhooks/other", "/api/webhooks/payments/mock/extra", "/api/webhooks/payments/manual", "/api/cron/other", "/api/webhooks/", "/api/cron/run/x"])(
    "другие пути под вебхуками и cron закрыты: %s",
    (path) => {
      expect(standGate(path, null, closed)).toBe("challenge");
    },
  );

  // Браузер запрашивает манифест, значки и сервис-воркер без пароля basic-auth — иначе «Установить» не появится.
  it.each(["/manifest.webmanifest", "/sw.js", "/offline", "/apple-icon.png", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"])(
    "файлы установки приложения проходят без пароля: %s",
    (path) => {
      expect(standGate(path, null, closed)).toBe("pass");
    },
  );

  it.each(["/icons/", "/icons/x.svg", "/icons/../deals", "/icons/a/b.png", "/icons/icon-192.png/x", "/offline/x", "/sw.js.map", "/manifest.json"])(
    "похожие на файлы установки пути закрыты: %s",
    (path) => {
      expect(standGate(path, null, closed)).toBe("challenge");
    },
  );

  it("похожий на вебхук путь не исключение", () => {
    expect(standGate("/api/webhooksX", null, closed)).toBe("challenge");
    expect(standGate("/api/cronjob", null, closed)).toBe("challenge");
  });
});
