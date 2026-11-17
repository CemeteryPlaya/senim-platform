import { describe, expect, it } from "vitest";
import { mayShowCode } from "./shown-code";

describe("mayShowCode: код входа на экране (мок у identity)", () => {
  it("production-сборка без пароля стенда — код не показываем: адрес открыт всем, кто его знает", () => {
    expect(mayShowCode({ nodeEnv: "production", standPassword: undefined })).toBe(false);
    expect(mayShowCode({ nodeEnv: "production", standPassword: "" })).toBe(false);
  });

  it("production-сборка за паролем стенда и dev-сервер — показываем", () => {
    expect(mayShowCode({ nodeEnv: "production", standPassword: "пароль-стенда-длинный" })).toBe(true);
    expect(mayShowCode({ nodeEnv: "development", standPassword: undefined })).toBe(true);
    expect(mayShowCode({ nodeEnv: "test", standPassword: undefined })).toBe(true);
  });
});
