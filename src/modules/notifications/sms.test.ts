import { describe, expect, it } from "vitest";
import { createHttpSmsProvider } from "./sms";

type Call = { url: string; init: RequestInit };

function fakeFetch(response: Response) {
  const calls: Call[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response.clone();
  };
  return { calls, fetchFn };
}

const config = { url: "https://sms.example/send", token: "tok", sender: "SENIM" };

describe("SmsProvider http (скелет под провайдера)", () => {
  it("отправляет POST с токеном, отправителем и ключом идемпотентности", async () => {
    const { calls, fetchFn } = fakeFetch(Response.json({ id: "m-42" }));
    const provider = createHttpSmsProvider(config, fetchFn);
    const result = await provider.send({ phone: "+77000000101", text: "Сенім: код 1234", idempotencyKey: "n1" });

    expect(provider.name).toBe("http");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://sms.example/send");
    expect(calls[0]!.init.method).toBe("POST");
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("authorization")).toBe("Bearer tok");
    expect(headers.get("idempotency-key")).toBe("n1");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ to: "+77000000101", text: "Сенім: код 1234", sender: "SENIM" });
    expect(result.providerMessageId).toBe("m-42");
  });

  it("без id в ответе — ключ идемпотентности как идентификатор", async () => {
    const { fetchFn } = fakeFetch(new Response(null, { status: 202 }));
    const result = await createHttpSmsProvider(config, fetchFn).send({ phone: "+77000000101", text: "x", idempotencyKey: "n2" });
    expect(result.providerMessageId).toBe("http-n2");
  });

  it("ошибка шлюза — исключение (задача повторится), без текста SMS в сообщении", async () => {
    const { fetchFn } = fakeFetch(new Response("bad", { status: 500 }));
    const error = await createHttpSmsProvider(config, fetchFn)
      .send({ phone: "+77000000101", text: "секретный код 1234", idempotencyKey: "n3" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("500");
    expect(String(error)).not.toContain("1234");
  });
});
