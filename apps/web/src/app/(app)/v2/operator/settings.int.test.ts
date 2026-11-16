import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getExecutorIdentityMode } from "@/modules/companies";
import { sessionCookieName } from "@/modules/identity";
import { isEnabled } from "@/platform/features";
import { makeClient, makeOperator } from "../../../../../test/factories";
import { asBrowser, freshBrowser } from "../../../../../test/factories/identity";
import { signInAs } from "../../../../../test/factories/session";
import { addFurnitureTypeAction, setFurnitureTypeActiveAction } from "./furniture-types/actions";
import FurnitureTypesPage from "./furniture-types/page";
import { TypeRow, type TypeRowData } from "./furniture-types/TypeForms";
import MaterialPricesPage from "./materials/page";
import { setExecutorIdentityAction, setPreContractFlowAction } from "./settings/actions";
import SettingsPage from "./settings/page";
import { ExecutorIdentityForm, PreContractFlowForm } from "./settings/SettingsForms";

vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);

const MIN = 60_000;
const sessions = new Map<string, Promise<string>>();
beforeEach(() => {
  freshBrowser();
  sessions.clear();
});

/** Вызов от лица вошедшего человека: своя сессия identity и свой «браузер» (`mfaVerifiedAt` — второй шаг этой сессии). */
async function as<T>(user: { id: string }, call: () => Promise<T>, opts: { mfaVerifiedAt?: Date | null } = {}): Promise<T> {
  let signedIn = sessions.get(user.id);
  if (signedIn === undefined) {
    signedIn = signInAs(user, undefined, opts);
    sessions.set(user.id, signedIn);
  }
  return asBrowser({ [sessionCookieName()]: await signedIn }, call);
}

function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...elements(props.children)];
}
const ofType = <P,>(tree: ReactNode, type: unknown): P[] => elements(tree).filter((el) => el.type === type).map((el) => el.props as P);

async function digestOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (digest === undefined) throw e;
    return digest;
  }
}

describe("типы мебели /v2/operator/furniture-types", () => {
  it("не оператор — отказ; оператор добавляет, тип в списке; повтор названия — CONFLICT; скрыть", async () => {
    const name = `Балкон ${Date.now()}`;
    const client = await makeClient();
    expect(await as(client, () => addFurnitureTypeAction({ name }))).toMatchObject({ ok: false, code: "FORBIDDEN" });

    const operator = await makeOperator();
    expect(await as(operator, () => addFurnitureTypeAction({ name }))).toMatchObject({ ok: true });
    expect(await as(operator, () => addFurnitureTypeAction({ name: name.toUpperCase() }))).toMatchObject({ ok: false, code: "CONFLICT" });

    const row = () => as(operator, async () => ofType<{ type: TypeRowData }>(await FurnitureTypesPage(), TypeRow).find((r) => r.type.name === name));
    const added = await row();
    expect(added?.type).toMatchObject({ active: true, requests: 0 });

    expect(await as(operator, () => setFurnitureTypeActiveAction({ id: added!.type.id, active: false }))).toMatchObject({ ok: true });
    expect((await row())?.type.active).toBe(false);
  });

  it("покупатель на странице — не экран оператора", async () => {
    const client = await makeClient();
    expect(await as(client, () => digestOf(FurnitureTypesPage()))).toMatch(/^NEXT_(REDIRECT|HTTP_ERROR_FALLBACK)/);
  });
});

describe("цены материалов /v2/operator/materials", () => {
  it("флаг «Калькулятор материалов» выключен — страницы нет (404), как в v1", async () => {
    if (isEnabled("materialsCalculator")) return;
    const operator = await makeOperator();
    expect(await as(operator, () => digestOf(MaterialPricesPage()))).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});

describe("настройки /v2/operator/settings", () => {
  it("не оператор — отказ; код давно — MFA_REQUIRED, режим не меняется; свежий код — режим сохранён и виден на экране", async () => {
    const before = await getExecutorIdentityMode();
    const next = before === "HIDDEN" ? "SHOWN" : "HIDDEN";

    const client = await makeClient();
    expect(await as(client, () => setExecutorIdentityAction({ mode: next }))).toMatchObject({ ok: false, code: "FORBIDDEN" });

    const stale = await makeOperator();
    expect(await as(stale, () => setExecutorIdentityAction({ mode: next }), { mfaVerifiedAt: new Date(Date.now() - 10 * MIN) })).toMatchObject({
      ok: false,
      code: "MFA_REQUIRED",
    });
    expect(await getExecutorIdentityMode()).toBe(before);

    const operator = await makeOperator();
    expect(await as(operator, () => setExecutorIdentityAction({ mode: next }))).toMatchObject({ ok: true });
    expect(await getExecutorIdentityMode()).toBe(next);
    const page = await as(operator, () => SettingsPage());
    expect(ofType<{ current: string }>(page, ExecutorIdentityForm)).toMatchObject([{ current: next }]);

    // Вернуть как было: режим общий для всех тестов базы.
    expect(await as(operator, () => setExecutorIdentityAction({ mode: before }))).toMatchObject({ ok: true });
  });

  it("сценарий до договора — только при флаге preContractFlows: без него формы нет, действие отказывает", async () => {
    if (isEnabled("preContractFlows")) return;
    const operator = await makeOperator();
    expect(ofType(await as(operator, () => SettingsPage()), PreContractFlowForm)).toHaveLength(0);
    expect(await as(operator, () => setPreContractFlowAction({ flow: "EXECUTOR_MEASURE" }))).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
