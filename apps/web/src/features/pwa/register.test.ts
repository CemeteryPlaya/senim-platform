import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker, SERVICE_WORKER_OPTIONS, SERVICE_WORKER_URL } from "./register";

describe("registerServiceWorker", () => {
  it("регистрирует /sw.js с областью «/» и без HTTP-кэша", async () => {
    const register = vi.fn(async () => ({}));
    await registerServiceWorker({ serviceWorker: { register } });
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
    expect(SERVICE_WORKER_URL).toBe("/sw.js");
    expect(SERVICE_WORKER_OPTIONS.scope).toBe("/");
  });

  it("нет поддержки воркеров — тихо ничего", async () => {
    await expect(registerServiceWorker({})).resolves.toBeUndefined();
  });

  it("отказ регистрации не выбрасывается", async () => {
    const register = vi.fn(async () => {
      throw new Error("denied");
    });
    await expect(registerServiceWorker({ serviceWorker: { register } })).resolves.toBeUndefined();
  });
});
