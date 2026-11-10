import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/platform/env";
import { newSessionToken, sessionCookieName, sessionCookieOptions } from "./session-cookie";

const saved = { ...process.env };
beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://x";
});
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

const KEY = Buffer.alloc(32, 1).toString("base64");
/** Минимально допустимый набор переменных для контуров staging и prod. */
const SERVER_VARS = { PAYMENT_PROVIDER: "manual", SMS_PROVIDER: "http", SMS_HTTP_URL: "https://sms", SMS_HTTP_TOKEN: "t", SIGNATURE_PROVIDER: "sigex", PII_ENCRYPTION_KEY: KEY, PII_HASH_KEY: KEY, FILE_URL_SECRET: "f", CRON_SECRET: "c" };

function useEnv(appEnv: string | undefined) {
  Object.assign(process.env, SERVER_VARS);
  if (appEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = appEnv;
  resetEnvCache();
}

describe("cookie сессии", () => {
  it("в dev — senim_session без Secure", () => {
    useEnv("dev");
    expect(sessionCookieName()).toBe("senim_session");
    expect(sessionCookieOptions()).toEqual({ httpOnly: true, secure: false, sameSite: "lax", path: "/" });
  });

  it("без APP_ENV — dev", () => {
    useEnv(undefined);
    expect(sessionCookieName()).toBe("senim_session");
  });

  it.each(["staging", "prod"])("в %s — __Host-senim_session с Secure", (appEnv) => {
    useEnv(appEnv);
    expect(sessionCookieName()).toBe("__Host-senim_session");
    expect(sessionCookieOptions()).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  });
});

describe("newSessionToken", () => {
  it("43 символа base64url без «=», каждый раз новый", () => {
    const a = newSessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(newSessionToken()).not.toBe(a);
  });
});
