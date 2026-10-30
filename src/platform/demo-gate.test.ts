import { describe, expect, it } from "vitest";
import { demoGate } from "./demo-gate";

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
const closed = { demoMode: true, password: "пароль-показа" };

describe("demoGate", () => {
  it("без DEMO_MODE ничего не закрывает", () => {
    expect(demoGate("/deals", null, { demoMode: false, password: "пароль-показа" })).toBe("pass");
  });

  it("демо без пароля открыто (разработка)", () => {
    expect(demoGate("/deals", null, { demoMode: true, password: undefined })).toBe("pass");
  });

  it.each(["/", "/demo", "/bank-demo", "/login", "/api/files/x", "/api/ai/visualizations"])("закрывает %s без пароля", (path) => {
    expect(demoGate(path, null, closed)).toBe("challenge");
  });

  it("пускает с верным паролем, имя пользователя любое", () => {
    expect(demoGate("/bank-demo", basic("bank", "пароль-показа"), closed)).toBe("pass");
    expect(demoGate("/bank-demo", basic("", "пароль-показа"), closed)).toBe("pass");
  });

  it.each([
    ["неверный пароль", basic("bank", "пароль")],
    ["пароль длиннее", basic("bank", "пароль-показа!")],
    ["другая схема", "Bearer пароль-показа"],
    ["битый base64", "Basic ###"],
    ["без двоеточия", `Basic ${Buffer.from("пароль-показа").toString("base64")}`],
  ])("не пускает: %s", (_, authorization) => {
    expect(demoGate("/", authorization, closed)).toBe("challenge");
  });

  it.each(["/api/webhooks/bank", "/api/webhooks/escrow-simulator", "/api/cron/run"])("вебхуки и cron проходят без пароля: %s", (path) => {
    expect(demoGate(path, null, closed)).toBe("pass");
  });

  it("похожий на вебхук путь не исключение", () => {
    expect(demoGate("/api/webhooksX", null, closed)).toBe("challenge");
    expect(demoGate("/api/cronjob", null, closed)).toBe("challenge");
  });
});
