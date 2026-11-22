import { describe, expect, it, vi } from "vitest";
import { html } from "@/kit/test-utils";
import { GuestHome } from "../_home/GuestHome";

const h = vi.hoisted(() => ({ device: "desktop" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));

const { default: LandingPage } = await import("./page");

describe("/v2/landing: лендинг для всех — сюда ведёт название продукта у вошедшего", () => {
  it.each(["desktop", "mobile"] as const)("%s: тот же лендинг, что видит гость на главной", async (device) => {
    h.device = device;
    expect(html(await LandingPage())).toBe(html(<GuestHome device={device} />));
  });
});
