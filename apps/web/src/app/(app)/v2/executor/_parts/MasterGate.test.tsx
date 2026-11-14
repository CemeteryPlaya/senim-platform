import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html } from "@/kit/test-utils";
import { MasterGate } from "./MasterGate";

describe("экран статуса неодобренного мастера", () => {
  it.each(["none", "pending", "rejected"] as const)("%s: один h1, одно главное действие — на регистрацию, на обоих устройствах", (status) => {
    for (const device of ["mobile", "desktop"] as const) {
      const out = html(<MasterGate status={status} title="Заявки" device={device} />);
      expect(count(out, "<h1")).toBe(1);
      expect(count(out, "data-primary-action")).toBe(1);
      expect(out).toContain('href="/v2/register/executor"');
      expect(out).toContain(ru.app.masterRequests.gate[status].now);
    }
  });
});
